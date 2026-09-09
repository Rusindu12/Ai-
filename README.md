# AI Trade Signals — Binance live signal + trading app

Native Android app (Java) that pulls **live Binance market data**, runs an **on-device adaptive
signal model** over it, and lets you trade the result — on paper by default, or live against the
Binance **Spot Testnet** (or the real API if you insist).

Bilingual **සිංහල / English** UI, **light and dark themes**, four tabs, no charting library — every
chart is drawn on a Canvas.

### Download links

| Link | What it is |
| --- | --- |
| **[Release page](https://github.com/Rusindu12/Ai-/releases/tag/latest-build)** | Latest build, always current |
| [Direct APK (release asset)](https://github.com/Rusindu12/Ai-/releases/download/latest-build/AITradeSignals-debug.apk) | One tap / one click download |
| [Direct APK (`apk-output` branch)](https://github.com/Rusindu12/Ai-/raw/apk-output/AITradeSignals-debug.apk) | Same file, second channel |
| [`apk/AITradeSignals-debug.apk`](apk/AITradeSignals-debug.apk) | Copy committed next to the source |

~6 MB, debug/V2-signed (`apksigner`: `CN=Android Debug`), `com.rusindu.aitrade`, minSdk 26.
Copy it to the phone and install — you will need *Install unknown apps* enabled for your browser
or file manager.

It is built by GitHub Actions (`.github/workflows/build-apk.yml`) because the Android SDK is not
available in this workspace. Every push rebuilds it and pushes the fresh APK plus the full Gradle
log to the **`apk-output`** branch, so there is always a current binary and a build log to read.

---

## The four tabs

| Tab | What is in it |
| --- | --- |
| **Market** | Gradient hero with live price + sparkline, symbol & interval chips, candlestick chart with EMA 9/21 overlays, **volume histogram** and a **touch crosshair**, RSI strip, score gauge with needle + confidence arc, and a meter for every feature. |
| **Signals** | **Market scanner** — walks the whole watchlist through the same model and ranks pairs by \|score\|; tap a row to switch the market tab to it. Below: the graded signal history with ✓/✗ and the realised move, plus CSV export. |
| **Trade** | Equity, cash, position, unrealised and realised P&L; **stop loss / take profit** with ATR-based suggestions and automatic close; order panel with 25/50/100% sizing; **equity curve**; fill history. |
| **Model** | Live scoreboard (accuracy, graded count, average return, average move), the learned **feature weights** as meters, and a **walk-forward backtest** with equity curve, win rate, max drawdown and a buy-&-hold comparison. |

## How the model works

```
regime     = 0.55 · clamp(ER · 2.5) + 0.45 · clamp(ADX / 40)   ER = Kaufman efficiency ratio
score      = regime · lin(wT, f) + (1 − regime) · lin(wR, f)   →  [-1, +1]
signal     = BUY  if score ≥ threshold_eff
             SELL if score ≤ -threshold_eff
             else NEUTRAL
outcome    = clamp( realised% / (1.5 · ATR%), -1, +1 )
wE_i      ← clip( wE_i + lr·respE / √(ε + Σgrad²) · (outcome − score) · f_i , 0.05, 5 )
threshold_eff = threshold · clamp(1.35 − 0.7 · hitEWMA, 0.65, 1.35)
```

**A regime-aware mixture of two experts.** Eight ATR-normalised features — RSI 14, EMA 9/21
ribbon distance, MACD histogram, Bollinger %B, Stochastic %K with cross confirmation, 10-candle
momentum, distance from EMA 50, and a higher-timeframe trend (EMA slope on 3-candle aggregates) —
feed two weight vectors: a trend expert and a range expert. The market regime (Kaufman efficiency
ratio blended with ADX) decides how much each expert votes and how much each one learns from the
next grade, so mean-reversion features stop polluting trends and trend features stop whipsawing
in ranges. Each feature also keeps an AdaGrad squared-gradient accumulator, so loud features get
smaller steps. Confidence is a separate blend — 55% \|score\| + 25% feature agreement + 20%
volume ratio, scaled by ADX, plus a bonus when the higher-timeframe trend agrees with the call.

An exponentially weighted hit-rate nudges the effective threshold up to ×1.35 while the model has
been wrong (trade less, wait for better setups) and down to ×0.7 on a hot streak. The Model tab
shows the live regime, the auto threshold and each expert's hit rate.

After every signal the app waits for the grading horizon, measures what the market actually did
and updates the responsible expert with the delta rule — features that keep being wrong lose
influence. Weights, accumulators and per-expert stats persist across restarts.
**Everything runs on the phone.**

The **backtest** is honest about this: it replays the last N candles with a model that starts from
uniform weights and learns as it goes, one position at a time, 0.1% fee each way — so it measures
the learning loop, not a look-ahead oracle.

## Other features

* Foreground watcher service — keeps polling with the screen off, one notification per signal and
  one when a stop loss or take profit fires.
* Auto-trade (off by default) with a minimum-confidence gate and one position at a time.
* Live orders are HMAC-SHA256 signed and point at **testnet.binance.vision** unless you switch it off.
* Six Binance market-data mirrors with automatic failover.
* Pull-to-refresh, next-scan countdown, Snackbar feedback, CSV export via the share sheet.
* Theme picker (system / light / dark) and an editable watchlist.

## Build it yourself

```bash
./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Requirements: JDK 17, Android SDK platform 34, Gradle 8.9 (AGP 8.5.2).

## Safety defaults

* Live orders are **off**. Enabling them shows a confirmation with the exact endpoint on every trade.
* Testnet is **on** by default — live order flow with fake money.
* Auto-trade is **off** by default.
* The API secret is stored in the app's private `SharedPreferences` and never leaves the device
  except in the HMAC signature of your own requests. Use a **withdraw-disabled, IP-restricted** key.

This is an adaptive technical model, **not** a trained deep network and **not** financial advice.
Crypto can go to zero.

## Project layout

```
app/src/main/java/com/rusindu/aitrade/
├── ai/          Indicators, SignalEngine, AdaptiveModel (the learning part), Snapshot
├── core/        TradeEngine (polling loop), Scanner, Backtester
├── model/       Candle, Signal, Trade, Direction, ScanResult, BacktestResult
├── net/         BinanceApi (public + signed HMAC-SHA256), BinanceException
├── service/     SignalService — foreground watcher + notifications
├── store/       Prefs, Journal (history, grading, persistence)
├── trade/       Portfolio (paper + SL/TP), TradeExecutor (paper or live)
├── ui/          4 fragments, GaugeView, BarMeterView, CandleChartView, RsiView,
│                EquityCurveView, adapters
└── util/        Fmt, Intervals, Reasons, Watchlist, Csv
```

Data source: [Binance public API](https://developers.binance.com/docs/binance-spot-api-docs) ·
Testnet: [testnet.binance.vision](https://testnet.binance.vision)
