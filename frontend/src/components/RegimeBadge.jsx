export default function RegimeBadge({ regime, adx, compact = false }) {
  const r = regime?.regime ?? regime ?? 'UNKNOWN'

  const cfg = {
    TRENDING:      { label: 'TRENDING',      cls: 'bg-green-900/40 border-green-600/50 text-green-300',  dot: 'bg-green-400' },
    RANGING:       { label: 'RANGING',       cls: 'bg-blue-900/40  border-blue-600/50  text-blue-300',   dot: 'bg-blue-400'  },
    VOLATILE:      { label: 'VOLATILE',      cls: 'bg-red-900/40   border-red-600/50   text-red-300',    dot: 'bg-red-400'   },
    TRANSITIONING: { label: 'TRANSITIONING', cls: 'bg-amber-900/40 border-amber-600/50 text-amber-300',  dot: 'bg-amber-400' },
    UNKNOWN:       { label: 'UNKNOWN',       cls: 'bg-gray-800     border-gray-700     text-gray-500',   dot: 'bg-gray-500'  },
  }

  const c = cfg[r] ?? cfg.UNKNOWN
  const adxVal = regime?.adx?.adx ?? adx ?? null

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-semibold ${c.cls}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
        {c.label}
        {adxVal != null && <span className="opacity-60 font-normal">ADX {adxVal}</span>}
      </span>
    )
  }

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded border ${c.cls}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
        <div>
          <div className="text-xs font-bold">{c.label}</div>
          <div className="text-xs opacity-60">Market Regime</div>
        </div>
      </div>
      {adxVal != null && (
        <div className="text-right">
          <div className="text-xs font-mono font-bold">{adxVal}</div>
          <div className="text-xs opacity-60">ADX(14)</div>
        </div>
      )}
    </div>
  )
}
