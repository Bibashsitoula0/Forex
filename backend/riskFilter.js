// Risk Filter — pre-signal safety checks
// Tracks daily P&L and consecutive losses to prevent over-trading

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(__dirname, 'risk_state.json')

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) }
  catch { return { date: '', dailyLossPct: 0, consecutiveLosses: 0, tradesToday: 0 } }
}

function writeState(s) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)) }

function todayUTC() { return new Date().toISOString().slice(0, 10) }

export function checkRiskFilters(settings, liveTick) {
  let state = readState()
  const today = todayUTC()

  if (state.date !== today) {
    state = { date: today, dailyLossPct: 0, consecutiveLosses: 0, tradesToday: 0 }
    writeState(state)
  }

  const warnings  = []
  let blocked      = false
  let blockReason  = null

  const maxDailyLoss  = settings?.risk?.maxDailyLoss          ?? 3
  const maxConsecLoss = settings?.risk?.maxConsecutiveLosses   ?? 3
  const maxSpread     = settings?.risk?.maxSpread              ?? 25

  // 1. Daily loss limit
  if (state.dailyLossPct <= -maxDailyLoss) {
    blocked     = true
    blockReason = `Daily loss limit hit: ${state.dailyLossPct.toFixed(2)}% (limit: ${maxDailyLoss}%)`
  }

  // 2. Consecutive losses → anti-tilt pause
  if (state.consecutiveLosses >= maxConsecLoss) {
    blocked     = true
    blockReason = `${maxConsecLoss} consecutive losses — 24h pause to avoid tilt`
  }

  // 3. Spread check
  if (liveTick?.bid && liveTick?.ask) {
    const spreadPips = +((liveTick.ask - liveTick.bid) * 10).toFixed(1)
    if (spreadPips > maxSpread) {
      warnings.push(`Wide spread: ${spreadPips} pips (max ${maxSpread}) — slippage risk`)
    }
  }

  return {
    blocked,
    blockReason,
    warnings,
    dailyLossPct:       state.dailyLossPct,
    consecutiveLosses:  state.consecutiveLosses,
    tradesToday:        state.tradesToday,
  }
}

export function recordSignalResult(profitPct) {
  let state = readState()
  const today = todayUTC()

  if (state.date !== today) {
    state = { date: today, dailyLossPct: 0, consecutiveLosses: 0, tradesToday: 0 }
  }

  state.dailyLossPct      = +(state.dailyLossPct + profitPct).toFixed(4)
  state.tradesToday       = (state.tradesToday || 0) + 1
  state.consecutiveLosses = profitPct < 0
    ? (state.consecutiveLosses || 0) + 1
    : 0

  writeState(state)
}
