from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
import sqlite3
from datetime import datetime
from typing import Optional
import warnings
warnings.filterwarnings("ignore")

app = FastAPI(title="XAU/USD Trading Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "trading_journal.db"


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            timeframe TEXT,
            direction TEXT,
            entry_price REAL,
            exit_price REAL,
            stop_loss REAL,
            take_profit REAL,
            result TEXT,
            pnl REAL,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


init_db()


# ─── Indicators ────────────────────────────────────────────────────────────────

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def calc_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(span=period, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(span=period, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50)


def find_sr_levels(high: pd.Series, low: pd.Series, window: int = 5, last_n: int = 50):
    h = high.tail(last_n).reset_index(drop=True)
    lo = low.tail(last_n).reset_index(drop=True)
    levels = []

    for i in range(window, len(h) - window):
        is_sh = all(h.iloc[i] >= h.iloc[i - j] for j in range(1, window + 1)) and \
                all(h.iloc[i] >= h.iloc[i + j] for j in range(1, window + 1))
        is_sl = all(lo.iloc[i] <= lo.iloc[i - j] for j in range(1, window + 1)) and \
                all(lo.iloc[i] <= lo.iloc[i + j] for j in range(1, window + 1))
        if is_sh:
            levels.append({"price": round(float(h.iloc[i]), 2), "type": "resistance"})
        if is_sl:
            levels.append({"price": round(float(lo.iloc[i]), 2), "type": "support"})

    if not levels:
        return []
    levels.sort(key=lambda x: x["price"])
    merged = [levels[0]]
    for lvl in levels[1:]:
        if (lvl["price"] - merged[-1]["price"]) / merged[-1]["price"] < 0.004:
            merged[-1]["price"] = round((merged[-1]["price"] + lvl["price"]) / 2, 2)
        else:
            merged.append(lvl)
    return merged


# ─── Pattern Detection ─────────────────────────────────────────────────────────

def detect_patterns(df: pd.DataFrame, lookback: int = 5):
    patterns = []
    o, h, lo, c = df["Open"], df["High"], df["Low"], df["Close"]
    n = len(df)

    for i in range(max(1, n - lookback), n):
        co, ch, cl, cc = float(o.iloc[i]), float(h.iloc[i]), float(lo.iloc[i]), float(c.iloc[i])
        po, ph, pl, pc = float(o.iloc[i - 1]), float(h.iloc[i - 1]), float(lo.iloc[i - 1]), float(c.iloc[i - 1])
        body = abs(cc - co)
        rng = ch - cl
        if rng < 1e-9:
            continue
        upper_wick = ch - max(co, cc)
        lower_wick = min(co, cc) - cl
        ts = int(df.index[i].timestamp())

        if lower_wick >= 2 * body and upper_wick <= 0.4 * body and cc > co:
            patterns.append({"name": "Hammer", "type": "bullish", "time": ts})
        if upper_wick >= 2 * body and lower_wick <= 0.4 * body and cc < co:
            patterns.append({"name": "Shooting Star", "type": "bearish", "time": ts})
        if cc > co and pc < po and co <= pc and cc >= po:
            patterns.append({"name": "Bullish Engulfing", "type": "bullish", "time": ts})
        if cc < co and pc > po and co >= pc and cc <= po:
            patterns.append({"name": "Bearish Engulfing", "type": "bearish", "time": ts})
        if body <= 0.08 * rng:
            patterns.append({"name": "Doji", "type": "neutral", "time": ts})

    return patterns


def detect_trend(df: pd.DataFrame) -> str:
    if len(df) < 20:
        return "consolidation"
    h = df["High"].tail(20).values
    lo = df["Low"].tail(20).values
    swing_highs, swing_lows = [], []

    for i in range(2, 18):
        if h[i] > h[i - 1] and h[i] > h[i - 2] and h[i] > h[i + 1] and h[i] > h[i + 2]:
            swing_highs.append(h[i])
        if lo[i] < lo[i - 1] and lo[i] < lo[i - 2] and lo[i] < lo[i + 1] and lo[i] < lo[i + 2]:
            swing_lows.append(lo[i])

    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return "consolidation"

    hh = swing_highs[-1] > swing_highs[-2]
    hl = swing_lows[-1] > swing_lows[-2]
    lh = swing_highs[-1] < swing_highs[-2]
    ll = swing_lows[-1] < swing_lows[-2]

    if hh and hl:
        return "uptrend"
    if lh and ll:
        return "downtrend"
    return "consolidation"


def detect_rsi_divergence(close: pd.Series, rsi: pd.Series):
    if len(close) < 20:
        return None
    rc = close.tail(20)
    rr = rsi.tail(20)
    price_ll = float(rc.iloc[-1]) < float(rc.iloc[10])
    rsi_hl = float(rr.iloc[-1]) > float(rr.iloc[10])
    price_hh = float(rc.iloc[-1]) > float(rc.iloc[10])
    rsi_lh = float(rr.iloc[-1]) < float(rr.iloc[10])

    if price_ll and rsi_hl and float(rr.iloc[-1]) < 45:
        return {"type": "bullish", "description": "Price lower lows, RSI higher lows — bullish divergence"}
    if price_hh and rsi_lh and float(rr.iloc[-1]) > 55:
        return {"type": "bearish", "description": "Price higher highs, RSI lower highs — bearish divergence"}
    return None


# ─── Signal Generation ─────────────────────────────────────────────────────────

def generate_signals(df, inds, patterns, sr_levels, trend, divergence):
    close = float(df["Close"].iloc[-1])
    atr_val = float(inds["atr"].iloc[-1])
    rsi_val = float(inds["rsi"].iloc[-1])
    e20 = float(inds["ema20"].iloc[-1])
    e50 = float(inds["ema50"].iloc[-1])
    e200 = float(inds["ema200"].iloc[-1])
    signals = []

    def build_signal(direction, score, reasons):
        if direction == "BUY":
            sl = round(close - 1.5 * atr_val, 2)
            risk = abs(close - sl)
            tp1 = round(close + risk, 2)
            tp2 = round(close + risk * 2, 2)
            tp3 = round(close + risk * 3, 2)
        else:
            sl = round(close + 1.5 * atr_val, 2)
            risk = abs(sl - close)
            tp1 = round(close - risk, 2)
            tp2 = round(close - risk * 2, 2)
            tp3 = round(close - risk * 3, 2)
        return {
            "direction": direction,
            "entry": round(close, 2),
            "stop_loss": sl,
            "take_profit_1": tp1,
            "take_profit_2": tp2,
            "take_profit_3": tp3,
            "confluence_score": min(round(score, 1), 10),
            "rr_ratio": 1.0,
            "stop_distance": round(risk, 2),
            "reasons": reasons,
            "atr": round(atr_val, 2),
            "rsi": round(rsi_val, 1),
        }

    # BUY conditions
    b_score, b_reasons = 0.0, []
    if close > e20: b_score += 1; b_reasons.append("Price above 20 EMA")
    if close > e50: b_score += 1; b_reasons.append("Price above 50 EMA")
    if close > e200: b_score += 1; b_reasons.append("Price above 200 EMA")
    if e20 > e50 > e200: b_score += 2; b_reasons.append("Bullish EMA alignment (20>50>200)")
    if trend == "uptrend": b_score += 2; b_reasons.append("Confirmed uptrend (HH + HL)")
    if rsi_val < 30: b_score += 2; b_reasons.append(f"RSI oversold ({rsi_val:.1f}) — reversal zone")
    elif 35 < rsi_val < 55: b_score += 0.5; b_reasons.append(f"RSI neutral ({rsi_val:.1f})")
    if divergence and divergence["type"] == "bullish":
        b_score += 2; b_reasons.append("Bullish RSI divergence detected")
    for p in patterns:
        if p["type"] == "bullish":
            b_score += 1.5; b_reasons.append(f"{p['name']} candlestick pattern")
    for lvl in sr_levels:
        if lvl["type"] == "support" and 0 < (close - lvl["price"]) / close < 0.008:
            b_score += 1.5; b_reasons.append(f"Price near support at {lvl['price']:.2f}")

    if b_score >= 4:
        signals.append(build_signal("BUY", b_score, b_reasons))

    # SELL conditions
    s_score, s_reasons = 0.0, []
    if close < e20: s_score += 1; s_reasons.append("Price below 20 EMA")
    if close < e50: s_score += 1; s_reasons.append("Price below 50 EMA")
    if close < e200: s_score += 1; s_reasons.append("Price below 200 EMA")
    if e20 < e50 < e200: s_score += 2; s_reasons.append("Bearish EMA alignment (20<50<200)")
    if trend == "downtrend": s_score += 2; s_reasons.append("Confirmed downtrend (LH + LL)")
    if rsi_val > 70: s_score += 2; s_reasons.append(f"RSI overbought ({rsi_val:.1f}) — exhaustion zone")
    if divergence and divergence["type"] == "bearish":
        s_score += 2; s_reasons.append("Bearish RSI divergence detected")
    for p in patterns:
        if p["type"] == "bearish":
            s_score += 1.5; s_reasons.append(f"{p['name']} candlestick pattern")
    for lvl in sr_levels:
        if lvl["type"] == "resistance" and 0 < (lvl["price"] - close) / close < 0.008:
            s_score += 1.5; s_reasons.append(f"Price near resistance at {lvl['price']:.2f}")

    if s_score >= 4:
        signals.append(build_signal("SELL", s_score, s_reasons))

    return signals


# ─── Data Fetching ─────────────────────────────────────────────────────────────

TIMEFRAME_CONFIG = {
    "15m": {"interval": "15m", "period": "5d", "resample": None},
    "1H":  {"interval": "1h",  "period": "30d", "resample": None},
    "4H":  {"interval": "1h",  "period": "90d", "resample": "4h"},
    "1D":  {"interval": "1d",  "period": "365d", "resample": None},
}


def fetch_gold(timeframe: str) -> pd.DataFrame:
    cfg = TIMEFRAME_CONFIG.get(timeframe)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")
    ticker = yf.Ticker("GC=F")
    df = ticker.history(period=cfg["period"], interval=cfg["interval"])
    if df.empty:
        raise HTTPException(status_code=503, detail="No data returned from Yahoo Finance")
    if cfg["resample"]:
        df = df.resample(cfg["resample"]).agg(
            {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}
        ).dropna()
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    return df


def to_candles(df: pd.DataFrame):
    result = []
    for ts, row in df.iterrows():
        t = int(ts.timestamp())
        result.append({
            "time": t,
            "open": round(float(row["Open"]), 2),
            "high": round(float(row["High"]), 2),
            "low":  round(float(row["Low"]), 2),
            "close": round(float(row["Close"]), 2),
        })
    return result


def to_line(series: pd.Series, df: pd.DataFrame):
    result = []
    for ts, val in zip(df.index, series):
        if pd.notna(val):
            result.append({"time": int(ts.timestamp()), "value": round(float(val), 2)})
    return result


def to_volumes(df: pd.DataFrame):
    result = []
    for ts, row in df.iterrows():
        is_bull = float(row["Close"]) >= float(row["Open"])
        result.append({
            "time": int(ts.timestamp()),
            "value": float(row["Volume"]),
            "color": "#22c55e55" if is_bull else "#ef444455",
        })
    return result


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/data/{timeframe}")
def get_data(timeframe: str):
    df = fetch_gold(timeframe)

    inds = {
        "ema20":  calc_ema(df["Close"], 20),
        "ema50":  calc_ema(df["Close"], 50),
        "ema200": calc_ema(df["Close"], 200),
        "atr":    calc_atr(df["High"], df["Low"], df["Close"]),
        "rsi":    calc_rsi(df["Close"]),
    }

    sr_levels  = find_sr_levels(df["High"], df["Low"])
    patterns   = detect_patterns(df)
    trend      = detect_trend(df)
    divergence = detect_rsi_divergence(df["Close"], inds["rsi"])
    signals    = generate_signals(df, inds, patterns, sr_levels, trend, divergence)

    cp   = round(float(df["Close"].iloc[-1]), 2)
    prev = round(float(df["Close"].iloc[-2]), 2)
    chg  = round(cp - prev, 2)
    chg_pct = round(chg / prev * 100, 2)

    return {
        "candles":   to_candles(df),
        "volumes":   to_volumes(df),
        "ema20":     to_line(inds["ema20"], df),
        "ema50":     to_line(inds["ema50"], df),
        "ema200":    to_line(inds["ema200"], df),
        "rsi_data":  to_line(inds["rsi"], df),
        "sr_levels": sr_levels,
        "patterns":  patterns,
        "trend":     trend,
        "divergence": divergence,
        "signals":   signals,
        "stats": {
            "current_price":    cp,
            "daily_change":     chg,
            "daily_change_pct": chg_pct,
            "atr":   round(float(inds["atr"].iloc[-1]), 2),
            "rsi":   round(float(inds["rsi"].iloc[-1]), 1),
            "ema20": round(float(inds["ema20"].iloc[-1]), 2),
            "ema50": round(float(inds["ema50"].iloc[-1]), 2),
            "ema200":round(float(inds["ema200"].iloc[-1]), 2),
        },
    }


@app.get("/api/trends")
def get_all_trends():
    result = {}
    for tf in ["15m", "1H", "4H", "1D"]:
        try:
            df = fetch_gold(tf)
            result[tf] = detect_trend(df)
        except Exception:
            result[tf] = "error"
    return result


# ─── Journal ───────────────────────────────────────────────────────────────────

class JournalEntry(BaseModel):
    date: str
    timeframe: Optional[str] = "1H"
    direction: str
    entry_price: float
    exit_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    result: Optional[str] = None
    pnl: Optional[float] = None
    notes: Optional[str] = None


@app.get("/api/journal")
def get_journal():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM journal ORDER BY created_at DESC LIMIT 100").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/journal")
def add_journal(entry: JournalEntry):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO journal (date, timeframe, direction, entry_price, exit_price, stop_loss, take_profit, result, pnl, notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (entry.date, entry.timeframe, entry.direction, entry.entry_price,
         entry.exit_price, entry.stop_loss, entry.take_profit,
         entry.result, entry.pnl, entry.notes),
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.delete("/api/journal/{entry_id}")
def delete_journal(entry_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM journal WHERE id = ?", (entry_id,))
    conn.commit()
    conn.close()
    return {"status": "ok"}
