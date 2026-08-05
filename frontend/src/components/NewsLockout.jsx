import { AlertTriangle, Lock, Clock } from 'lucide-react'

export default function NewsLockout({ newsStatus }) {
  if (!newsStatus) return null

  const { locked, reason, countdown, event } = newsStatus

  const nextEvent = newsStatus.event
  const nearSoon  = nextEvent && !locked && (() => {
    const diff = new Date(nextEvent.time).getTime() - Date.now()
    return diff > 0 && diff < 2 * 60 * 60 * 1000
  })()

  if (!locked && !nearSoon) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900/40 rounded border border-gray-800 text-xs text-gray-500">
        <Clock size={10} />
        {nextEvent
          ? <span>Next event: <span className="text-gray-400">{nextEvent.title}</span> at {new Date(nextEvent.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          : <span>No upcoming high-impact events</span>
        }
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-1.5 px-3 py-2 rounded border text-xs ${
      locked
        ? 'bg-red-950/60 border-red-700/60 text-red-300'
        : 'bg-amber-950/40 border-amber-700/40 text-amber-300'
    }`}>
      {locked ? <Lock size={10} /> : <AlertTriangle size={10} />}
      <span className="font-semibold">{locked ? 'News Lockout Active' : 'Event Approaching'}</span>
      {reason && <span className="opacity-75">{reason}</span>}
      {countdown != null && Math.abs(countdown) < 120 && (
        <span className="font-mono font-bold">
          {countdown > 0 ? `in ${countdown}m` : `${Math.abs(countdown)}m ago`}
        </span>
      )}
      {nextEvent && !locked && (
        <span>{nextEvent.title} at {new Date(nextEvent.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      )}
    </div>
  )
}
