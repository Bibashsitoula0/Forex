/**
 * XAU/USD Trading Analysis — Backend (Node.js / Express)
 *
 * Data source priority:
 *   1. MetaTrader 5 Bridge  (localhost:8001)  — real broker data
 *   2. Yahoo Finance REST API                 — automatic fallback
 */

import 'dotenv/config'
import express from 'express'
import cors    from 'cors'
import fs      from 'fs'
import path    from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import {
  ema, atr, rsi,
  findSrLevels, detectTrend, detectRsiDivergence, detectPatterns, generateSignals,
} from './indicators.js'
import {
  calculateADX, detectRegime,
  detectSMC, detectOrderBlocks, detectFVG, detectLiquiditySweeps, calculateFibonacci,
} from './smc.js'
import { fetchIntermarket }                                         from './intermarket.js'
import { getSessionInfo }                                           from './sessionFilter.js'
import { fetchEconomicCalendar, getNewsStatus, setManualLockout }  from './newsFilter.js'
import { checkRiskFilters, recordSignalResult }                     from './riskFilter.js'
import { readSettings, writeSettings }                              from './settingsManager.js'
import { runBacktest }                                              from './backtest.js'
import { sendSignalAlert }                                          from './emailAlert.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 8000
const MT5  = 'http://localhost:8001'
const MT5_TIMEOUT_MS = 4000
const ALL_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1H', '4H', '1D', '1W']

app.use(cors())
app.use(express.json())

// ── Auth ───────────────────────────────────────────────────────────────────────
// Shared-secret API key. Required for every /api route except /api/health so
// uptime checks still work. Set API_KEY in .env before deploying anywhere
// reachable off localhost — without it, /api/mt5/execute lets anyone place
// trades on the connected account.

const API_KEY = process.env.API_KEY
if (!API_KEY) {
  console.warn('[Auth] WARNING: API_KEY not set in .env — all /api routes are UNPROTECTED.')
}

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || !API_KEY) return next()
  if (req.headers['x-api-key'] === API_KEY) return next()
  res.status(401).json({ error: 'Unauthorized' })
})

// ── Journal ────────────────────────────────────────────────────────────────────

const JOURNAL_PATH = path.join(__dirname, 'journal.json')
const readJournal  = () => { try { return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) } catch { return [] } }
const writeJournal = (d) => fs.writeFileSync(JOURNAL_PATH, JSON.stringify(d, null, 2))

// ── Signal Performance History ─────────────────────────────────────────────────

const PERF_PATH = path.join(__dirname, 'signal_performance.json')
const readPerf  = () => { try { return JSON.parse(fs.readFileSync(PERF_PATH, 'utf8')) } catch { return [] } }
const writePerf = (d) => fs.writeFileSync(PERF_PATH, JSON.stringify(d, null, 2))

function saveSignalResult(sig, exitStatus, exitPrice, lockedAt) {
  const isBuy      = sig.direction === 'BUY'
  const priceDiff  = isBuy ? exitPrice - sig.entry : sig.entry - exitPrice
  const profitPct  = +((priceDiff / sig.entry) * 100).toFixed(4)
  const profitPips = +priceDiff.toFixed(2)
  const resolvedAt = new Date().toISOString()
  const durationMs = lockedAt ? Date.now() - new Date(lockedAt).getTime() : 0

  const record = {
    id:            randomUUID(),
    timeframe:     sig.timeframe || '—',
    direction:     sig.direction,
    entry:         sig.entry,
    stop_loss:     sig.stop_loss,
    take_profit_1: sig.take_profit_1,
    take_profit_2: sig.take_profit_2,
    take_profit_3: sig.take_profit_3,
    exit_price:    +exitPrice.toFixed(2),
    exit_status:   exitStatus,
    profit_pct:    profitPct,
    profit_pips:   profitPips,
    confluence:    sig.confluence_score,
    score_raw:     sig.score_raw   ?? null,
    score_grade:   sig.score_grade ?? null,
    rsi:           sig.rsi,
    locked_at:     lockedAt || resolvedAt,
    resolved_at:   resolvedAt,
    duration_min:  Math.round(durationMs / 60000),
  }

  const history = readPerf()
  history.unshift(record)
  writePerf(history.slice(0, 500))
  console.log(`[Perf] ${sig.direction} ${exitStatus} profit=${profitPct}%  pips=${profitPips}`)

  // Sync to risk filter for daily/consecutive loss management
  if (exitStatus === 'sl_hit' || exitStatus === 'tp3_hit') {
    recordSignalResult(profitPct)
  }

  return record
}

// ── MT5 Connection State ───────────────────────────────────────────────────────

let mt5State = {
  available: false,
  symbol:    null,
  server:    null,
  login:     null,
  company:   null,
  terminal:  null,
  lastCheck: null,
}

async function fetchMT5(endpoint, timeout = MT5_TIMEOUT_MS) {
  const res = await fetch(`${MT5}${endpoint}`, {
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`MT5 bridge: HTTP ${res.status}`)
  return res.json()
}

async function probeMT5() {
  try {
    const h = await fetchMT5('/health', 3000)
    mt5State = {
      available: h.connected === true,
      symbol:    h.symbol,
      server:    h.server,
      login:     h.login,
      company:   h.company,
      terminal:  h.terminal,
      lastCheck: new Date().toISOString(),
    }
    if (mt5State.available) {
      console.log(`[MT5] Connected — ${h.company} | ${h.server} | ${h.symbol}`)
    }
  } catch {
    if (mt5State.available) console.log('[MT5] Disconnected — switching to Yahoo Finance fallback')
    mt5State.available = false
    mt5State.lastCheck = new Date().toISOString()
  }
}

probeMT5()
setInterval(probeMT5, 30_000)

// ── MT5 Bridge: fetch candles ──────────────────────────────────────────────────

async function fetchFromMT5(timeframe) {
  const json = await fetchMT5(`/candles/${timeframe}`)
  if (!json.candles?.length) throw new Error('Empty candle data from MT5')
  return { candles: json.candles, source: 'MT5', symbol: json.symbol }
}

// ── Yahoo Finance: fetch candles ───────────────────────────────────────────────

const YF_CFG = {
  '1m':  { interval: '1m',  range: '5d'  },
  '5m':  { interval: '5m',  range: '5d'  },
  '15m': { interval: '15m', range: '5d'  },
  '30m': { interval: '30m', range: '1mo' },
  '1H':  { interval: '60m', range: '30d' },
  '4H':  { interval: '60m', range: '90d' },
  '1D':  { interval: '1d',  range: '1y'  },
  '1W':  { interval: '1wk', range: '5y'  },
}
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
}

async function fetchSpotMidPrice() {
  try {
    const res = await fetch(
      'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const profile = data?.[0]?.spreadProfilePrices?.find(p => p.spreadProfile === 'premium')
      ?? data?.[0]?.spreadProfilePrices?.[0]
    if (!profile?.bid || !profile?.ask) return null
    return +((profile.bid + profile.ask) / 2).toFixed(2)
  } catch {
    return null
  }
}

async function fetchFromYahoo(timeframe) {
  const cfg = YF_CFG[timeframe]
  if (!cfg) throw new Error(`Invalid timeframe: ${timeframe}`)

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`
  const res = await fetch(url, { headers: YF_HEADERS })
  if (!res.ok) throw new Error(`Yahoo Finance: HTTP ${res.status}`)

  const json   = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('Unexpected Yahoo Finance response')

  const timestamps = result.timestamp || []
  const q = result.indicators.quote[0]

  let candles = timestamps
    .map((t, i) => ({
      time:   t,
      open:   q.open[i],  high: q.high[i],
      low:    q.low[i],   close: q.close[i],
      volume: q.volume[i] || 0,
    }))
    .filter(c => c.open != null && c.high != null && c.low != null && c.close != null)
    .map(c => ({
      time:   c.time,
      open:   +c.open.toFixed(2),  high: +c.high.toFixed(2),
      low:    +c.low.toFixed(2),   close: +c.close.toFixed(2),
      volume: c.volume,
    }))

  // Resample 60m → 4H (Yahoo has no native 4H; MT5 does)
  if (timeframe === '4H') {
    const bkts = new Map()
    for (const c of candles) {
      const d = new Date(c.time * 1000)
      d.setMinutes(0, 0, 0)
      d.setHours(Math.floor(d.getHours() / 4) * 4)
      const k = Math.floor(d.getTime() / 1000)
      if (!bkts.has(k)) bkts.set(k, { time: k, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })
      else {
        const b = bkts.get(k)
        b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low)
        b.close = c.close; b.volume += c.volume
      }
    }
    candles = [...bkts.values()].sort((a, b) => a.time - b.time)
  }

  // Spot adjustment: subtract futures-spot basis using Swissquote live price
  const spotMid = await fetchSpotMidPrice()
  if (spotMid != null && candles.length > 0) {
    const lastFutures = candles[candles.length - 1].close
    const basis = +(lastFutures - spotMid).toFixed(2)
    if (basis > 0 && basis < 100) {
      console.log(`[Spot] GC=F=${lastFutures} Swissquote spot=${spotMid} basis=${basis} — adjusting candles`)
      candles = candles.map(c => ({
        ...c,
        open:  +(c.open  - basis).toFixed(2),
        high:  +(c.high  - basis).toFixed(2),
        low:   +(c.low   - basis).toFixed(2),
        close: +(c.close - basis).toFixed(2),
      }))
      return { candles, source: 'Spot', symbol: 'XAU/USD Spot' }
    }
  }

  console.log('[Spot] Swissquote unavailable — returning raw GC=F futures price')
  return { candles, source: 'Yahoo Finance', symbol: 'GC=F (Gold Futures)' }
}

// ── Signal lock: sticky BUY/SELL state ─────────────────────────────────────────
//
// Once a signal fires on a timeframe, it stays showing (entry/SL/TP frozen)
// on every subsequent refresh — SL/TP hits and time only update its displayed
// status, they never clear it. The ONLY thing that replaces it is the Signal
// Engine producing a genuine signal in the OPPOSITE direction. There is no
// neutral/no-signal state after the first signal ever fires on a timeframe.

const lockedSignals = new Map()
const EMAIL_ALERT_TIMEFRAMES = ['15m', '30m', '1H', '4H', '1D', '1W']  // no alerts for 1m/5m — too noisy

function lockNewSignal(timeframe, freshSignal) {
  const locked = {
    signal:         { ...freshSignal },
    lockedAt:       new Date().toISOString(),
    status:         'active',
    resultRecorded: false,
  }
  lockedSignals.set(timeframe, locked)
  if (EMAIL_ALERT_TIMEFRAMES.includes(timeframe)) {
    sendSignalAlert(timeframe, locked.signal).catch(() => {})
  }
  return [{ ...locked.signal, status: 'active', lockedAt: locked.lockedAt }]
}

function processSignalLock(timeframe, freshSignals, currentPrice) {
  const existing    = lockedSignals.get(timeframe)
  const freshSignal = freshSignals[0] ?? null

  // Nothing has ever fired on this timeframe yet — genuinely nothing to show.
  if (!existing) {
    return freshSignal ? lockNewSignal(timeframe, freshSignal) : []
  }

  const { signal: sig, lockedAt } = existing
  const isBuy = sig.direction === 'BUY'

  // Track SL/TP progress for display only — never clears the signal by itself.
  if (!existing.resultRecorded) {
    let status = existing.status
    if (isBuy) {
      if      (currentPrice <= sig.stop_loss)     status = 'sl_hit'
      else if (currentPrice >= sig.take_profit_3) status = 'tp3_hit'
      else if (currentPrice >= sig.take_profit_2) status = 'tp2_hit'
      else if (currentPrice >= sig.take_profit_1) status = 'tp1_hit'
      else                                          status = 'active'
    } else {
      if      (currentPrice >= sig.stop_loss)     status = 'sl_hit'
      else if (currentPrice <= sig.take_profit_3) status = 'tp3_hit'
      else if (currentPrice <= sig.take_profit_2) status = 'tp2_hit'
      else if (currentPrice <= sig.take_profit_1) status = 'tp1_hit'
      else                                          status = 'active'
    }
    existing.status = status

    // Record the trade outcome once, purely for performance stats — the badge
    // keeps showing this same side regardless of what happens here.
    if (status === 'sl_hit' || status === 'tp3_hit') {
      const exitPrice = status === 'sl_hit' ? sig.stop_loss : sig.take_profit_3
      saveSignalResult({ ...sig, timeframe }, status, exitPrice, lockedAt)
      existing.resultRecorded = true
    }
  }

  // Flip ONLY on a genuine opposite-direction signal from the Signal Engine.
  if (freshSignal && freshSignal.direction !== sig.direction) {
    if (!existing.resultRecorded) {
      saveSignalResult({ ...sig, timeframe }, 'flipped', currentPrice, lockedAt)
    }
    return lockNewSignal(timeframe, freshSignal)
  }

  // Same direction (or no qualifying fresh signal at all) — keep showing it.
  return [{ ...sig, status: existing.status, lockedAt }]
}

// ── Unified fetch ──────────────────────────────────────────────────────────────

async function fetchCandles(timeframe) {
  if (mt5State.available) {
    try {
      return await fetchFromMT5(timeframe)
    } catch (err) {
      console.warn(`[MT5] candle fetch failed (${err.message}), falling back to Yahoo`)
      mt5State.available = false
    }
  }
  return fetchFromYahoo(timeframe)
}

// ── Build full institutional-grade analysis response ───────────────────────────

async function buildResponse(candles, source, symbol, timeframe) {
  const settings = readSettings()
  const layers   = settings.layers

  const closes = candles.map(c => c.close)
  const highs  = candles.map(c => c.high)
  const lows   = candles.map(c => c.low)
  const times  = candles.map(c => c.time)

  // Core indicators
  const ema20Arr  = ema(closes, 20)
  const ema50Arr  = ema(closes, 50)
  const ema200Arr = ema(closes, 200)
  const atrArr    = atr(highs, lows, closes, 14)
  const rsiArr    = rsi(closes, 14)
  const srLevels  = findSrLevels(highs, lows, 5, 50)
  const trend     = detectTrend(highs, lows, 20)
  const divergence = detectRsiDivergence(closes, rsiArr)
  const patterns  = detectPatterns(candles, 5)
  const inds      = { ema20: ema20Arr, ema50: ema50Arr, ema200: ema200Arr, atr: atrArr, rsi: rsiArr, patterns }

  // ── Layer 1: Market Regime (ADX) ──────────────────────────────────────────
  let adxResult  = { adx: null, plusDI: null, minusDI: null }
  let regimeData = { regime: 'UNKNOWN', adx: null }
  if (layers.regime) {
    adxResult  = calculateADX(highs, lows, closes, 14)
    regimeData = detectRegime(adxResult, atrArr)
  }

  // ── Layer 2: Intermarket Confluence ───────────────────────────────────────
  let imData = { score: 50, confluences: [], bullishGold: false, bearishGold: false }
  if (layers.intermarket) {
    try { imData = await fetchIntermarket() } catch { /* offline — keep defaults */ }
  }

  // ── Layer 3: News Filter ──────────────────────────────────────────────────
  let newsStatus = { locked: false, reason: null, event: null }
  if (layers.news) {
    try {
      const events = await fetchEconomicCalendar()
      newsStatus   = getNewsStatus(events)
    } catch { /* offline */ }
  }

  // ── Layer 4: Session Filter ────────────────────────────────────────────────
  const sessionInfo = getSessionInfo()

  // ── Layer 6: SMC — Order Blocks, FVG, BOS/CHoCH, Liquidity Sweeps ─────────
  let smcData = null, orderBlocks = [], fvgList = [], liquiditySweeps = []
  if (layers.smc) {
    smcData         = detectSMC(candles)
    orderBlocks     = detectOrderBlocks(candles)
    fvgList         = detectFVG(candles)
    liquiditySweeps = detectLiquiditySweeps(candles)
  }

  // ── Layer 7: Fibonacci ─────────────────────────────────────────────────────
  let fibData = null
  if (layers.fibonacci) {
    fibData = calculateFibonacci(candles)
  }

  // ── Generate signals with full 100-point context ───────────────────────────
  const context = {
    smcData:          layers.smc         ? smcData : null,
    fibData:          layers.fibonacci   ? fibData : null,
    intermarketScore: layers.intermarket ? imData.score : 50,
    sessionBonus:     layers.session     ? sessionInfo.bonus : 5,
    session:          layers.session     ? sessionInfo : null,
    higherTFTrend:    null,
    regime:           regimeData.regime,
  }

  const minScore     = settings.signal?.minScore ?? 40
  const freshSignals = generateSignals(candles, inds, srLevels, trend, divergence, context)
    .filter(s => (s.score_raw ?? (s.confluence_score * 10)) >= minScore)

  // ── Layer 8: Risk Filters ──────────────────────────────────────────────────
  let riskStatus = { blocked: false, blockReason: null, warnings: [] }
  if (layers.risk) {
    riskStatus = checkRiskFilters(settings, null)
  }

  const cp0     = closes[closes.length - 1]
  let signals   = timeframe ? processSignalLock(timeframe, freshSignals, cp0) : freshSignals

  // Annotate signals if risk or news block is active
  if (riskStatus.blocked || (newsStatus.locked && layers.news)) {
    const blockReason = riskStatus.blocked
      ? riskStatus.blockReason
      : `News lockout: ${newsStatus.reason}`
    signals = signals.map(s => ({ ...s, blocked: true, blockReason }))
  }

  const toLine = (arr) => arr
    .map((v, i) => (v != null ? { time: times[i], value: +v.toFixed(2) } : null))
    .filter(Boolean)

  const cp   = closes[closes.length - 1]
  const prev = closes[closes.length - 2] || cp

  return {
    data_source: source,
    symbol,
    candles:  candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })),
    volumes:  candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? '#22c55e55' : '#ef444455',
    })),
    ema20:    toLine(ema20Arr),
    ema50:    toLine(ema50Arr),
    ema200:   toLine(ema200Arr),
    rsi_data: toLine(rsiArr),
    sr_levels: srLevels,
    patterns,
    trend,
    divergence,
    signals,
    stats: {
      current_price:    +cp.toFixed(2),
      daily_change:     +(cp - prev).toFixed(2),
      daily_change_pct: +(((cp - prev) / prev) * 100).toFixed(2),
      atr:    +(atrArr[atrArr.length - 1]    || 0).toFixed(2),
      rsi:    +(rsiArr[rsiArr.length - 1]    || 50).toFixed(1),
      ema20:  +(ema20Arr[ema20Arr.length - 1]   || 0).toFixed(2),
      ema50:  +(ema50Arr[ema50Arr.length - 1]   || 0).toFixed(2),
      ema200: +(ema200Arr[ema200Arr.length - 1] || 0).toFixed(2),
    },
    // Institutional layers
    regime:    { ...regimeData, adx: adxResult },
    session:   sessionInfo,
    intermarket: imData,
    news:      newsStatus,
    risk:      riskStatus,
    smc: {
      orderBlocks,
      fvgList,
      liquiditySweeps,
      structure: smcData,
    },
    fibonacci: fibData,
  }
}

// ── Core routes ────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    time:   new Date().toISOString(),
    mt5:    mt5State.available,
    data_source: mt5State.available ? 'MT5' : 'Yahoo Finance',
  })
})

app.get('/api/tick', async (_req, res) => {
  if (mt5State.available) {
    try { return res.json(await fetchMT5('/tick')) } catch { /* fall through */ }
  }
  const spotMid = await fetchSpotMidPrice()
  if (spotMid == null) return res.status(503).json({ error: 'No price data' })
  res.json({
    bid:    +(spotMid - 0.17).toFixed(2),
    ask:    +(spotMid + 0.17).toFixed(2),
    price:  spotMid,
    source: 'Swissquote',
    time:   new Date().toISOString(),
  })
})

app.get('/api/data/:timeframe', async (req, res) => {
  try {
    const { candles, source, symbol } = await fetchCandles(req.params.timeframe)
    if (!candles.length) return res.status(503).json({ error: 'No candle data available' })
    res.json(await buildResponse(candles, source, symbol, req.params.timeframe))
  } catch (err) {
    console.error('[/api/data]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/trends', async (_req, res) => {
  const result = {}
  await Promise.all(ALL_TIMEFRAMES.map(async (tf) => {
    try {
      const { candles } = await fetchCandles(tf)
      const highs  = candles.map(c => c.high)
      const lows   = candles.map(c => c.low)
      const close  = candles[candles.length - 1].close

      const levels = findSrLevels(highs, lows, 5, 50)
      const resistance = levels
        .filter(l => l.type === 'resistance' && l.price >= close)
        .sort((a, b) => a.price - b.price)[0] ?? null
      const support = levels
        .filter(l => l.type === 'support' && l.price <= close)
        .sort((a, b) => b.price - a.price)[0] ?? null

      const patterns = detectPatterns(candles, 5)

      result[tf] = {
        trend: detectTrend(highs, lows),
        price: +close.toFixed(2),
        resistance,
        support,
        pattern: patterns[patterns.length - 1] ?? null,
      }
    } catch {
      result[tf] = { trend: 'error', price: null, resistance: null, support: null, pattern: null }
    }
  }))
  res.json(result)
})

// Shared by /api/all-signals and the background signal-alert monitor below —
// runs full signal generation + lock/email logic for one timeframe.
async function scanTimeframeForSignals(tf, settings, sessionInfo) {
  const minScore = settings.signal?.minScore ?? 40
  const { candles } = await fetchCandles(tf)
  const closes  = candles.map(c => c.close)
  const highs   = candles.map(c => c.high)
  const lows    = candles.map(c => c.low)

  const ema20Arr  = ema(closes, 20)
  const ema50Arr  = ema(closes, 50)
  const ema200Arr = ema(closes, 200)
  const atrArr    = atr(highs, lows, closes, 14)
  const rsiArr    = rsi(closes, 14)
  const srLevels  = findSrLevels(highs, lows, 5, 50)
  const trend     = detectTrend(highs, lows)
  const divergence = detectRsiDivergence(closes, rsiArr)
  const patterns  = detectPatterns(candles, 5)
  const inds      = { ema20: ema20Arr, ema50: ema50Arr, ema200: ema200Arr, atr: atrArr, rsi: rsiArr, patterns }

  const adxResult  = calculateADX(highs, lows, closes, 14)
  const regimeData = detectRegime(adxResult, atrArr)

  const smcData = detectSMC(candles)
  const fibData = calculateFibonacci(candles)

  const context = {
    smcData, fibData,
    intermarketScore: 50,
    sessionBonus:     sessionInfo.bonus,
    session:          sessionInfo,
    regime:           regimeData.regime,
  }

  const freshSignals = generateSignals(candles, inds, srLevels, trend, divergence, context)
    .filter(s => (s.score_raw ?? (s.confluence_score * 10)) >= minScore)

  // processSignalLock sends the email itself the instant a NEW signal locks in
  const signals = processSignalLock(tf, freshSignals, closes[closes.length - 1])

  return {
    signals,
    regime:  regimeData.regime,
    session: sessionInfo.session,
    trend,
    price:   closes[closes.length - 1],
  }
}

// Returns lightweight signal snapshot for all timeframes in one call
app.get('/api/all-signals', async (_req, res) => {
  const settings    = readSettings()
  const sessionInfo = getSessionInfo()

  const result = {}
  await Promise.all(ALL_TIMEFRAMES.map(async (tf) => {
    try {
      result[tf] = await scanTimeframeForSignals(tf, settings, sessionInfo)
    } catch (err) {
      result[tf] = { signals: [], regime: 'UNKNOWN', session: '—', trend: 'consolidation', error: err.message }
    }
  }))
  res.json(result)
})

// ── Background signal-alert monitor ────────────────────────────────────────────
// Watches every timeframe continuously, independent of the frontend being open,
// so an email fires the instant a BUY/SELL signal locks in on any of them.
const SIGNAL_SCAN_INTERVAL_MS = 20_000

async function scanAllTimeframesForAlerts() {
  const settings    = readSettings()
  const sessionInfo = getSessionInfo()
  await Promise.all(ALL_TIMEFRAMES.map(tf =>
    scanTimeframeForSignals(tf, settings, sessionInfo).catch(() => {})
  ))
}

setInterval(scanAllTimeframesForAlerts, SIGNAL_SCAN_INTERVAL_MS)
scanAllTimeframesForAlerts()

// ── Institutional layer endpoints ──────────────────────────────────────────────

app.get('/api/intermarket', async (_req, res) => {
  try { res.json(await fetchIntermarket()) }
  catch (err) { res.status(503).json({ error: err.message }) }
})

app.get('/api/session', (_req, res) => {
  res.json(getSessionInfo())
})

app.get('/api/news', async (_req, res) => {
  try {
    const events = await fetchEconomicCalendar()
    res.json({ ...getNewsStatus(events), events: events.slice(0, 10) })
  } catch (err) {
    res.status(503).json({ error: err.message })
  }
})

app.post('/api/news/lockout', (req, res) => {
  const { active, durationMinutes = 60 } = req.body
  setManualLockout(!!active, durationMinutes)
  res.json({ ok: true, active: !!active })
})

app.get('/api/risk', (_req, res) => {
  const settings = readSettings()
  res.json(checkRiskFilters(settings, null))
})

app.get('/api/regime/:timeframe', async (req, res) => {
  try {
    const { candles } = await fetchCandles(req.params.timeframe)
    const highs  = candles.map(c => c.high)
    const lows   = candles.map(c => c.low)
    const closes = candles.map(c => c.close)
    const atrArr    = atr(highs, lows, closes, 14)
    const adxResult = calculateADX(highs, lows, closes, 14)
    const regime    = detectRegime(adxResult, atrArr)
    res.json({ ...regime, adx: adxResult })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/settings', (_req, res) => {
  res.json(readSettings())
})

app.patch('/api/settings', (req, res) => {
  try { res.json(writeSettings(req.body)) }
  catch (err) { res.status(400).json({ error: err.message }) }
})

app.get('/api/backtest/:timeframe', async (req, res) => {
  try {
    const { candles } = await fetchCandles(req.params.timeframe)
    const settings    = readSettings()
    res.json(runBacktest(candles, settings))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── MT5-specific routes ────────────────────────────────────────────────────────

app.get('/api/mt5/status', async (_req, res) => {
  await probeMT5()
  res.json({
    ...mt5State,
    bridge_url: MT5,
    instructions: mt5State.available ? null : [
      'Install Python 3.9+ from https://python.org',
      'Open a terminal in backend/mt5_bridge/',
      'Run: install.bat  (installs MetaTrader5 + flask)',
      'Open MetaTrader 5 and log in to your broker',
      'Run: python mt5_server.py',
    ],
  })
})

app.get('/api/mt5/tick', async (_req, res) => {
  if (!mt5State.available) return res.status(503).json({ error: 'MT5 not connected' })
  try { res.json(await fetchMT5('/tick')) }
  catch (err) { res.status(502).json({ error: err.message }) }
})

app.get('/api/mt5/account', async (_req, res) => {
  if (!mt5State.available) return res.status(503).json({ error: 'MT5 not connected' })
  try { res.json(await fetchMT5('/account')) }
  catch (err) { res.status(502).json({ error: err.message }) }
})

app.get('/api/mt5/positions', async (_req, res) => {
  if (!mt5State.available) return res.status(503).json({ error: 'MT5 not connected' })
  try { res.json(await fetchMT5('/positions')) }
  catch (err) { res.status(502).json({ error: err.message }) }
})

app.get('/api/mt5/symbol', async (_req, res) => {
  if (!mt5State.available) return res.status(503).json({ error: 'MT5 not connected' })
  try { res.json(await fetchMT5('/symbol')) }
  catch (err) { res.status(502).json({ error: err.message }) }
})

app.post('/api/mt5/execute', async (req, res) => {
  if (!mt5State.available) return res.status(503).json({ error: 'MT5 not connected' })
  const { direction, volume = 0.01, entry, stop_loss, take_profit } = req.body
  if (!direction || !entry || !stop_loss || !take_profit) {
    return res.status(400).json({ error: 'Missing required fields: direction, entry, stop_loss, take_profit' })
  }
  try {
    const r = await fetch(`${MT5}/execute`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ direction, volume, entry, stop_loss, take_profit }),
      signal:  AbortSignal.timeout(6000),
    })
    res.json(await r.json())
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

// ── Signal Performance ─────────────────────────────────────────────────────────

app.get('/api/performance', (_req, res) => {
  const history = readPerf()
  if (!history.length) return res.json({
    win_rate: null, avg_profit: null, avg_loss: null,
    net_1h: 0, net_24h: 0, total: 0, wins: 0, losses: 0, cancelled: 0, signals: [],
  })

  const cancelled = history.filter(s => s.exit_status === 'cancelled')
  const resolved  = history.filter(s => s.exit_status !== 'cancelled')
  const wins      = resolved.filter(s => s.profit_pct > 0)
  const losses    = resolved.filter(s => s.profit_pct <= 0)
  const now       = Date.now()
  const last1h    = resolved.filter(s => now - new Date(s.resolved_at).getTime() <  3_600_000)
  const last24h   = resolved.filter(s => now - new Date(s.resolved_at).getTime() < 86_400_000)
  const sum       = arr => arr.reduce((t, s) => t + s.profit_pct, 0)

  res.json({
    total:      history.length,
    wins:       wins.length,
    losses:     losses.length,
    cancelled:  cancelled.length,
    win_rate:   resolved.length ? +(wins.length / resolved.length * 100).toFixed(1) : null,
    avg_profit: wins.length     ? +(sum(wins)   / wins.length).toFixed(4)           : null,
    avg_loss:   losses.length   ? +(sum(losses) / losses.length).toFixed(4)         : null,
    net_1h:     +(sum(last1h)).toFixed(4),
    net_24h:    +(sum(last24h)).toFixed(4),
    signals:    history.slice(0, 50),
  })
})


// ── Journal CRUD ───────────────────────────────────────────────────────────────

app.get('/api/journal', (_req, res) => res.json(readJournal().slice(0, 100)))

app.post('/api/journal', (req, res) => {
  const { date, timeframe, direction, entry_price, exit_price, stop_loss, take_profit, result, pnl, notes } = req.body
  const entries = readJournal()
  entries.unshift({
    id: randomUUID(), date,
    timeframe:   timeframe   || '1H',
    direction,
    entry_price: entry_price ?? null, exit_price:  exit_price  ?? null,
    stop_loss:   stop_loss   ?? null, take_profit: take_profit ?? null,
    result:      result      ?? 'open', pnl: pnl ?? null, notes: notes ?? null,
    created_at:  new Date().toISOString(),
  })
  writeJournal(entries)
  res.json({ status: 'ok' })
})

app.delete('/api/journal/:id', (req, res) => {
  writeJournal(readJournal().filter(e => e.id !== req.params.id))
  res.json({ status: 'ok' })
})

// ── Frontend (production) ───────────────────────────────────────────────────────
// If frontend/dist exists (npm run build), serve it from this same process so
// the whole app is one origin, one port — no separate static host needed.

const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist')
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')))
}

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  XAU/USD Backend  →  http://localhost:${PORT}`)
  console.log(`  MT5 Bridge       →  http://localhost:8001  (optional)`)
  console.log(`  Data source      →  ${mt5State.available ? 'MetaTrader 5' : 'Yahoo Finance (MT5 not detected)'}\n`)
})
