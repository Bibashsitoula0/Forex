// Trading Session Filter
// Gold (XAU/USD) has different characteristics per session

export function getSessionInfo() {
  const now   = new Date()
  const hUTC  = now.getUTCHours()
  const mUTC  = now.getUTCMinutes()
  const total = hUTC * 60 + mUTC
  const day   = now.getUTCDay()  // 0=Sun, 5=Fri, 6=Sat

  // Weekend / thin liquidity blocks
  if (day === 6)                     return mkResult('WEEKEND',      false, 0,  'Weekend — markets closed')
  if (day === 0 && hUTC < 2)        return mkResult('SUNDAY_OPEN',  false, 0,  'Sunday open — first 2h liquidity thin')
  if (day === 5 && hUTC >= 18)      return mkResult('FRIDAY_CLOSE', false, 0,  'Friday after 18:00 UTC — no new signals')

  // Sessions (all times UTC)
  if (total >= 0   && total < 480)  return mkResult('ASIAN',           true,  6,  'Asian session — range signals only',         ['RANGE'])
  if (total >= 480 && total < 780)  return mkResult('LONDON',          true,  10, 'London session — trend & breakout preferred', ['TREND','BREAKOUT','RANGE'])
  if (total >= 780 && total < 960)  return mkResult('LONDON_NY',       true,  15, 'London-NY overlap — highest probability',     ['TREND','BREAKOUT','RANGE','REVERSAL'])
  if (total >= 960 && total < 1320) return mkResult('NEW_YORK',        true,  10, 'New York session — all signal types',         ['TREND','BREAKOUT','RANGE'])
  return                                    mkResult('DEAD_ZONE',       true,  4,  'Low-activity window 22:00-00:00 UTC',         ['RANGE'])
}

function mkResult(session, allowed, bonus, description, types = []) {
  return { session, allowed, bonus, description, types, timestamp: new Date().toISOString() }
}

export function sessionLabel(session) {
  return {
    ASIAN:        '🌏 Asian',
    LONDON:       '🇬🇧 London',
    LONDON_NY:    '⚡ London-NY Overlap',
    NEW_YORK:     '🗽 New York',
    DEAD_ZONE:    '💤 Dead Zone',
    WEEKEND:      '🔒 Weekend',
    SUNDAY_OPEN:  '⚠ Sunday Open',
    FRIDAY_CLOSE: '⚠ Friday Close',
  }[session] ?? session
}
