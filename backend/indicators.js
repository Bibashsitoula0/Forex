export function ema(values, period) {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const result = new Array(values.length).fill(null)
  let start = values.findIndex((v) => v != null)
  if (start === -1) return result
  result[start] = values[start]
  for (let i = start + 1; i < values.length; i++) {
    if (values[i] == null) { result[i] = null; continue }
    result[i] = values[i] * k + result[i - 1] * (1 - k)
  }
  return result
}

export function atr(highs, lows, closes, period = 14) {
  const tr = closes.map((c, i) => {
    if (i === 0) return highs[i] - lows[i]
    const prev = closes[i - 1]
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - prev), Math.abs(lows[i] - prev))
  })
  return ema(tr, period)
}

export function rsi(closes, period = 14) {
  const deltas = closes.map((c, i) => (i === 0 ? 0 : c - closes[i - 1]))
  const gains  = deltas.map((d) => Math.max(d, 0))
  const losses = deltas.map((d) => Math.max(-d, 0))
  const avgGain = ema(gains, period)
  const avgLoss = ema(losses, period)
  return avgGain.map((g, i) => {
    if (g == null || avgLoss[i] == null) return 50
    if (avgLoss[i] === 0) return 100
    return parseFloat((100 - 100 / (1 + g / avgLoss[i])).toFixed(2))
  })
}

export function findSrLevels(highs, lows, window = 5, lastN = 50) {
  const n  = Math.min(lastN, highs.length)
  const h  = highs.slice(-n)
  const lo = lows.slice(-n)
  const levels = []

  for (let i = window; i < h.length - window; i++) {
    let isHigh = true, isLow = true
    for (let j = 1; j <= window; j++) {
      if (h[i]  < h[i - j]  || h[i]  < h[i + j])  isHigh = false
      if (lo[i] > lo[i - j] || lo[i] > lo[i + j]) isLow  = false
    }
    if (isHigh) levels.push({ price: h[i],  type: 'resistance' })
    if (isLow)  levels.push({ price: lo[i], type: 'support' })
  }

  levels.sort((a, b) => a.price - b.price)
  if (levels.length === 0) return []

  const merged = [{ price: parseFloat(levels[0].price.toFixed(2)), type: levels[0].type }]
  for (let i = 1; i < levels.length; i++) {
    const prev = merged[merged.length - 1]
    if ((levels[i].price - prev.price) / prev.price < 0.004) {
      prev.price = parseFloat(((prev.price + levels[i].price) / 2).toFixed(2))
    } else {
      merged.push({ price: parseFloat(levels[i].price.toFixed(2)), type: levels[i].type })
    }
  }
  return merged
}

export function detectTrend(highs, lows, n = 20) {
  const h  = highs.slice(-n)
  const lo = lows.slice(-n)
  const swingH = [], swingL = []

  for (let i = 2; i < h.length - 2; i++) {
    if (h[i]  > h[i-1]  && h[i]  > h[i-2]  && h[i]  > h[i+1]  && h[i]  > h[i+2])  swingH.push(h[i])
    if (lo[i] < lo[i-1] && lo[i] < lo[i-2] && lo[i] < lo[i+1] && lo[i] < lo[i+2]) swingL.push(lo[i])
  }

  if (swingH.length < 2 || swingL.length < 2) return 'consolidation'
  const hh = swingH[swingH.length-1] > swingH[swingH.length-2]
  const hl = swingL[swingL.length-1] > swingL[swingL.length-2]
  const lh = swingH[swingH.length-1] < swingH[swingH.length-2]
  const ll = swingL[swingL.length-1] < swingL[swingL.length-2]
  if (hh && hl) return 'uptrend'
  if (lh && ll) return 'downtrend'
  return 'consolidation'
}

export function detectRsiDivergence(closes, rsiArr) {
  if (closes.length < 20) return null
  const rc = closes.slice(-20)
  const rr = rsiArr.slice(-20)
  const priceLl = rc[rc.length-1] < rc[10]
  const rsiHl   = rr[rr.length-1] > rr[10]
  const priceHh = rc[rc.length-1] > rc[10]
  const rsiLh   = rr[rr.length-1] < rr[10]
  if (priceLl && rsiHl && rr[rr.length-1] < 45)
    return { type: 'bullish', description: 'Price lower lows, RSI higher lows — bullish divergence' }
  if (priceHh && rsiLh && rr[rr.length-1] > 55)
    return { type: 'bearish', description: 'Price higher highs, RSI lower highs — bearish divergence' }
  return null
}

export function detectPatterns(candles, lookback = 5) {
  const patterns = []
  const start = Math.max(1, candles.length - lookback)
  for (let i = start; i < candles.length; i++) {
    const { open: o, high: h, low: lo, close: c, time } = candles[i]
    const prev = candles[i - 1]
    const body  = Math.abs(c - o)
    const range = h - lo
    if (range < 0.01) continue
    const upperWick = h - Math.max(o, c)
    const lowerWick = Math.min(o, c) - lo

    if (lowerWick >= 2 * body && upperWick <= 0.4 * body && c > o)
      patterns.push({ name: 'Hammer',            type: 'bullish', time })
    if (upperWick >= 2 * body && lowerWick <= 0.4 * body && c < o)
      patterns.push({ name: 'Shooting Star',     type: 'bearish', time })
    if (c > o && prev.close < prev.open && o <= prev.close && c >= prev.open)
      patterns.push({ name: 'Bullish Engulfing', type: 'bullish', time })
    if (c < o && prev.close > prev.open && o >= prev.close && c <= prev.open)
      patterns.push({ name: 'Bearish Engulfing', type: 'bearish', time })
    if (body <= 0.08 * range)
      patterns.push({ name: 'Doji',              type: 'neutral', time })
  }
  return patterns
}

// ── Signal generation ──────────────────────────────────────────────────────────
//
// 100-POINT INSTITUTIONAL SCORING SYSTEM:
//   Trend alignment (multi-TF):      20 pts
//   Pattern confirmation:             15 pts
//   S/R + SMC confluence:            15 pts
//   Indicator alignment (RSI/EMA):   15 pts
//   Intermarket confluence:           15 pts
//   Volume confirmation:              10 pts
//   Fibonacci confluence:             10 pts
//   Total:                           100 pts
//
//   80-100: PREMIUM   — fire signal
//   65-79:  STANDARD  — fire signal
//   50-64:  WEAK      — fire with caution label
//   <50:    No signal
//
// `context` param (optional) injects external layer data:
//   { smcData, fibData, intermarketScore, sessionBonus, higherTFTrend, regime }

export function generateSignals(candles, inds, srLevels, trend, divergence, context = {}) {
  if (candles.length < 10) return []

  const last   = candles[candles.length - 1]
  const close  = last.close
  const atrVal = inds.atr[inds.atr.length - 1] || 10
  const rsiVal = inds.rsi[inds.rsi.length - 1] || 50
  const e20    = inds.ema20[inds.ema20.length  - 1]
  const e50    = inds.ema50[inds.ema50.length  - 1]
  const e200   = inds.ema200[inds.ema200.length - 1]

  // EMA slope: compare to 4 bars ago to detect rising/falling
  const len     = inds.ema20.length
  const e20Prev = inds.ema20[Math.max(0, len - 5)] ?? e20
  const e50Prev = inds.ema50[Math.max(0, len - 5)] ?? e50
  const e20Rising = e20 > e20Prev
  const e50Rising = e50 > e50Prev

  // Volume stats
  const recentVols = candles.slice(-20).map(c => c.volume).filter(v => v > 0)
  const avgVol     = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1)
  const volRatio   = avgVol > 0 ? last.volume / avgVol : 1

  // Recent swing high/low over last 5 candles (for SL placement)
  const last5      = candles.slice(-5)
  const swingLow5  = Math.min(...last5.map(c => c.low))
  const swingHigh5 = Math.max(...last5.map(c => c.high))

  const recentPatterns = inds.patterns || []

  // Unpack context (new institutional layers)
  const {
    smcData         = null,
    fibData         = null,
    intermarketScore = 50,    // 0-100, default neutral
    sessionBonus    = 5,      // pts from current trading session
    higherTFTrend   = null,   // 'uptrend' | 'downtrend' | 'consolidation' | null
    regime          = 'UNKNOWN',
    session         = null,
  } = context

  function mkSignal(dir, raw100, reasons, warning, extras = {}) {
    const isBuy  = dir === 'BUY'
    const score  = Math.max(0, Math.min(100, Math.round(raw100)))
    const grade  = score >= 80 ? 'PREMIUM' : score >= 65 ? 'STANDARD' : score >= 40 ? 'WEAK' : null
    if (!grade) return null

    // 2×ATR buffer: wider SL so intra-bar noise doesn't prematurely stop out
    const slBuf     = atrVal * 2
    const naturalSL = isBuy ? swingLow5 - slBuf : swingHigh5 + slBuf
    const minSL     = isBuy ? close - slBuf      : close + slBuf
    const sl        = isBuy
      ? +Math.min(naturalSL, minSL).toFixed(2)
      : +Math.max(naturalSL, minSL).toFixed(2)
    const risk = +Math.abs(close - sl).toFixed(2)
    if (risk < atrVal * 0.5) return null

    return {
      direction:        dir,
      entry:            +close.toFixed(2),
      stop_loss:        sl,
      take_profit_1:    isBuy ? +(close + risk    ).toFixed(2) : +(close - risk    ).toFixed(2),
      take_profit_2:    isBuy ? +(close + risk * 2).toFixed(2) : +(close - risk * 2).toFixed(2),
      take_profit_3:    isBuy ? +(close + risk * 3).toFixed(2) : +(close - risk * 3).toFixed(2),
      score_raw:        score,
      score_grade:      grade,
      confluence_score: +(score / 10).toFixed(1),   // backward compat for chart/lock
      stop_distance:    risk,
      rr_ratio:         1.0,
      reasons,
      warning:          warning || null,
      atr:              +atrVal.toFixed(2),
      rsi:              +rsiVal.toFixed(1),
      regime,
      session,
      ...extras,
    }
  }

  const signals = []

  // ── BUY scoring (100-point system) ───────────────────────────────────────────
  {
    let score = 0
    const reasons = []
    let warning   = null

    // ── LAYER 1: Trend alignment (20 pts) ─────────────────────────────────────
    if (trend === 'uptrend') {
      score += 10; reasons.push('Current TF uptrend (HH+HL confirmed)')
    } else if (trend === 'downtrend') {
      score -= 5; warning = 'Counter-trend BUY — downtrend in place'
    }
    if (higherTFTrend === 'uptrend') {
      score += 10; reasons.push('Higher TF uptrend aligned ✓')
    } else if (higherTFTrend === 'downtrend') {
      score -= 5; warning = warning || 'Higher TF is downtrend — use smaller size'
    } else if (higherTFTrend === 'uptrend') {
      score += 5
    }

    // ── LAYER 2: Pattern confirmation (15 pts) ──────────────────────────────
    for (const p of recentPatterns) {
      if (p.type === 'bullish') {
        const pts = p.name === 'Bullish Engulfing' ? 10 : 8
        score += pts; reasons.push(`${p.name} pattern (+${pts}pts)`)
      }
    }
    if (smcData?.choch?.type === 'bullish') {
      score += 5; reasons.push('CHoCH bullish — structure reversal confirmed')
    } else if (smcData?.bos?.type === 'bullish') {
      score += 3; reasons.push('BOS bullish — break of structure')
    }
    const bulOB = smcData?.orderBlocks?.filter(ob => ob.type === 'bullish' && ob.touched) ?? []
    if (bulOB.length > 0) { score += 5; reasons.push(`Bullish order block at $${bulOB[0].low}–$${bulOB[0].high}`) }
    const bulSweep = smcData?.sweeps?.filter(s => s.type === 'bullish_sweep') ?? []
    if (bulSweep.length > 0) { score += 3; reasons.push('Liquidity sweep of lows — smart money reversal') }

    // ── LAYER 3: S/R + FVG confluence (15 pts) ─────────────────────────────
    const atSupport = srLevels.filter(l => l.type === 'support' && close > l.price && (close - l.price) / close < 0.008)
    for (const l of atSupport) { score += 10; reasons.push(`At support $${l.price}`) }
    const bulFVG = smcData?.fvg?.filter(f => f.type === 'bullish' && f.touched) ?? []
    if (bulFVG.length > 0) { score += 5; reasons.push(`In bullish FVG $${bulFVG[0].bottom}–$${bulFVG[0].top}`) }
    const nearRes = srLevels.filter(l => l.type === 'resistance' && l.price > close && (l.price - close) / close < 0.005)
    if (nearRes.length > 0) { score -= 5; warning = warning || `⚠ Resistance at $${nearRes[0].price} just above` }

    // ── LAYER 4: Indicator alignment RSI + EMA (15 pts) ────────────────────
    const rsiRecentLow = Math.min(...inds.rsi.slice(-10).filter(v => v != null))
    const wasOversold  = rsiRecentLow < 30
    if      (rsiVal < 30)  { score += 8; reasons.push(`RSI oversold (${rsiVal}) — prime zone`) }
    else if (rsiVal < 40)  {
      if (wasOversold) { score += 6; reasons.push(`RSI recovering from OS (${rsiVal})`) }
      else             { score += 3; reasons.push(`RSI approaching OS (${rsiVal})`) }
    }
    else if (rsiVal < 50)  { score += 2; reasons.push(`RSI below midline (${rsiVal})`) }
    else if (rsiVal >= 75) { score -= 6; warning = `⚠ RSI overbought (${rsiVal}) — risky to buy` }
    else if (rsiVal >= 70) { score -= 3; warning = warning || `RSI elevated (${rsiVal})` }
    if (divergence?.type === 'bullish') { score += 5; reasons.push('Bullish RSI divergence') }

    if (close > e200) { score += 3; reasons.push('Above EMA200 (long-term bull)') }
    if (close > e50)  { score += 2; reasons.push('Above EMA50') }
    if (close > e20)  { score += 2; reasons.push('Above EMA20') }
    if (e20 > e50 && e50 > e200) { score += 3; reasons.push('EMA stack bullish (20>50>200)') }
    if (e20Rising && e50Rising)   { score += 2; reasons.push('EMA 20 & 50 rising') }

    // ── LAYER 5: Intermarket confluence (15 pts) ────────────────────────────
    const imPts = Math.round((intermarketScore / 100) * 15)
    score += imPts
    if (intermarketScore >= 65) reasons.push(`Intermarket aligned (${intermarketScore}/100)`)
    else if (intermarketScore <= 35) { score -= 5; reasons.push(`Intermarket headwind (${intermarketScore}/100)`) }

    // ── LAYER 6: Volume confirmation (10 pts) ───────────────────────────────
    if (volRatio >= 2.0)      { score += 10; reasons.push(`Volume ${volRatio.toFixed(1)}× avg — strong confirmation`) }
    else if (volRatio >= 1.5) { score += 7;  reasons.push(`Volume ${volRatio.toFixed(1)}× avg`) }
    else if (volRatio >= 1.2) { score += 5;  reasons.push(`Volume ${volRatio.toFixed(1)}× avg`) }
    else if (volRatio < 0.8)  { score -= 3;  reasons.push(`Low volume ${volRatio.toFixed(1)}× — weak move`) }

    // ── LAYER 7: Fibonacci confluence (10 pts) ──────────────────────────────
    if (fibData?.inGoldenZone) {
      score += 10; reasons.push(`In Fib golden zone (61.8–78.6%) at $${fibData.nearestPrice}`)
    } else if (fibData?.nearFib) {
      score += 5;  reasons.push(`Near Fib ${fibData.nearestLabel} at $${fibData.nearestPrice}`)
    }

    // ── Session bonus ────────────────────────────────────────────────────────
    score += sessionBonus

    // ── Regime filter ────────────────────────────────────────────────────────
    if (regime === 'VOLATILE') { score -= 20; warning = warning || '⚠ Volatile regime — signals unreliable' }
    if (regime === 'RANGING' && trend === 'uptrend') { score -= 5 }

    if (score >= 40) {
      const sig = mkSignal('BUY', score, reasons, warning)
      if (sig) signals.push(sig)
    }
  }

  // ── SELL scoring (100-point system) ──────────────────────────────────────────
  {
    let score = 0
    const reasons = []
    let warning   = null

    // ── LAYER 1: Trend alignment (20 pts) ─────────────────────────────────────
    if (trend === 'downtrend') {
      score += 10; reasons.push('Current TF downtrend (LH+LL confirmed)')
    } else if (trend === 'uptrend') {
      score -= 5; warning = 'Counter-trend SELL — uptrend in place'
    }
    if (higherTFTrend === 'downtrend') {
      score += 10; reasons.push('Higher TF downtrend aligned ✓')
    } else if (higherTFTrend === 'uptrend') {
      score -= 5; warning = warning || 'Higher TF is uptrend — use smaller size'
    }

    // ── LAYER 2: Pattern confirmation (15 pts) ──────────────────────────────
    for (const p of recentPatterns) {
      if (p.type === 'bearish') {
        const pts = p.name === 'Bearish Engulfing' ? 10 : 8
        score += pts; reasons.push(`${p.name} pattern (+${pts}pts)`)
      }
    }
    if (smcData?.choch?.type === 'bearish') {
      score += 5; reasons.push('CHoCH bearish — structure reversal')
    } else if (smcData?.bos?.type === 'bearish') {
      score += 3; reasons.push('BOS bearish — break of structure')
    }
    const berOB = smcData?.orderBlocks?.filter(ob => ob.type === 'bearish' && ob.touched) ?? []
    if (berOB.length > 0) { score += 5; reasons.push(`Bearish order block at $${berOB[0].low}–$${berOB[0].high}`) }
    const berSweep = smcData?.sweeps?.filter(s => s.type === 'bearish_sweep') ?? []
    if (berSweep.length > 0) { score += 3; reasons.push('Liquidity sweep of highs — smart money sell') }

    // ── LAYER 3: S/R + FVG confluence (15 pts) ─────────────────────────────
    const atResistance = srLevels.filter(l => l.type === 'resistance' && l.price > close && (l.price - close) / close < 0.008)
    for (const l of atResistance) { score += 10; reasons.push(`At resistance $${l.price}`) }
    const berFVG = smcData?.fvg?.filter(f => f.type === 'bearish' && f.touched) ?? []
    if (berFVG.length > 0) { score += 5; reasons.push(`In bearish FVG $${berFVG[0].bottom}–$${berFVG[0].top}`) }
    const nearSup = srLevels.filter(l => l.type === 'support' && close > l.price && (close - l.price) / close < 0.005)
    if (nearSup.length > 0) { score -= 5; warning = warning || `⚠ Support at $${nearSup[0].price} just below` }

    // ── LAYER 4: Indicator alignment RSI + EMA (15 pts) ────────────────────
    const rsiRecentHigh = Math.max(...inds.rsi.slice(-10).filter(v => v != null))
    const wasOverbought  = rsiRecentHigh > 70
    if      (rsiVal > 70)  { score += 8; reasons.push(`RSI overbought (${rsiVal}) — prime sell zone`) }
    else if (rsiVal > 60)  {
      if (wasOverbought) { score += 6; reasons.push(`RSI falling from OB (${rsiVal})`) }
      else               { score += 3; reasons.push(`RSI elevated (${rsiVal})`) }
    }
    else if (rsiVal > 50)  { score += 2; reasons.push(`RSI above midline (${rsiVal})`) }
    else if (rsiVal <= 25) { score -= 6; warning = `⚠ RSI oversold (${rsiVal}) — risky to sell` }
    else if (rsiVal <= 30) { score -= 3; warning = warning || `RSI low (${rsiVal}) — bounce risk` }
    if (divergence?.type === 'bearish') { score += 5; reasons.push('Bearish RSI divergence') }

    if (close < e200) { score += 3; reasons.push('Below EMA200 (long-term bear)') }
    if (close < e50)  { score += 2; reasons.push('Below EMA50') }
    if (close < e20)  { score += 2; reasons.push('Below EMA20') }
    if (e20 < e50 && e50 < e200) { score += 3; reasons.push('EMA stack bearish (20<50<200)') }
    if (!e20Rising && !e50Rising) { score += 2; reasons.push('EMA 20 & 50 falling') }

    // ── LAYER 5: Intermarket confluence (15 pts) ────────────────────────────
    // For SELL gold, intermarket should show dollar strength (low intermarket score)
    const imSellScore = 100 - intermarketScore
    const imPts = Math.round((imSellScore / 100) * 15)
    score += imPts
    if (imSellScore >= 65) reasons.push(`Intermarket bearish for gold (${imSellScore}/100)`)

    // ── LAYER 6: Volume (10 pts) ─────────────────────────────────────────────
    if (volRatio >= 2.0)      { score += 10; reasons.push(`Volume ${volRatio.toFixed(1)}× avg`) }
    else if (volRatio >= 1.5) { score += 7 }
    else if (volRatio >= 1.2) { score += 5 }
    else if (volRatio < 0.8)  { score -= 3 }

    // ── LAYER 7: Fibonacci (10 pts) ──────────────────────────────────────────
    if (fibData?.inGoldenZone) {
      score += 10; reasons.push(`In Fib golden zone at $${fibData.nearestPrice}`)
    } else if (fibData?.nearFib) {
      score += 5;  reasons.push(`Near Fib ${fibData.nearestLabel} at $${fibData.nearestPrice}`)
    }

    // ── Session bonus ────────────────────────────────────────────────────────
    score += sessionBonus

    // ── Regime filter ────────────────────────────────────────────────────────
    if (regime === 'VOLATILE') { score -= 20; warning = warning || '⚠ Volatile regime — signals unreliable' }

    if (score >= 40) {
      const sig = mkSignal('SELL', score, reasons, warning)
      if (sig) signals.push(sig)
    }
  }

  // ── Conflict resolution ───────────────────────────────────────────────────────
  if (signals.length === 2) {
    const [a, b] = signals
    if (a.score_raw > b.score_raw) return [a]
    if (b.confluence_score > a.confluence_score) return [b]
    return []   // exact tie — market is neutral, don't mislead traders
  }

  return signals
}
