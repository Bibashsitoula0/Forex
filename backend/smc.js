// Smart Money Concepts + Technical Tools
// ADX, Order Blocks, Fair Value Gaps, BOS/CHoCH, Liquidity Sweeps, Fibonacci

// ── ADX (Wilder's Average Directional Index) ───────────────────────────────
export function calculateADX(highs, lows, closes, period = 14) {
  const n = closes.length
  if (n < period * 2 + 2) return { adx: null, plusDI: null, minusDI: null }

  const plusDMs = [], minusDMs = [], trs = []
  for (let i = 1; i < n; i++) {
    const up   = highs[i] - highs[i - 1]
    const down = lows[i - 1] - lows[i]
    plusDMs.push(up > down && up > 0 ? up : 0)
    minusDMs.push(down > up && down > 0 ? down : 0)
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ))
  }

  // Wilder's initial smooth (sum of first `period` values)
  let sTR = trs.slice(0, period).reduce((a, b) => a + b, 0)
  let sPDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  let sMDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0)

  const dxArr = []
  let pDI = 0, mDI = 0

  for (let i = period; i < trs.length; i++) {
    sTR  = sTR  - sTR  / period + trs[i]
    sPDM = sPDM - sPDM / period + plusDMs[i]
    sMDM = sMDM - sMDM / period + minusDMs[i]
    pDI  = sTR > 0 ? (sPDM / sTR) * 100 : 0
    mDI  = sTR > 0 ? (sMDM / sTR) * 100 : 0
    const diSum = pDI + mDI
    dxArr.push(diSum > 0 ? Math.abs(pDI - mDI) / diSum * 100 : 0)
  }

  if (dxArr.length < period) return { adx: null, plusDI: null, minusDI: null }

  // Smooth DX into ADX
  let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dxArr.length; i++) {
    adxVal = (adxVal * (period - 1) + dxArr[i]) / period
  }

  return {
    adx:     +adxVal.toFixed(2),
    plusDI:  +pDI.toFixed(2),
    minusDI: +mDI.toFixed(2),
  }
}

// ── Market Regime Detection ────────────────────────────────────────────────
export function detectRegime(adxResult, atrArr) {
  const { adx } = adxResult
  if (adx == null) return { regime: 'UNKNOWN', adx: null }

  const validATRs = atrArr.filter(v => v != null)
  const avgATR    = validATRs.slice(-20).reduce((a, b) => a + b, 0) / Math.min(validATRs.length, 20)
  const lastATR   = validATRs[validATRs.length - 1] ?? 0

  let regime
  if (lastATR > avgATR * 1.5) regime = 'VOLATILE'
  else if (adx > 25)          regime = 'TRENDING'
  else if (adx < 20)          regime = 'RANGING'
  else                        regime = 'TRANSITIONING'

  return { regime, adx, plusDI: adxResult.plusDI, minusDI: adxResult.minusDI, avgATR: +avgATR.toFixed(2) }
}

// ── Order Block Detection ──────────────────────────────────────────────────
// Bullish OB: last bearish candle before a strong bullish impulse
// Bearish OB: last bullish candle before a strong bearish impulse
export function detectOrderBlocks(candles, lookback = 60) {
  const n     = candles.length
  const start = Math.max(0, n - lookback - 2)
  const result = []

  for (let i = start + 1; i < n - 1; i++) {
    const c    = candles[i]
    const next = candles[i + 1]
    const body = Math.abs(c.close - c.open)
    if (body < 0.01) continue

    // Bullish OB: bearish candle followed by impulse up
    if (c.close < c.open && next.close > c.high) {
      result.push({ type: 'bullish', high: +c.high.toFixed(2), low: +c.low.toFixed(2), time: c.time })
    }
    // Bearish OB: bullish candle followed by impulse down
    if (c.close > c.open && next.close < c.low) {
      result.push({ type: 'bearish', high: +c.high.toFixed(2), low: +c.low.toFixed(2), time: c.time })
    }
  }

  const close = candles[n - 1].close
  return result.slice(-10).map(ob => ({
    ...ob,
    touched: close >= ob.low && close <= ob.high,
    active:  ob.type === 'bullish' ? close >= ob.low : close <= ob.high,
  }))
}

// ── Fair Value Gap (FVG) Detection ────────────────────────────────────────
// Bullish FVG: candle[i-2].high < candle[i].low  → gap between them
// Bearish FVG: candle[i-2].low  > candle[i].high → gap between them
export function detectFVG(candles, lookback = 40) {
  const n     = candles.length
  const start = Math.max(2, n - lookback)
  const result = []

  for (let i = start; i < n; i++) {
    const c0 = candles[i - 2]
    const c1 = candles[i - 1]
    const c2 = candles[i]

    if (c2.low > c0.high + 0.05) {
      result.push({ type: 'bullish', top: +c2.low.toFixed(2), bottom: +c0.high.toFixed(2), time: c1.time })
    }
    if (c2.high < c0.low - 0.05) {
      result.push({ type: 'bearish', top: +c0.low.toFixed(2), bottom: +c2.high.toFixed(2), time: c1.time })
    }
  }

  const close = candles[n - 1].close
  // Only return unfilled FVGs
  return result
    .filter(fvg => fvg.type === 'bullish' ? close > fvg.bottom : close < fvg.top)
    .slice(-6)
    .map(fvg => ({
      ...fvg,
      touched: close >= fvg.bottom && close <= fvg.top,
      midpoint: +((fvg.top + fvg.bottom) / 2).toFixed(2),
    }))
}

// ── SMC: Break of Structure + Change of Character ─────────────────────────
export function detectSMC(candles) {
  const n = candles.length
  if (n < 12) return { bos: null, choch: null, structure: 'unknown', swings: [] }

  const slice  = candles.slice(-50)
  const swings = []

  for (let i = 3; i < slice.length - 3; i++) {
    const isHigh = slice[i].high > slice[i-1].high && slice[i].high > slice[i-2].high &&
                   slice[i].high > slice[i+1].high && slice[i].high > slice[i+2].high
    const isLow  = slice[i].low  < slice[i-1].low  && slice[i].low  < slice[i-2].low  &&
                   slice[i].low  < slice[i+1].low   && slice[i].low  < slice[i+2].low
    if (isHigh) swings.push({ type: 'high', price: slice[i].high, time: slice[i].time })
    if (isLow)  swings.push({ type: 'low',  price: slice[i].low,  time: slice[i].time })
  }

  const highs = swings.filter(s => s.type === 'high')
  const lows  = swings.filter(s => s.type === 'low')
  const close = candles[n - 1].close
  const prev  = candles[n - 2].close

  let bos = null, choch = null, structure = 'neutral'

  if (highs.length >= 2 && lows.length >= 2) {
    const lH = highs[highs.length - 1], pH = highs[highs.length - 2]
    const lL = lows[lows.length - 1],   pL = lows[lows.length - 2]
    const hh = lH.price > pH.price, hl = lL.price > pL.price
    const lh = lH.price < pH.price, ll = lL.price < pL.price

    if (hh && hl) structure = 'bullish'
    if (lh && ll) structure = 'bearish'

    // BOS: break in direction of current structure
    if (structure === 'bullish' && close > lH.price && prev <= lH.price)
      bos = { type: 'bullish', price: +lH.price.toFixed(2), label: 'BOS ↑' }
    if (structure === 'bearish' && close < lL.price && prev >= lL.price)
      bos = { type: 'bearish', price: +lL.price.toFixed(2), label: 'BOS ↓' }

    // CHoCH: break AGAINST current structure (reversal signal)
    if (structure === 'bearish' && close > lH.price && prev <= lH.price)
      choch = { type: 'bullish', price: +lH.price.toFixed(2), label: 'CHoCH ↑' }
    if (structure === 'bullish' && close < lL.price && prev >= lL.price)
      choch = { type: 'bearish', price: +lL.price.toFixed(2), label: 'CHoCH ↓' }
  }

  return { bos, choch, structure, swings: swings.slice(-12) }
}

// ── Liquidity Sweep Detection ──────────────────────────────────────────────
// A sweep = wick pierces recent high/low but CLOSES back inside
export function detectLiquiditySweeps(candles, lookback = 25) {
  const n      = candles.length
  const sweeps = []

  for (let i = Math.max(12, n - lookback); i < n; i++) {
    const c      = candles[i]
    const window = candles.slice(i - 11, i - 1)
    if (window.length < 5) continue
    const rHigh = Math.max(...window.map(x => x.high))
    const rLow  = Math.min(...window.map(x => x.low))

    if (c.high > rHigh && c.close < rHigh)
      sweeps.push({ type: 'bearish_sweep', price: +rHigh.toFixed(2), time: c.time, label: 'Liq Sweep ↑' })
    if (c.low < rLow && c.close > rLow)
      sweeps.push({ type: 'bullish_sweep', price: +rLow.toFixed(2), time: c.time, label: 'Liq Sweep ↓' })
  }

  return sweeps.slice(-4)
}

// ── Fibonacci Retracement ──────────────────────────────────────────────────
export function calculateFibonacci(candles, lookback = 60) {
  const slice = candles.slice(-lookback)
  const high  = Math.max(...slice.map(c => c.high))
  const low   = Math.min(...slice.map(c => c.low))
  const range = high - low
  if (range < 1) return null

  const close  = candles[candles.length - 1].close
  const levels = {
    '0%':    +high.toFixed(2),
    '23.6%': +(high - range * 0.236).toFixed(2),
    '38.2%': +(high - range * 0.382).toFixed(2),
    '50%':   +(high - range * 0.500).toFixed(2),
    '61.8%': +(high - range * 0.618).toFixed(2),
    '78.6%': +(high - range * 0.786).toFixed(2),
    '100%':  +low.toFixed(2),
  }

  const gz_top = levels['61.8%']
  const gz_bot = levels['78.6%']
  const inGoldenZone = close <= gz_top && close >= gz_bot

  // Find nearest Fibonacci level
  let nearestLabel = '', nearestDist = Infinity
  Object.entries(levels).forEach(([label, price]) => {
    const d = Math.abs(close - price)
    if (d < nearestDist) { nearestDist = d; nearestLabel = label }
  })

  // ATR for proximity check
  const atrSlice = slice.slice(-14)
  const avgATR = atrSlice.reduce((s, c, i, a) => {
    if (!i) return s
    return s + Math.max(c.high - c.low, Math.abs(c.high - a[i-1].close), Math.abs(c.low - a[i-1].close))
  }, 0) / Math.max(atrSlice.length - 1, 1)

  return {
    swingHigh:     +high.toFixed(2),
    swingLow:      +low.toFixed(2),
    levels,
    inGoldenZone,
    nearFib:       nearestDist < avgATR * 0.6,
    nearestLabel,
    nearestPrice:  levels[nearestLabel],
    goldenZoneTop: gz_top,
    goldenZoneBot: gz_bot,
  }
}
