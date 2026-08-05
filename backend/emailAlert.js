// Signal Email Alerts — fires a Gmail notification the instant a BUY/SELL
// signal locks in on any timeframe.

import nodemailer from 'nodemailer'

const GMAIL_USER     = process.env.GMAIL_USER
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS
const ALERT_TO       = process.env.ALERT_EMAIL_TO

let transporter = null
if (GMAIL_USER && GMAIL_APP_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS },
  })
} else {
  console.warn('[Email] GMAIL_USER / GMAIL_APP_PASS not set in backend/.env — signal alert emails are disabled.')
}

export async function sendSignalAlert(timeframe, signal) {
  if (!transporter || !ALERT_TO) return

  const isBuy = signal.direction === 'BUY'
  const subject = `${isBuy ? '🟢 BUY' : '🔴 SELL'} signal — XAU/USD ${timeframe} @ ${signal.entry}`

  const text = [
    `${signal.direction} signal fired on the ${timeframe} timeframe`,
    ``,
    `Entry:        ${signal.entry}`,
    `Stop Loss:    ${signal.stop_loss}`,
    `Take Profit 1: ${signal.take_profit_1}`,
    `Take Profit 2: ${signal.take_profit_2}`,
    `Take Profit 3: ${signal.take_profit_3}`,
    `Score:        ${signal.score_raw ?? '?'}/100 (${signal.score_grade ?? '—'})`,
    `RSI:          ${signal.rsi ?? '—'}`,
    `Regime:       ${signal.regime ?? '—'}`,
    ``,
    `Educational tool only — not financial advice.`,
  ].join('\n')

  try {
    await transporter.sendMail({
      from:    GMAIL_USER,
      to:      ALERT_TO,
      subject,
      text,
    })
    console.log(`[Email] Alert sent — ${signal.direction} ${timeframe} @ ${signal.entry}`)
  } catch (err) {
    console.error('[Email] Failed to send alert:', err.message)
  }
}
