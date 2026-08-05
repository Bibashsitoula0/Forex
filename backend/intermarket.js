// Intermarket Analysis: DXY, US10Y, SPX, BTC
// Gold typically rallies when: DXY falls, yields fall, risk-off sentiment
// Cache TTL: 5 minutes (data doesn't change faster than that)

const CACHE     = { data: null, ts: 0 }
const CACHE_TTL = 5 * 60 * 1000

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':     'application/json',
}

async function fetchYFSymbol(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`
  const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('No result')
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter(v => v != null)
  if (closes.length < 2) throw new Error('Insufficient data')
  const cur  = closes[closes.length - 1]
  const prev = closes[closes.length - 2]
  return {
    price:     +cur.toFixed(4),
    changePct: +((cur - prev) / prev * 100).toFixed(3),
    direction: cur > prev ? 'up' : 'down',
  }
}

export async function fetchIntermarket() {
  if (Date.now() - CACHE.ts < CACHE_TTL && CACHE.data) return CACHE.data

  const raw = {}
  const errors = []

  await Promise.allSettled([
    fetchYFSymbol('DX-Y.NYB').then(d => { raw.dxy = d }).catch(e => errors.push(`DXY: ${e.message}`)),
    fetchYFSymbol('^TNX').then(d  => { raw.tnx = d }).catch(e => errors.push(`TNX: ${e.message}`)),
    fetchYFSymbol('^GSPC').then(d => { raw.spx = d }).catch(e => errors.push(`SPX: ${e.message}`)),
    fetchYFSymbol('BTC-USD').then(d => { raw.btc = d }).catch(e => errors.push(`BTC: ${e.message}`)),
  ])

  // Compute bullish-for-gold confluence score (0-100)
  // Rule: gold likes weak dollar, falling yields, risk-off (weak SPX)
  let score = 50
  const notes = []
  const confluences = []

  if (raw.dxy) {
    if (raw.dxy.changePct < -0.4) {
      score += 15
      confluences.push(`DXY weakening ${raw.dxy.changePct}% ✓`)
    } else if (raw.dxy.changePct < -0.15) {
      score += 7
      confluences.push(`DXY slightly weak ${raw.dxy.changePct}%`)
    } else if (raw.dxy.changePct > 0.4) {
      score -= 15
      confluences.push(`DXY strengthening ${raw.dxy.changePct}% ✗`)
    } else if (raw.dxy.changePct > 0.15) {
      score -= 7
    } else {
      notes.push(`DXY flat ${raw.dxy.changePct}%`)
    }
  }

  if (raw.tnx) {
    if (raw.tnx.changePct < -1.5) {
      score += 15
      confluences.push(`Yields falling ${raw.tnx.changePct}% ✓`)
    } else if (raw.tnx.changePct < -0.5) {
      score += 7
      confluences.push(`Yields easing ${raw.tnx.changePct}%`)
    } else if (raw.tnx.changePct > 1.5) {
      score -= 15
      confluences.push(`Yields rising ${raw.tnx.changePct}% ✗`)
    } else if (raw.tnx.changePct > 0.5) {
      score -= 7
    } else {
      notes.push(`Yields flat ${raw.tnx.changePct}%`)
    }
  }

  if (raw.spx) {
    if (raw.spx.changePct < -1.0) {
      score += 10
      confluences.push(`Risk-off: SPX ${raw.spx.changePct}% ✓`)
    } else if (raw.spx.changePct > 1.5) {
      score -= 8
      confluences.push(`Risk-on: SPX ${raw.spx.changePct}% ✗`)
    }
  }

  if (raw.btc) {
    if (raw.btc.changePct > 3) {
      score += 5
      confluences.push(`BTC bullish ${raw.btc.changePct}% (anti-dollar)`)
    } else if (raw.btc.changePct < -5) {
      score -= 5
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  const data = {
    dxy:         raw.dxy  ?? null,
    tnx:         raw.tnx  ?? null,
    spx:         raw.spx  ?? null,
    btc:         raw.btc  ?? null,
    score,
    confluences,
    notes,
    errors,
    bullishGold: score >= 60,
    bearishGold: score <= 40,
    timestamp:   new Date().toISOString(),
  }

  CACHE.data = data
  CACHE.ts   = Date.now()
  return data
}
