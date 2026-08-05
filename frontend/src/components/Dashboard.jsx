import { TrendingUp, TrendingDown, Minus, Activity, BarChart2, Target } from 'lucide-react'
import { TIMEFRAMES } from '../constants'

function TrendBadge({ trend }) {
  if (trend === 'uptrend')
    return <span className="flex items-center gap-1 text-green-400 text-xs font-semibold"><TrendingUp size={11} />Uptrend</span>
  if (trend === 'downtrend')
    return <span className="flex items-center gap-1 text-red-400 text-xs font-semibold"><TrendingDown size={11} />Downtrend</span>
  if (trend === 'consolidation')
    return <span className="flex items-center gap-1 text-yellow-400 text-xs font-semibold"><Minus size={11} />Range</span>
  return <span className="text-gray-600 text-xs">—</span>
}

function StatRow({ label, value, valueClass = 'text-white' }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/60">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`text-xs font-mono font-medium ${valueClass}`}>{value}</span>
    </div>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-800">
        <Icon size={11} />
        {title}
      </div>
      <div className="px-3">{children}</div>
    </div>
  )
}

export default function Dashboard({ chartData, allTrends, loading }) {
  if (loading && !chartData) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
        Loading…
      </div>
    )
  }

  if (!chartData) return null

  const { stats, trend, sr_levels, signals, patterns } = chartData

  const rsiColor = stats.rsi > 70 ? 'text-red-400' : stats.rsi < 30 ? 'text-green-400' : 'text-white'
  const changeColor = stats.daily_change >= 0 ? 'text-green-400' : 'text-red-400'

  const supports = (sr_levels || []).filter((l) => l.type === 'support').slice(-3).reverse()
  const resistances = (sr_levels || []).filter((l) => l.type === 'resistance').slice(-3)

  return (
    <div className="text-sm py-2">
      {/* Price Section */}
      <Section title="Market" icon={Activity}>
        <StatRow label="Price" value={`$${stats.current_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
        <StatRow
          label="Change"
          value={`${stats.daily_change >= 0 ? '+' : ''}${stats.daily_change} (${stats.daily_change >= 0 ? '+' : ''}${stats.daily_change_pct}%)`}
          valueClass={changeColor}
        />
        <StatRow label="ATR (14)" value={stats.atr} />
        <StatRow
          label="RSI (14)"
          value={`${stats.rsi}${stats.rsi > 70 ? ' OB' : stats.rsi < 30 ? ' OS' : ''}`}
          valueClass={rsiColor}
        />
        <StatRow label="EMA 20" value={stats.ema20} />
        <StatRow label="EMA 50" value={stats.ema50} />
        <StatRow label="EMA 200" value={stats.ema200} />
      </Section>

      {/* Multi-Timeframe Trend */}
      <Section title="Trend MTF" icon={BarChart2}>
        {TIMEFRAMES.map((tf) => (
          <div key={tf} className="flex items-center justify-between py-1.5 border-b border-gray-800/60">
            <span className="text-gray-500 text-xs font-mono">{tf}</span>
            <TrendBadge trend={allTrends[tf]?.trend} />
          </div>
        ))}
      </Section>

      {/* Support & Resistance — nearest level per timeframe */}
      <Section title="S/R by Timeframe" icon={Target}>
        {TIMEFRAMES.map((tf) => {
          const d = allTrends[tf]
          return (
            <div key={tf} className="flex items-center justify-between py-1.5 border-b border-gray-800/60">
              <span className="text-gray-500 text-xs font-mono">{tf}</span>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className="text-red-400">{d?.resistance ? `R ${d.resistance.price.toLocaleString()}` : '—'}</span>
                <span className="text-green-400">{d?.support ? `S ${d.support.price.toLocaleString()}` : '—'}</span>
              </div>
            </div>
          )
        })}
      </Section>

      {/* Latest candlestick pattern per timeframe */}
      <Section title="Patterns by Timeframe" icon={Activity}>
        {TIMEFRAMES.map((tf) => {
          const p = allTrends[tf]?.pattern
          const typeColor = p?.type === 'bullish' ? 'text-green-400' : p?.type === 'bearish' ? 'text-red-400' : 'text-yellow-400'
          return (
            <div key={tf} className="flex items-center justify-between py-1.5 border-b border-gray-800/60">
              <span className="text-gray-500 text-xs font-mono">{tf}</span>
              <span className={`text-xs font-semibold ${p ? typeColor : 'text-gray-600'}`}>{p?.name ?? '—'}</span>
            </div>
          )
        })}
      </Section>

      {/* Support & Resistance — active timeframe detail */}
      <Section title="Key Levels" icon={Target}>
        {resistances.length > 0 && (
          <div className="mb-1">
            <div className="text-xs text-red-500 mb-1">Resistance</div>
            {resistances.map((lvl, i) => (
              <div key={i} className="flex justify-between items-center py-0.5">
                <span className="text-gray-600 text-xs">R{i + 1}</span>
                <span className="text-red-400 font-mono text-xs">${lvl.price.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {supports.length > 0 && (
          <div className="mt-1">
            <div className="text-xs text-green-500 mb-1">Support</div>
            {supports.map((lvl, i) => (
              <div key={i} className="flex justify-between items-center py-0.5">
                <span className="text-gray-600 text-xs">S{i + 1}</span>
                <span className="text-green-400 font-mono text-xs">${lvl.price.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {resistances.length === 0 && supports.length === 0 && (
          <div className="text-gray-600 text-xs py-2">No levels detected</div>
        )}
      </Section>

      {/* Recent Patterns */}
      {patterns?.length > 0 && (
        <Section title="Patterns" icon={Activity}>
          {patterns.slice(-5).reverse().map((p, i) => (
            <div key={i} className="flex items-center justify-between py-1 border-b border-gray-800/60">
              <span className="text-gray-400 text-xs">{p.name}</span>
              <span className={`text-xs font-semibold ${p.type === 'bullish' ? 'text-green-400' : p.type === 'bearish' ? 'text-red-400' : 'text-yellow-400'}`}>
                {p.type}
              </span>
            </div>
          ))}
        </Section>
      )}

      {/* Active Signals Summary */}
      {signals?.length > 0 && (
        <Section title="Signals" icon={Activity}>
          {signals.map((sig, i) => (
            <div key={i} className={`flex items-center justify-between py-1.5 border-b border-gray-800/60`}>
              <span className={`text-xs font-bold ${sig.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {sig.direction}
              </span>
              <span className="text-gray-400 text-xs">Score: <span className="text-white font-mono">{sig.confluence_score}/10</span></span>
            </div>
          ))}
        </Section>
      )}

      {/* Disclaimer */}
      <div className="mx-3 mt-2 p-2 bg-amber-900/20 border border-amber-800/40 rounded text-amber-600 text-xs leading-relaxed">
        Educational tool only. Not financial advice. Gold is highly volatile. Always use a stop loss.
      </div>
    </div>
  )
}
