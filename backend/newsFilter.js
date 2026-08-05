// Economic Calendar News Filter
// Source 1: Forex Factory unofficial JSON feed
// Source 2: Manual lockout toggle

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOCKOUT_PATH = join(__dirname, 'news_lockout.json')

const CALENDAR_CACHE = { events: [], ts: 0 }
const CACHE_TTL      = 60 * 60 * 1000  // refresh calendar every hour

const GOLD_KEYWORDS = [
  'non-farm', 'nfp', 'fomc', 'federal funds', 'interest rate', 'cpi', 'core cpi',
  'gdp', 'ppi', 'pce', 'personal consumption', 'jobless', 'unemployment',
  'fed chair', 'fed governor', 'powell', 'yellen', 'inflation', 'consumer price',
  'producer price', 'retail sales', 'ism manufacturing', 'treasury', 'debt ceiling',
]

function readLockout() {
  try { return JSON.parse(readFileSync(LOCKOUT_PATH, 'utf8')) } catch { return { active: false, until: null } }
}
function writeLockout(d) { writeFileSync(LOCKOUT_PATH, JSON.stringify(d, null, 2)) }

export function setManualLockout(active, durationMinutes = 60) {
  writeLockout({
    active,
    until: active ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null,
    setAt: new Date().toISOString(),
  })
}

export async function fetchEconomicCalendar() {
  if (Date.now() - CALENDAR_CACHE.ts < CACHE_TTL && CALENDAR_CACHE.events.length > 0) {
    return CALENDAR_CACHE.events
  }

  const events = []
  const urls   = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
  ]

  await Promise.allSettled(
    urls.map(url =>
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
        .then(r => r.json())
        .then(arr => {
          if (!Array.isArray(arr)) return
          arr.forEach(ev => {
            if (ev.country !== 'USD' || ev.impact !== 'High') return
            const title = (ev.title ?? '').toLowerCase()
            if (!GOLD_KEYWORDS.some(k => title.includes(k))) return
            try {
              events.push({
                id:      `${ev.date}-${ev.title}`,
                title:   ev.title,
                time:    new Date(ev.date).toISOString(),
                impact:  ev.impact,
                country: ev.country,
              })
            } catch (_) {}
          })
        })
        .catch(() => {}) // silently skip if FF is unavailable
    )
  )

  // Deduplicate
  const seen = new Set()
  const unique = events.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  CALENDAR_CACHE.events = unique
  CALENDAR_CACHE.ts     = Date.now()
  return unique
}

export function getNewsStatus(events) {
  const now       = Date.now()
  const BUFFER_MS = 30 * 60 * 1000   // 30 min before/after

  // Manual lockout check
  const lockout = readLockout()
  if (lockout.active) {
    const expiry = lockout.until ? new Date(lockout.until).getTime() : Infinity
    if (now < expiry) {
      const remaining = lockout.until ? Math.ceil((expiry - now) / 60000) : null
      return { locked: true, manual: true, reason: 'Manual news lockout', countdown: remaining, event: null }
    }
    // Expired — clear
    writeLockout({ active: false, until: null })
  }

  // Auto lock around high-impact events
  for (const ev of events) {
    const evMs   = new Date(ev.time).getTime()
    const diff   = evMs - now

    if (diff > -BUFFER_MS && diff < BUFFER_MS) {
      const mins     = Math.round(Math.abs(diff) / 60000)
      const upcoming = diff > 0
      return {
        locked:    true,
        manual:    false,
        reason:    `${ev.title} — ${upcoming ? `in ${mins}m` : `${mins}m ago`}`,
        countdown: upcoming ? mins : -mins,
        event:     ev,
      }
    }
  }

  // Next upcoming event info (for display only — not locked)
  const next = events
    .filter(ev => new Date(ev.time).getTime() > now)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())[0] ?? null

  return { locked: false, manual: false, reason: null, countdown: null, event: next }
}
