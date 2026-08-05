import { useEffect, useRef } from 'react'
import { createChart, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts'

const DARK = {
  layout: {
    background: { type: ColorType.Solid, color: '#0f1117' },
    textColor: '#6b7280',
    fontSize: 11,
    fontFamily: 'Inter, sans-serif',
  },
  grid: {
    vertLines: { color: '#1f2937' },
    horzLines: { color: '#1f2937' },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#374151' },
  timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false, rightOffset: 15 },
}

function paintSignalBadges(container, chartState, data) {
  if (!container || !chartState?.main || !chartState?.candles || !data?.candles?.length) return
  container.innerHTML = ''

  const { main, candles } = chartState
  const timeScale = main.timeScale()
  const candleList = data.candles

  ;(data.signals || []).forEach((sig) => {
    if (sig.entry == null || sig.blocked) return
    const isBuy = sig.direction === 'BUY'
    const targetSec = sig.lockedAt
      ? Math.floor(new Date(sig.lockedAt).getTime() / 1000)
      : candleList[candleList.length - 1].time

    let nearest = candleList[0]
    let minDiff = Infinity
    for (const c of candleList) {
      const diff = Math.abs(c.time - targetSec)
      if (diff < minDiff) { minDiff = diff; nearest = c }
    }

    const x = timeScale.timeToCoordinate(nearest.time)
    const y = candles.priceToCoordinate(isBuy ? nearest.low : nearest.high)
    if (x == null || y == null) return

    const gap = 8
    const wrapper = document.createElement('div')
    wrapper.className = `chart-signal-badge chart-signal-badge--${isBuy ? 'buy' : 'sell'}`
    wrapper.style.left = `${x}px`
    wrapper.style.top  = `${isBuy ? y + gap : y - gap}px`
    wrapper.style.transform = isBuy ? 'translate(-50%, 0)' : 'translate(-50%, -100%)'

    const tail = document.createElement('div')
    tail.className = 'chart-signal-badge__tail'
    const label = document.createElement('div')
    label.className = 'chart-signal-badge__label'
    label.textContent = isBuy ? 'BUY' : 'SELL'

    wrapper.appendChild(tail)
    wrapper.appendChild(label)
    container.appendChild(wrapper)
  })
}

export default function ChartContainer({ data, timeframe }) {
  const mainRef   = useRef(null)
  const badgesRef = useRef(null)
  const state     = useRef({})
  const lastFitTimeframe = useRef(null)
  const latestData = useRef(null)

  useEffect(() => {
    if (!mainRef.current) return

    const mainH = mainRef.current.clientHeight

    // ── Main chart ──
    const main = createChart(mainRef.current, {
      ...DARK,
      width: mainRef.current.clientWidth,
      height: mainH,
    })

    const candles = main.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })

    const volume = main.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    main.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    })

    const ema20 = main.addLineSeries({
      color: '#3b82f6', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      title: 'EMA20',
    })
    const ema50 = main.addLineSeries({
      color: '#f59e0b', lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      title: 'EMA50',
    })
    const ema200 = main.addLineSeries({
      color: '#ef4444', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false,
      title: 'EMA200',
    })

    // ── Resize ──
    const observer = new ResizeObserver(() => {
      if (mainRef.current) main.applyOptions({ width: mainRef.current.clientWidth })
      paintSignalBadges(badgesRef.current, state.current, latestData.current)
    })
    observer.observe(mainRef.current)

    // Reposition badges as the user pans/zooms the time axis
    const onRangeChange = () => paintSignalBadges(badgesRef.current, state.current, latestData.current)
    main.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange)

    state.current = { main, candles, volume, ema20, ema50, ema200, priceLines: [], signalLines: [], observer }

    return () => {
      main.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange)
      observer.disconnect()
      main.remove()
    }
  }, [])

  useEffect(() => {
    if (!data || !state.current.candles) return
    const { candles, volume, ema20, ema50, ema200, main } = state.current

    candles.setData(data.candles)
    volume.setData(data.volumes)
    ema20.setData(data.ema20)
    ema50.setData(data.ema50)
    ema200.setData(data.ema200)

    // ── Candlestick pattern markers ──
    if (data.patterns?.length) {
      const sorted = [...data.patterns].sort((a, b) => a.time - b.time)
      const markers = sorted.map((p) => ({
        time: p.time,
        position: p.type === 'bullish' ? 'belowBar' : p.type === 'bearish' ? 'aboveBar' : 'inBar',
        color: p.type === 'bullish' ? '#22c55e' : p.type === 'bearish' ? '#ef4444' : '#f59e0b',
        shape: p.type === 'bullish' ? 'arrowUp' : p.type === 'bearish' ? 'arrowDown' : 'circle',
        text: p.name,
        size: 1,
      }))
      candles.setMarkers(markers)
    } else {
      candles.setMarkers([])
    }

    // ── S/R price lines ──
    state.current.priceLines.forEach((pl) => {
      try { candles.removePriceLine(pl) } catch (_) {}
    })
    state.current.priceLines = (data.sr_levels || []).map((lvl) =>
      candles.createPriceLine({
        price: lvl.price,
        color: lvl.type === 'resistance' ? '#ef444480' : '#22c55e80',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: lvl.type === 'resistance' ? 'R' : 'S',
      })
    )

    // ── Clear previous signal price lines ──
    ;(state.current.signalLines || []).forEach(pl => { try { candles.removePriceLine(pl) } catch (_) {} })
    state.current.signalLines = []

    // ── BUY/SELL flag badges (custom HTML overlay, positioned on the firing candle) ──
    latestData.current = data
    paintSignalBadges(badgesRef.current, state.current, data)

    // Draw entry / SL / TP lines for each active signal
    ;(data.signals || []).forEach(sig => {
      const isBuy = sig.direction === 'BUY'
      const lines = [
        { price: sig.entry,         color: '#ffffff90', title: 'Entry',  style: LineStyle.Solid   },
        { price: sig.stop_loss,     color: '#ef444499', title: 'SL',     style: LineStyle.Dashed  },
        { price: sig.take_profit_1, color: '#22c55e70', title: 'TP1',    style: LineStyle.Dashed  },
        { price: sig.take_profit_2, color: '#22c55e99', title: 'TP2',    style: LineStyle.Dashed  },
        { price: sig.take_profit_3, color: '#22c55ebb', title: 'TP3',    style: LineStyle.Dashed  },
      ]
      lines.forEach(({ price, color, title, style }) => {
        const pl = candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
        state.current.signalLines.push(pl)
      })
    })

    // Only reset the visible range on first load or an actual timeframe switch —
    // not on every periodic data refresh, so live updates don't reset the user's zoom/pan.
    if (lastFitTimeframe.current !== timeframe) {
      main.timeScale().fitContent()
      lastFitTimeframe.current = timeframe
    }
  }, [data, timeframe])

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* Main OHLCV chart */}
      <div className="relative flex-1 min-h-0">
        <div ref={mainRef} className="absolute inset-0" />
        <div ref={badgesRef} className="absolute inset-0 overflow-hidden pointer-events-none" />
      </div>
    </div>
  )
}
