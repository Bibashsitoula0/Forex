// Backtesting Engine
// Runs historical signal simulation on Yahoo Finance candle data
// Computes: win rate, profit factor, max drawdown, Sharpe ratio, equity curve

import { ema, atr, rsi, findSrLevels, detectTrend, detectRsiDivergence, detectPatterns, generateSignals } from './indicators.js'
import { calculateADX, detectRegime } from './smc.js'

const MIN_BARS = 60   // bars needed before first signal attempt
const MAX_HOLD = 120  // max bars to hold a trade before expiring

export function runBacktest(candles, settings = {}) {
  if (!candles || candles.length < MIN_BARS + 10) {
    return { error: `Need at least ${MIN_BARS + 10} candles — only got ${candles?.length ?? 0}` }
  }

  const minScore = settings.signal?.minScore ?? 40   // use score_raw (0-100) directly

  const trades = []
  let i = MIN_BARS

  while (i < candles.length - 1) {
    const slice  = candles.slice(0, i + 1)
    const closes = slice.map(c => c.close)
    const highs  = slice.map(c => c.high)
    const lows   = slice.map(c => c.low)

    // Core indicators
    const ema20Arr  = ema(closes, 20)
    const ema50Arr  = ema(closes, 50)
    const ema200Arr = ema(closes, 200)
    const atrArr    = atr(highs, lows, closes, 14)
    const rsiArr    = rsi(closes, 14)
    const trend     = detectTrend(highs, lows)
    const srLevels  = findSrLevels(highs, lows, 5, 50)
    const divergence = detectRsiDivergence(closes, rsiArr)
    const patterns  = detectPatterns(slice, 5)

    // Regime detection — skip extremely low-ADX (deeply ranging) bars
    const adxResult  = calculateADX(highs, lows, closes, 14)
    const regimeData = detectRegime(adxResult, atrArr)
    const regime     = regimeData.regime

    // Skip VOLATILE regime (unreliable signals)
    if (regime === 'VOLATILE') { i++; continue }

    const inds = { ema20: ema20Arr, ema50: ema50Arr, ema200: ema200Arr, atr: atrArr, rsi: rsiArr, patterns }

    // Context: regime-aware, neutral intermarket, average session bonus
    const context = {
      regime,
      intermarketScore: 50,  // neutral — no historical intermarket data
      sessionBonus:     8,   // average between Asian(6) and London(10)
      session:          null,
      smcData:          null,
      fibData:          null,
    }

    const signals = generateSignals(slice, inds, srLevels, trend, divergence, context)

    // Filter by score_raw directly
    const qualified = signals.filter(s => (s.score_raw ?? 0) >= minScore)
    if (qualified.length === 0) { i++; continue }

    const sig    = qualified[0]
    const isBuy  = sig.direction === 'BUY'
    const entry  = sig.entry
    const sl     = sig.stop_loss
    const tp1    = sig.take_profit_1
    const tp2    = sig.take_profit_2
    const tp3    = sig.take_profit_3
    const entryTime = slice[slice.length - 1].time

    let exitPrice = null, exitStatus = 'expired', tp1Hit = false, tp2Hit = false, barsHeld = 0

    // Scan forward candles
    for (let j = i + 1; j < Math.min(candles.length, i + MAX_HOLD); j++) {
      const fc = candles[j]
      barsHeld++

      if (isBuy) {
        if (!tp1Hit && fc.high >= tp1)           tp1Hit = true
        if (tp1Hit && !tp2Hit && fc.high >= tp2) tp2Hit = true
        if (fc.low  <= sl)  { exitPrice = sl;  exitStatus = 'sl_hit';  break }
        if (fc.high >= tp3) { exitPrice = tp3; exitStatus = 'tp3_hit'; break }
      } else {
        if (!tp1Hit && fc.low  <= tp1)           tp1Hit = true
        if (tp1Hit && !tp2Hit && fc.low <= tp2)  tp2Hit = true
        if (fc.high >= sl)  { exitPrice = sl;  exitStatus = 'sl_hit';  break }
        if (fc.low  <= tp3) { exitPrice = tp3; exitStatus = 'tp3_hit'; break }
      }
    }

    if (!exitPrice) {
      exitPrice = candles[Math.min(candles.length - 1, i + MAX_HOLD)].close
    }

    const priceDiff  = isBuy ? exitPrice - entry : entry - exitPrice
    const profitPct  = +((priceDiff / entry) * 100).toFixed(4)
    const profitPips = +priceDiff.toFixed(2)
    const win        = exitStatus !== 'sl_hit' && profitPct > 0

    trades.push({
      direction:   sig.direction,
      entry:       +entry.toFixed(2),
      exit:        +exitPrice.toFixed(2),
      exitStatus,
      profitPct,
      profitPips,
      win,
      score:       sig.score_raw ?? +(sig.confluence_score * 10).toFixed(0),
      grade:       sig.score_grade,
      regime,
      entryTime,
      barsHeld,
      tp1Hit,
      tp2Hit,
    })

    i += Math.max(barsHeld, 5)  // no overlapping trades
  }

  if (trades.length === 0) {
    return { trades: [], stats: null, equityCurve: [] }
  }

  return { trades, stats: calcStats(trades), equityCurve: buildEquityCurve(trades) }
}

function calcStats(trades) {
  const wins   = trades.filter(t => t.win)
  const losses = trades.filter(t => !t.win)

  const grossProfit  = wins.reduce((s, t) => s + t.profitPct, 0)
  const grossLoss    = Math.abs(losses.reduce((s, t) => s + t.profitPct, 0))
  const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99 : 0

  const winRate     = +(wins.length / trades.length * 100).toFixed(1)
  const avgWinPips  = wins.length   ? +(wins.reduce((s, t)   => s + t.profitPips, 0) / wins.length).toFixed(1)   : 0
  const avgLossPips = losses.length ? +(losses.reduce((s, t) => s + t.profitPips, 0) / losses.length).toFixed(1) : 0

  // Max drawdown
  let peak = 100, equity = 100, maxDD = 0
  trades.forEach(t => {
    equity += t.profitPct
    if (equity > peak) peak = equity
    const dd = ((peak - equity) / peak) * 100
    if (dd > maxDD) maxDD = dd
  })

  // Sharpe ratio (simplified annualised)
  const returns  = trades.map(t => t.profitPct)
  const mean     = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  const sharpe   = variance > 0 ? +(mean / Math.sqrt(variance) * Math.sqrt(252)).toFixed(2) : 0

  const netPct = +trades.reduce((s, t) => s + t.profitPct, 0).toFixed(2)
  const grade  = profitFactor >= 1.3 && winRate >= 45 && maxDD <= 20 ? 'PASS' : 'FAIL'

  // By-regime breakdown
  const byRegime = {}
  trades.forEach(t => {
    if (!byRegime[t.regime]) byRegime[t.regime] = { wins: 0, total: 0 }
    byRegime[t.regime].total++
    if (t.win) byRegime[t.regime].wins++
  })
  Object.keys(byRegime).forEach(k => {
    byRegime[k].winRate = +((byRegime[k].wins / byRegime[k].total) * 100).toFixed(1)
  })

  return {
    totalTrades:    trades.length,
    wins:           wins.length,
    losses:         losses.length,
    winRate,
    avgWinPips,
    avgLossPips,
    profitFactor,
    maxDrawdownPct: +maxDD.toFixed(2),
    sharpeRatio:    sharpe,
    netProfitPct:   netPct,
    grade,
    byRegime,
  }
}

function buildEquityCurve(trades) {
  let equity = 100, peak = 100
  const curve = [{ trade: 0, equity: 100, drawdown: 0, time: trades[0].entryTime }]
  trades.forEach((t, i) => {
    equity += t.profitPct
    if (equity > peak) peak = equity
    const dd = +((peak - equity) / peak * 100).toFixed(2)
    curve.push({ trade: i + 1, equity: +equity.toFixed(3), drawdown: dd, win: t.win, time: t.entryTime })
  })
  return curve
}
