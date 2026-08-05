"""
MetaTrader 5 Bridge Server
--------------------------
Wraps the official MetaTrader5 Python API and exposes it over HTTP (port 8001).
The Node.js backend calls this to get real broker data for XAU/USD.

Requirements:
  - MetaTrader 5 terminal installed and RUNNING (logged in to your broker)
  - Python 3.8+  (install from https://python.org)
  - pip install MetaTrader5 flask

Run:
  python mt5_server.py
"""

import sys
import time
import threading
from datetime import datetime, timezone
from flask import Flask, jsonify, request

try:
    import MetaTrader5 as mt5
except ImportError:
    print("\n[ERROR] MetaTrader5 package not found.")
    print("  Run:  pip install MetaTrader5 flask\n")
    sys.exit(1)

app = Flask(__name__)

# ─── MT5 Connection ────────────────────────────────────────────────────────────

GOLD_SYMBOLS = [
    "XAUUSD", "GOLD", "XAUUSDm", "XAUUSDc",
    "XAUUSD.", "GOLD.pro", "XAUUSD+", "XAUUSDx",
]

_symbol   = None   # detected gold symbol
_mt5_ok   = False  # connection state
_mt5_lock = threading.Lock()  # MetaTrader5 API calls aren't safe across concurrent threads


def find_gold_symbol():
    """Auto-detect the broker's gold symbol name."""
    # Try known names first
    for name in GOLD_SYMBOLS:
        info = mt5.symbol_info(name)
        if info is not None:
            mt5.symbol_select(name, True)
            print(f"[MT5] Gold symbol: {name}")
            return name

    # Broad search through all broker symbols
    all_symbols = mt5.symbols_get() or []
    for s in all_symbols:
        n = s.name.upper()
        if "XAU" in n or ("GOLD" in n and "USD" in n):
            mt5.symbol_select(s.name, True)
            print(f"[MT5] Gold symbol found by search: {s.name}")
            return s.name

    return None


def init_mt5():
    global _symbol, _mt5_ok
    if not mt5.initialize():
        code, msg = mt5.last_error()
        print(f"[MT5] initialize() failed: {code} — {msg}")
        print("      Make sure MetaTrader 5 is open and logged in.")
        _mt5_ok = False
        return False

    info = mt5.terminal_info()
    acct = mt5.account_info()
    print(f"\n[MT5] Connected!")
    print(f"      Terminal : {info.name}  build {info.build}")
    print(f"      Server   : {acct.server if acct else '?'}")
    print(f"      Account  : {acct.login if acct else '?'}  ({acct.currency if acct else '?'})")
    print(f"      Balance  : {acct.balance if acct else '?'}\n")

    _symbol = find_gold_symbol()
    if not _symbol:
        print("[MT5] WARNING: Could not find XAUUSD/GOLD symbol on this broker!")
        print("      Check Market Watch in MT5 and add the gold symbol manually.")

    _mt5_ok = True
    return True


def reconnect_loop():
    """Background thread: reconnect if MT5 terminal is restarted."""
    global _mt5_ok
    while True:
        time.sleep(30)
        if not _mt5_ok:
            print("[MT5] Attempting reconnect...")
            init_mt5()
        else:
            # Ping to verify still connected
            with _mt5_lock:
                still_up = mt5.terminal_info() is not None
            if not still_up:
                print("[MT5] Lost connection. Will retry...")
                _mt5_ok = False


# ─── Timeframes ────────────────────────────────────────────────────────────────

TF_MAP = {
    "1m":  mt5.TIMEFRAME_M1  if hasattr(mt5, 'TIMEFRAME_M1')  else 1,
    "5m":  mt5.TIMEFRAME_M5  if hasattr(mt5, 'TIMEFRAME_M5')  else 5,
    "15m": mt5.TIMEFRAME_M15 if hasattr(mt5, 'TIMEFRAME_M15') else 15,
    "30m": mt5.TIMEFRAME_M30 if hasattr(mt5, 'TIMEFRAME_M30') else 30,
    "1H":  mt5.TIMEFRAME_H1  if hasattr(mt5, 'TIMEFRAME_H1')  else 16385,
    "4H":  mt5.TIMEFRAME_H4  if hasattr(mt5, 'TIMEFRAME_H4')  else 16388,
    "1D":  mt5.TIMEFRAME_D1  if hasattr(mt5, 'TIMEFRAME_D1')  else 16408,
    "1W":  mt5.TIMEFRAME_W1  if hasattr(mt5, 'TIMEFRAME_W1')  else 32769,
}

TF_BARS = {
    "1m":  500,
    "5m":  500,
    "15m": 500,
    "30m": 500,
    "1H":  500,
    "4H":  500,
    "1D":  365,
    "1W":  260,
}

# ─── Helper ────────────────────────────────────────────────────────────────────

def error(msg, code=500):
    return jsonify({"error": msg}), code


def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


# ─── Routes ────────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    with _mt5_lock:
        terminal = mt5.terminal_info()
        account  = mt5.account_info()
    return jsonify({
        "status":    "ok" if _mt5_ok else "disconnected",
        "connected": _mt5_ok,
        "symbol":    _symbol,
        "terminal":  terminal.name  if terminal else None,
        "build":     terminal.build if terminal else None,
        "server":    account.server if account  else None,
        "login":     account.login  if account  else None,
        "company":   account.company if account else None,
    })


@app.route("/candles/<timeframe>")
def candles(timeframe):
    if not _mt5_ok:
        return error("MT5 not connected", 503)
    if not _symbol:
        return error("Gold symbol not found on this broker", 503)

    tf = TF_MAP.get(timeframe)
    if tf is None:
        return error(f"Invalid timeframe: {timeframe}", 400)

    count = TF_BARS.get(timeframe, 500)
    with _mt5_lock:
        rates = mt5.copy_rates_from_pos(_symbol, tf, 0, count)

    if rates is None or len(rates) == 0:
        code, msg = mt5.last_error()
        return error(f"copy_rates_from_pos failed: {code} — {msg}", 503)

    result = []
    for r in rates:
        result.append({
            "time":   int(r["time"]),
            "open":   round(float(r["open"]),   2),
            "high":   round(float(r["high"]),   2),
            "low":    round(float(r["low"]),    2),
            "close":  round(float(r["close"]),  2),
            "volume": int(r["tick_volume"]),    # real tick volume from broker
        })

    return jsonify({
        "symbol":    _symbol,
        "timeframe": timeframe,
        "count":     len(result),
        "candles":   result,
        "source":    "MT5",
    })


@app.route("/tick")
def tick():
    if not _mt5_ok or not _symbol:
        return error("MT5 not ready", 503)

    with _mt5_lock:
        t   = mt5.symbol_info_tick(_symbol)
        sym = mt5.symbol_info(_symbol) if t else None
    if not t:
        return error("No tick data", 503)

    digits  = sym.digits  if sym else 2
    pt      = sym.point   if sym else 0.01
    spread  = int(round((t.ask - t.bid) / pt)) if pt > 0 else 0

    return jsonify({
        "symbol":     _symbol,
        "bid":        round(t.bid,  digits),
        "ask":        round(t.ask,  digits),
        "last":       round(t.last, digits) if t.last else None,
        "spread_pts": spread,
        "spread_usd": round(t.ask - t.bid, digits),
        "time":       int(t.time),
        "time_str":   datetime.fromtimestamp(t.time, tz=timezone.utc).isoformat(),
    })


@app.route("/account")
def account():
    if not _mt5_ok:
        return error("MT5 not connected", 503)

    with _mt5_lock:
        a = mt5.account_info()
    if not a:
        return error("Cannot get account info", 503)

    margin_level = round((a.equity / a.margin * 100), 2) if a.margin and a.margin > 0 else None

    return jsonify({
        "login":        a.login,
        "name":         a.name,
        "server":       a.server,
        "company":      a.company,
        "currency":     a.currency,
        "leverage":     a.leverage,
        "balance":      round(a.balance,      2),
        "equity":       round(a.equity,       2),
        "margin":       round(a.margin,       2),
        "free_margin":  round(a.margin_free,  2),
        "margin_level": margin_level,
        "profit":       round(a.profit,       2),
        "trade_allowed": a.trade_allowed,
    })


@app.route("/positions")
def positions():
    if not _mt5_ok:
        return error("MT5 not connected", 503)

    with _mt5_lock:
        pos = mt5.positions_get(symbol=_symbol) or []
    result = []
    for p in pos:
        result.append({
            "ticket":     p.ticket,
            "symbol":     p.symbol,
            "type":       "BUY"  if p.type == 0 else "SELL",
            "volume":     p.volume,
            "open_price": round(p.price_open,    2),
            "current":    round(p.price_current, 2),
            "sl":         round(p.sl, 2) if p.sl else None,
            "tp":         round(p.tp, 2) if p.tp else None,
            "profit":     round(p.profit, 2),
            "swap":       round(p.swap,   2),
            "comment":    p.comment,
            "open_time":  int(p.time),
        })

    return jsonify(result)


@app.route("/symbol")
def symbol_info():
    if not _mt5_ok or not _symbol:
        return error("MT5 not ready", 503)

    with _mt5_lock:
        s = mt5.symbol_info(_symbol)
    if not s:
        return error("Symbol info unavailable", 503)

    return jsonify({
        "name":            s.name,
        "description":     s.description,
        "digits":          s.digits,
        "spread":          s.spread,
        "point":           s.point,
        "contract_size":   s.trade_contract_size,
        "min_lot":         s.volume_min,
        "max_lot":         s.volume_max,
        "lot_step":        s.volume_step,
        "currency_base":   s.currency_base,
        "currency_profit": s.currency_profit,
        "swap_long":       s.swap_long,
        "swap_short":      s.swap_short,
        "margin_initial":  s.margin_initial,
        "session_open":    s.session_open  if s.session_open  else None,
        "session_close":   s.session_close if s.session_close else None,
    })


# ─── Start ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "="*55)
    print("  MetaTrader 5 Bridge Server")
    print("  Port: 8001")
    print("="*55)

    if not init_mt5():
        print("\n[WARNING] Starting in offline mode — MT5 not connected.")
        print("          Open MetaTrader 5, log in, then restart this server.\n")

    # Background reconnect thread
    t = threading.Thread(target=reconnect_loop, daemon=True)
    t.start()

    print("[MT5 Bridge] Listening on http://localhost:8001\n")
    app.run(host="0.0.0.0", port=8001, debug=False, use_reloader=False, threaded=True)
