# XAU/USD Gold Trading Analysis

A full-stack, real-time trading dashboard for gold (XAU/USD) that layers
institutional-style technical analysis — market regime, Smart Money Concepts,
intermarket confluence, news/session filters, and risk management — into a
single confluence-scored signal feed, with charting, backtesting, and a trade
journal.

> ⚠️ **Not financial advice.** All signals are educational/analytical tools.
> Trading gold and leveraged instruments carries substantial risk of loss.

## Overview

The app polls live/historical XAU/USD candles, runs them through a stack of
independent analysis "layers," and combines the results into a 0–100
confluence score per signal. Signals are locked (frozen entry/SL/TP) the
moment they fire and tracked to resolution (SL/TP/expiry) for a running
performance history.

```
┌─────────────────────┐        HTTP (proxied /api)       ┌──────────────────────┐
│  Frontend (Vite/React)  ───────────────────────────────▶│  Backend (Node/Express) │
│  http://localhost:5173  │                                │  http://localhost:8000  │
└─────────────────────┘                                    └───────────┬──────────┘
                                                                        │ optional
                                                             ┌──────────▼──────────┐
                                                             │  MT5 Bridge (Python)  │
                                                             │  http://localhost:8001│
                                                             └──────────┬──────────┘
                                                                        │
                                                              MetaTrader 5 terminal
                                                              (real broker data)

Fallback data sources (no MT5 required): Yahoo Finance (GC=F futures) +
Swissquote (spot mid-price, used to convert futures → spot).
```

## Features

**Data & charting**
- 4 timeframes: 15m, 1H, 4H, 1D
- Candlestick chart (`lightweight-charts`) with EMA 20/50/200, volume, support/resistance
- Live bid/ask tick polling (5s) and full analysis refresh (60s)
- Automatic data source fallback: MetaTrader 5 → Yahoo Finance → Swissquote spot adjustment

**Analysis layers** (each toggleable in Settings)
| Layer | What it does |
|---|---|
| Market Regime | Wilder's ADX + ATR → classifies TRENDING / RANGING / VOLATILE / TRANSITIONING |
| Smart Money Concepts (SMC) | Order blocks, Fair Value Gaps (FVG), BOS/CHoCH structure, liquidity sweeps |
| Fibonacci | Auto retracement/extension levels from detected swings |
| Intermarket Confluence | DXY, US10Y (TNX), S&P 500, BTC — scores gold bullishness 0–100 |
| Session Filter | Asian / London / London-NY overlap / New York / Dead Zone, with per-session signal-type allowances and score bonus |
| News Filter | Forex Factory high-impact USD calendar (NFP, FOMC, CPI, etc.) with auto lockout window + manual lockout toggle |
| Risk Filter | Daily loss limit, consecutive-loss anti-tilt pause, spread check |
| Signal Engine | EMA trend, RSI divergence, candlestick patterns, S/R — combined into a 0–100 confluence score, gated by a minimum-score threshold |

**Trading tools**
- Signal lock: entry/SL/TP freeze the instant a signal fires; tracked live to `tp1`/`tp2`/`tp3`/`sl`/`cancelled`
- Multi-timeframe signal overview panel
- Backtest engine — simulates the signal logic over historical candles (win rate, profit factor, drawdown, equity curve)
- Signal performance history (win rate, avg win/loss, 1h/24h net)
- Position-size / risk calculator
- Manual trade journal (CRUD)
- Optional MetaTrader 5 integration: live account info, open positions, and trade execution (when the MT5 bridge is connected)

## Tech stack

| | |
|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS, lightweight-charts, axios, lucide-react |
| Backend | Node.js, Express 4 (ES modules), no database — flat JSON files for state |
| MT5 bridge (optional) | Python 3.8+, Flask, `MetaTrader5` package |
| External data | Yahoo Finance (chart API), Swissquote (spot quote), Forex Factory (economic calendar) |

## Project structure

```
c:\Forex
├── start.bat                 # one-click launcher (Windows)
├── backend/
│   ├── server.js              # Express app, all /api routes, data-source orchestration
│   ├── indicators.js          # EMA/ATR/RSI, S/R, trend, divergence, patterns, signal generation
│   ├── smc.js                 # ADX, regime detection, order blocks, FVG, liquidity sweeps, Fibonacci
│   ├── intermarket.js         # DXY/US10Y/SPX/BTC confluence scoring
│   ├── newsFilter.js          # Forex Factory calendar + lockout logic
│   ├── sessionFilter.js       # Trading-session classification
│   ├── riskFilter.js          # Daily loss / consecutive-loss / spread checks
│   ├── settingsManager.js     # Reads/writes app_settings.json (layer toggles, risk, score thresholds)
│   ├── backtest.js            # Historical signal simulation engine
│   ├── *.json                 # Flat-file state: settings, journal, risk state, news lockout, performance history
│   └── mt5_bridge/
│       ├── mt5_server.py      # Flask HTTP wrapper around the MetaTrader5 Python API
│       ├── install.bat        # Installs Python deps for the bridge
│       └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx             # Main layout, timeframe/tab state, polling
    │   ├── api.js              # Axios client for all backend endpoints
    │   └── components/         # Chart, Dashboard, TradeSignalCard, RiskCalculator, TradeJournal,
    │                            # MT5Panel, PerformancePanel, RegimeBadge, IntermarketPanel,
    │                            # MultiTFSignalPanel, BacktestPanel, NewsLockout, SettingsPanel
    ├── vite.config.js          # Dev server on :5173, proxies /api → :8000
    └── tailwind.config.js
```

## Getting started

### Prerequisites
- [Node.js](https://nodejs.org) 18+
- (Optional, for real broker data) Python 3.8+ and a running MetaTrader 5 terminal logged into a broker

### Quick start (Windows)
Double-click **`start.bat`** — it installs npm dependencies on first run, detects an optional MT5 bridge, and starts both servers.

### Manual start
```bash
# Backend — http://localhost:8000
cd backend
npm install
npm start          # or: npm run dev (nodemon, auto-restart)

# Frontend — http://localhost:5173
cd frontend
npm install
npm run dev
```
Open **http://localhost:5173**. Without MT5, the backend automatically serves Yahoo Finance / Swissquote data — no extra setup required.

### Optional: MetaTrader 5 bridge (real broker data)
```bash
cd backend/mt5_bridge
install.bat                # installs MetaTrader5 + flask via pip
# Open MetaTrader 5 and log in to your broker, then:
python mt5_server.py        # starts the bridge on :8001
```
The Node backend polls `/health` on the bridge every 30s and switches data sources automatically depending on availability.

## API reference (backend, port 8000)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Backend + data-source status |
| GET | `/api/tick` | Live bid/ask |
| GET | `/api/data/:timeframe` | Full analysis payload (candles, indicators, signals, all layers) |
| GET | `/api/trends` | Trend for all 4 timeframes |
| GET | `/api/all-signals` | Lightweight signal snapshot across all timeframes |
| GET | `/api/intermarket` | DXY/US10Y/SPX/BTC confluence |
| GET | `/api/session` | Current trading session info |
| GET | `/api/news` | Economic calendar + lockout status |
| POST | `/api/news/lockout` | Set/clear manual news lockout |
| GET | `/api/risk` | Risk filter status |
| GET | `/api/regime/:timeframe` | ADX-based market regime |
| GET / PATCH | `/api/settings` | Read/update app settings (layer toggles, risk params, score thresholds) |
| GET | `/api/backtest/:timeframe` | Run historical backtest |
| GET | `/api/performance` | Signal win-rate / P&L history |
| GET / POST / DELETE | `/api/journal` | Trade journal CRUD |
| GET | `/api/mt5/status` `/tick` `/account` `/positions` `/symbol` | MT5 bridge passthrough (503 if not connected) |
| POST | `/api/mt5/execute` | Place a trade via the MT5 bridge |

## Configuration

Settings are stored in `backend/app_settings.json` (created from defaults on first write) and editable via the Settings tab or `PATCH /api/settings`:
- `layers.*` — enable/disable each analysis layer independently
- `risk.*` — max daily loss %, max consecutive losses, max spread, account balance, risk per trade %
- `signal.*` — minimum score to emit a signal, premium/standard score thresholds

## Disclaimer

This project is for educational and research purposes only. It does not
constitute financial advice, and past backtest performance is not indicative
of future results. Use at your own risk.
