import { useEffect, useState } from 'react'
import { Activity, Clock, TrendingUp, TrendingDown } from 'lucide-react'
import { fetchPerformance } from '../api'

function StatCard({ label, value, sub, color, isEmpty }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 flex flex-col gap-1">
      <div className="text-xs text-gray-500">{label}</div>
      {isEmpty
        ? <div className="text-lg font-mono font-bold text-gray-700">—</div>
        : <div className={`text-lg font-mono font-bold ${color}`}>{value}</div>
      }
      <div className="text-xs text-gray-600">{sub}</div>
    </div>
  )
}

function WinLossBar({ winRate }) {
  const pct = winRate ?? 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-green-500 w-8">WIN</span>
      <div className="flex-1 bg-red-900/40 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 bg-green-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-red-500 w-8 text-right">LOSS</span>
    </div>
  )
}

function SignalRow({ sig, index }) {
  const isVoid    = sig.exit_status === 'cancelled'
  const isWin     = !isVoid && sig.profit_pct > 0
  const isLoss    = !isVoid && sig.profit_pct <= 0
  const dir       = sig.direction === 'BUY'

  const statusLabel = { tp1_hit: 'TP1', tp2_hit: 'TP2', tp3_hit: 'TP3', sl_hit: 'SL', cancelled: 'VOID' }[sig.exit_status] ?? sig.exit_status
  const statusCls   = {
    tp1_hit:   'text-green-400 bg-green-900/30',
    tp2_hit:   'text-green-300 bg-green-900/40',
    tp3_hit:   'text-green-200 bg-green-900/60 font-bold',
    sl_hit:    'text-red-400 bg-red-900/30',
    cancelled: 'text-gray-600 bg-gray-800/60',
  }[sig.exit_status] ?? 'text-gray-500 bg-gray-800'

  const pnlDisplay = isVoid ? '—' : `${isWin ? '+' : ''}${sig.profit_pct}%`
  const pnlCls     = isVoid ? 'text-gray-600' : isWin ? 'text-green-400' : 'text-red-400'

  const lockedTime = sig.locked_at
    ? new Date(sig.locked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded text-xs ${index % 2 === 0 ? 'bg-gray-900/30' : ''}`}>
      <span className="text-gray-700 w-5 font-mono">#{index + 1}</span>
      <span className={`font-bold w-8 ${dir ? 'text-green-400' : 'text-red-400'}`}>{sig.direction}</span>
      <span className="text-gray-500 w-8 font-mono">{sig.timeframe}</span>
      <span className={`px-1.5 py-0.5 rounded text-xs ${statusCls} w-12 text-center`}>{statusLabel}</span>
      <span className={`font-mono font-bold flex-1 ${pnlCls}`}>{pnlDisplay}</span>
      <span className="text-gray-600 w-10 font-mono text-right">{sig.duration_min}m</span>
      <span className="text-gray-700 w-11 font-mono text-right">{lockedTime}</span>
    </div>
  )
}

export default function PerformancePanel() {
  const [perf,    setPerf]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    const load = async () => {
      try {
        const d = await fetchPerformance()
        if (!dead) setPerf(d)
      } catch { /* no data yet */ }
      finally { if (!dead) setLoading(false) }
    }
    load()
    const iv = setInterval(load, 30_000)
    return () => { dead = true; clearInterval(iv) }
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">
      Loading…
    </div>
  )

  if (!perf || perf.total === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
      <Activity size={28} className="text-gray-700" />
      <span className="text-sm font-medium">No resolved signals yet</span>
      <span className="text-xs text-center max-w-xs text-gray-700">
        Results appear here once signals hit a target (TP) or stop loss (SL).
        Cancelled setups are tracked separately and don't affect win rate.
      </span>
    </div>
  )

  const net1hColor  = perf.net_1h  > 0 ? 'text-green-400' : perf.net_1h  < 0 ? 'text-red-400' : 'text-gray-500'
  const net24hColor = perf.net_24h > 0 ? 'text-green-400' : perf.net_24h < 0 ? 'text-red-400' : 'text-gray-500'
  const noTrades    = perf.wins === 0 && perf.losses === 0

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">

        <StatCard
          label="Win Rate"
          isEmpty={noTrades}
          value={`${perf.win_rate}%`}
          sub={noTrades
            ? `${perf.cancelled} cancelled, no TP/SL yet`
            : `${perf.wins}W · ${perf.losses}L · ${perf.cancelled} void`}
          color={perf.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}
        />

        <StatCard
          label="Avg Win"
          isEmpty={perf.avg_profit === null}
          value={`+${perf.avg_profit}%`}
          sub="per TP exit"
          color="text-green-400"
        />

        <StatCard
          label="Avg Loss"
          isEmpty={perf.avg_loss === null}
          value={`${perf.avg_loss}%`}
          sub="per SL exit"
          color="text-red-400"
        />

        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 flex items-center gap-1">
              <Clock size={10} /> 1H P&amp;L
            </div>
            <div className="text-xs text-gray-500">24H</div>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <div className={`text-lg font-mono font-bold ${perf.net_1h === 0 ? 'text-gray-600' : net1hColor}`}>
              {perf.net_1h === 0 ? '—' : `${perf.net_1h > 0 ? '+' : ''}${perf.net_1h}%`}
            </div>
            <div className={`text-sm font-mono font-bold ${perf.net_24h === 0 ? 'text-gray-600' : net24hColor}`}>
              {perf.net_24h === 0 ? '—' : `${perf.net_24h > 0 ? '+' : ''}${perf.net_24h}%`}
            </div>
          </div>
          <div className="text-xs text-gray-700">TP/SL exits only</div>
        </div>
      </div>

      {/* Win/loss bar — only show when there are actual trades */}
      {!noTrades && (
        <div className="flex-shrink-0">
          <WinLossBar winRate={perf.win_rate} />
          <div className="flex justify-between text-xs text-gray-700 mt-0.5 px-0.5">
            <span>{perf.wins} wins</span>
            <span>{perf.losses} losses</span>
          </div>
        </div>
      )}

      {/* Only cancelled so far — explain clearly */}
      {noTrades && perf.cancelled > 0 && (
        <div className="flex-shrink-0 bg-gray-800/40 border border-gray-700/40 rounded px-3 py-2 text-xs text-gray-500 text-center">
          {perf.cancelled} signal{perf.cancelled > 1 ? 's' : ''} were cancelled before hitting any target.
          Win rate will show once a signal closes via TP or SL.
        </div>
      )}

      {/* Signal history */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 border-b border-gray-800/60 sticky top-0 bg-[#131722]">
          <span className="w-5">#</span>
          <span className="w-8">Dir</span>
          <span className="w-8">TF</span>
          <span className="w-12">Exit</span>
          <span className="flex-1">P&amp;L</span>
          <span className="w-10 text-right">Dur</span>
          <span className="w-11 text-right">Time</span>
        </div>
        {perf.signals.map((sig, i) => (
          <SignalRow key={sig.id} sig={sig} index={i} />
        ))}
      </div>
    </div>
  )
}
