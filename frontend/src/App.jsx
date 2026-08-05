import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, AlertTriangle, WifiOff, Database, Terminal } from 'lucide-react'
import { fetchChartData, fetchAllTrends, fetchTick } from './api'
import ChartContainer from './components/ChartContainer'
import Dashboard from './components/Dashboard'
import RegimeBadge from './components/RegimeBadge'
import NewsLockout from './components/NewsLockout'
import { TIMEFRAMES } from './constants'

export default function App() {
  const [timeframe,  setTimeframe]  = useState('1H')
  const [chartData,  setChartData]  = useState(null)
  const [allTrends,  setAllTrends]  = useState({})
  const [liveTick,   setLiveTick]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [connected,  setConnected]  = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const refreshRef = useRef(null)
  const tickRef    = useRef(null)

  const loadData = useCallback(async () => {
    try {
      const [data, trends] = await Promise.all([
        fetchChartData(timeframe),
        fetchAllTrends(),
      ])
      setChartData(data)
      setAllTrends(trends)
      setConnected(true)
      setError(null)
      setLastUpdate(new Date())
    } catch (err) {
      setError(err.message || 'Failed to fetch data')
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [timeframe])

  useEffect(() => {
    setLoading(true)
    loadData()
    refreshRef.current = setInterval(loadData, 1_000)
    return () => clearInterval(refreshRef.current)
  }, [loadData])

  useEffect(() => {
    const poll = async () => {
      try { setLiveTick(await fetchTick()) } catch { /* keep last tick */ }
    }
    poll()
    tickRef.current = setInterval(poll, 1_000)
    return () => clearInterval(tickRef.current)
  }, [])

  const trendColor = t =>
    t === 'uptrend' ? 'text-green-400' : t === 'downtrend' ? 'text-red-400' : 'text-yellow-400'

  const trendLabel = t => {
    if (t === 'uptrend')       return '▲ UP'
    if (t === 'downtrend')     return '▼ DN'
    if (t === 'consolidation') return '◆ RANGE'
    return '—'
  }

  const isMT5  = chartData?.data_source === 'MT5'
  const isSpot = chartData?.data_source === 'Spot'

  // Institutional layer data (embedded in chart response)
  const newsStatus  = chartData?.news     ?? null
  const sessionInfo = chartData?.session  ?? null
  const regimeData  = chartData?.regime   ?? null
  const riskStatus  = chartData?.risk     ?? null

  return (
    <div className="flex flex-col h-screen bg-[#0f1117] text-gray-100 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#131722] border-b border-gray-800 flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <span className="text-yellow-400 font-bold text-lg font-mono tracking-wide">XAU/USD</span>
          <span className="text-gray-600 text-xs">Gold · Spot</span>

          {chartData && (
            <div className="flex items-center gap-4 ml-3">
              <div className="flex flex-col">
                <span className="text-white font-bold font-mono text-xl leading-tight">
                  ${(liveTick?.price ?? chartData.stats.current_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                {liveTick && (
                  <div className="flex gap-2 text-xs font-mono leading-tight">
                    <span className="text-red-400">B {liveTick.bid?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    <span className="text-green-400">A {liveTick.ask?.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
              </div>
              <span className={`text-sm font-mono ${chartData.stats.daily_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {chartData.stats.daily_change >= 0 ? '+' : ''}{chartData.stats.daily_change}
                &nbsp;({chartData.stats.daily_change >= 0 ? '+' : ''}{chartData.stats.daily_change_pct}%)
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Regime badge */}
          {regimeData && regimeData.regime !== 'UNKNOWN' && (
            <RegimeBadge regime={regimeData} compact />
          )}

          {/* Data source badge */}
          {chartData && (
            <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${
              isMT5
                ? 'border-green-700/50 bg-green-900/20 text-green-400'
                : isSpot
                ? 'border-blue-700/50 bg-blue-900/20 text-blue-400'
                : 'border-amber-700/50 bg-amber-900/20 text-amber-400'
            }`}>
              {isMT5 ? <Terminal size={11} /> : <Database size={11} />}
              <span className="font-semibold">
                {isMT5 ? 'MetaTrader 5' : isSpot ? 'XAU/USD Spot' : 'Yahoo Finance (Futures)'}
              </span>
              {chartData.symbol && <span className="text-xs opacity-70">· {chartData.symbol}</span>}
            </div>
          )}

          {/* Live dot */}
          <div className="flex items-center gap-1.5 text-xs">
            {connected ? (
              <><span className="w-2 h-2 rounded-full bg-green-500 live-dot" /><span className="text-green-400">LIVE</span></>
            ) : (
              <><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-red-400">OFFLINE</span></>
            )}
          </div>

          {lastUpdate && (
            <span className="text-gray-600 text-xs hidden sm:block">{lastUpdate.toLocaleTimeString()}</span>
          )}

          <button onClick={loadData} className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="flex items-center gap-1 bg-amber-900/40 border border-amber-700/50 text-amber-400 text-xs px-2 py-1 rounded">
            <AlertTriangle size={11} />
            <span className="hidden sm:inline">Not Financial Advice</span>
          </div>
        </div>
      </header>

      {/* ── News Lockout Banner (full-width) ── */}
      {newsStatus && (
        <div className="flex-shrink-0 px-3 pt-1.5 pb-0 bg-[#0f1117]">
          <NewsLockout newsStatus={newsStatus} />
        </div>
      )}

      {/* ── Stat Strip ── */}
      {chartData && (
        <div className="flex items-center gap-5 px-4 py-1.5 bg-[#0f1117] border-b border-gray-800/60 text-xs flex-shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-gray-500">ATR(14)</span>
            <span className="text-white font-mono">{chartData.stats.atr}</span>
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-gray-500">RSI(14)</span>
            <span className={`font-mono ${chartData.stats.rsi > 70 ? 'text-red-400' : chartData.stats.rsi < 30 ? 'text-green-400' : 'text-white'}`}>
              {chartData.stats.rsi}
              {chartData.stats.rsi > 70 && <span className="ml-1 text-red-500">OB</span>}
              {chartData.stats.rsi < 30 && <span className="ml-1 text-green-500">OS</span>}
            </span>
          </div>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-gray-500">Trend</span>
            <span className={`font-semibold ${trendColor(chartData.trend)}`}>{trendLabel(chartData.trend)}</span>
          </div>
          {/* Session info */}
          {sessionInfo && (
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-gray-500">Session</span>
              <span className={`font-semibold ${
                sessionInfo.session === 'LONDON_NY' ? 'text-green-400'
                : sessionInfo.session === 'LONDON'  ? 'text-blue-400'
                : sessionInfo.session === 'NEW_YORK' ? 'text-blue-400'
                : 'text-gray-400'
              }`}>{sessionInfo.session?.replace('_', '-')}</span>
              {sessionInfo.bonus > 0 && <span className="text-gray-600">+{sessionInfo.bonus}pts</span>}
            </div>
          )}
          <div className="h-3 w-px bg-gray-800" />
          {TIMEFRAMES.map(tf => (
            <div key={tf} className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-gray-600 font-mono">{tf}</span>
              <span className={`font-semibold ${trendColor(allTrends[tf]?.trend)}`}>{trendLabel(allTrends[tf]?.trend)}</span>
            </div>
          ))}
          {chartData.divergence && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <div className={`flex items-center gap-1 ${chartData.divergence.type === 'bullish' ? 'text-green-400' : 'text-red-400'}`}>
                <span className="font-bold">DIV</span>
                <span className="text-gray-400">{chartData.divergence.description}</span>
              </div>
            </>
          )}
          {/* Risk warning */}
          {riskStatus?.blocked && (
            <>
              <div className="h-3 w-px bg-gray-800" />
              <div className="flex items-center gap-1 text-red-400">
                <AlertTriangle size={10} />
                <span className="font-semibold">RISK BLOCK</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Main Layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Chart Column */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Timeframe bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-[#131722] border-b border-gray-800 flex-shrink-0">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  timeframe === tf ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {tf}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3 text-xs text-gray-600">
              <span><span className="inline-block w-3 h-0.5 bg-blue-500 mr-1 align-middle" />EMA 20</span>
              <span><span className="inline-block w-3 h-0.5 bg-amber-500 mr-1 align-middle" />EMA 50</span>
              <span><span className="inline-block w-3 h-0.5 bg-red-500  mr-1 align-middle" />EMA 200</span>
              <span><span className="inline-block w-2 h-2 bg-green-500/30 border border-green-600 mr-1 align-middle" />S</span>
              <span><span className="inline-block w-2 h-2 bg-red-500/30  border border-red-600   mr-1 align-middle" />R</span>
            </div>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 relative">
            {loading && !chartData && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Fetching XAU/USD data…</span>
              </div>
            )}
            {error && !chartData && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 gap-2">
                <WifiOff size={32} className="text-gray-600" />
                <span className="text-sm">{error}</span>
                <span className="text-xs text-gray-600">Make sure the backend is running on port 8000</span>
                <button onClick={loadData} className="mt-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Retry</button>
              </div>
            )}
            {chartData && <ChartContainer data={chartData} timeframe={timeframe} />}
          </div>

        </div>

        {/* ── Right Sidebar ── */}
        <div className="w-64 xl:w-72 flex-shrink-0 border-l border-gray-800 bg-[#131722] overflow-y-auto hidden lg:flex lg:flex-col gap-0">
          {/* Market stats below */}
          <Dashboard chartData={chartData} allTrends={allTrends} loading={loading} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 bg-[#0a0a0f] border-t border-gray-900 px-4 py-1.5 text-center text-xs text-gray-700">
        Trading Gold involves substantial risk. All signals are educational tools only. Always use proper risk management. Not financial advice.
      </div>
    </div>
  )
}
