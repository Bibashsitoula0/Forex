// App Settings Manager — per-layer toggles + risk params

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PATH      = join(__dirname, 'app_settings.json')

export const DEFAULTS = {
  layers: {
    regime:      true,
    intermarket: true,
    news:        true,
    session:     true,
    volume:      true,
    smc:         true,
    fibonacci:   true,
    risk:        true,
    backtest:    true,
  },
  risk: {
    maxDailyLoss:         3,    // % of account
    maxConsecutiveLosses: 3,
    maxSpread:            25,   // pips
    accountBalance:       5000, // USD
    riskPerTrade:         1,    // % of account
  },
  signal: {
    minScore:      40,   // out of 100 — below this, no signal
    premiumScore:  80,
    standardScore: 65,
  },
}

export function readSettings() {
  try {
    return deepMerge(DEFAULTS, JSON.parse(readFileSync(PATH, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeSettings(patch) {
  const merged = deepMerge(readSettings(), patch)
  writeFileSync(PATH, JSON.stringify(merged, null, 2))
  return merged
}

function deepMerge(base, patch) {
  const out = { ...base }
  for (const key of Object.keys(patch ?? {})) {
    if (
      patch[key] !== null &&
      typeof patch[key] === 'object' &&
      !Array.isArray(patch[key]) &&
      typeof base[key] === 'object'
    ) {
      out[key] = deepMerge(base[key] ?? {}, patch[key])
    } else {
      out[key] = patch[key]
    }
  }
  return out
}
