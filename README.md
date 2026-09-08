# AI Trade Signals — Binance live signal + trading app

Native Android app (Java) that pulls **live Binance market data**, runs an **on-device adaptive
signal model** over it, and lets you trade the result — on paper by default, or live against the
Binance **Spot Testnet** (or the real API if you insist).

UI is bilingual: **සිංහල / English**, switchable in the toolbar or in Settings.

---

## What it actually does

| Piece | Detail |
| --- | --- |
| Live data | Public Binance REST API (`/api/v3/klines`, `/ticker/24hr`), no API key needed. Six mirrors are rotated automatically if one is blocked. |
| Signal model | 7 ATR-normalised technical features (RSI, EMA ribbon, MACD histogram, Bollinger %B, Stochastic, momentum, EMA-50 trend) combined by a **weighted linear ensemble**. |
| Learning | After every signal the app waits for the grading horizon, measures what the market really did, and updates the feature weights with the delta rule. Weights, accuracy and average return persist across restarts. **Everything runs on the phone.** |
| Trading | Paper account (10,000 USDT virtual, 0.1% taker fee) by default. Live mode sends real signed `MARKET` orders, and points at **testnet.binance.vision** unless you explicitly switch it off. |
| Watcher | Foreground service keeps polling with the screen off and raises a notification per signal. |

### The learning loop, precisely

```
score      = Σ (w_i · feature_i) / Σ |w_i|          →  [-1, +1]
signal     = BUY  if score ≥ threshold
             SELL if score ≤ -threshold
             else NEUTRAL
outcome    = clamp( realised% / (1.5 · ATR%), -1, +1 )
w_i        ← clip( w_i + lr · (outcome − score) · feature_i , 0.05, 5 )
```

Features that keep being wrong lose influence; features that keep being right gain influence.
The **AI model** card in the app shows the live weights, the graded-sample count, the directional
hit rate and the average return of following the signals.

This is an adaptive technical model, **not** a trained deep network and **not** financial advice.
Crypto can go to zero.

---

## Install the APK

**Ready-made APK:** [`apk/AITradeSignals-debug.apk`](apk/AITradeSignals-debug.apk) in this repo
(5.9 MB, debug/V2-signed, `com.rusindu.aitrade`, minSdk 26). Copy it to the phone and install —
you will need *Install unknown apps* enabled for your browser or file manager.

It is built by GitHub Actions (`.github/workflows/build-apk.yml`) because the Android SDK is not
available in this workspace. Every push rebuilds it and pushes the fresh APK plus the full Gradle
log to the **`apk-output`** branch, so there is always a current binary and a build log to read.

The APK is debug-signed, so enable *Install unknown apps* for your browser/file manager and install
it directly. Minimum Android 8.0 (API 26).

## Build it yourself

```bash
./gradlew assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

Requirements: JDK 17, Android SDK platform 34, Gradle 8.9 (AGP 8.5.2).

## Safety defaults

* Live orders are **off**. Enabling them shows a confirmation with the exact endpoint on every trade.
* Testnet is **on** by default — live order flow with fake money.
* Auto-trade is **off** by default; when enabled it needs a minimum confidence and only opens one
  position at a time.
* The API secret is stored in the app's private `SharedPreferences` and never leaves the device
  except in the HMAC signature of your own requests. Use a **withdraw-disabled, IP-restricted** key.

## Project layout

```
app/src/main/java/com/rusindu/aitrade/
├── ai/          Indicators, SignalEngine, AdaptiveModel (the learning part), Snapshot
├── core/        TradeEngine — polling loop shared by UI and service
├── model/       Candle, Signal, Trade, Direction
├── net/         BinanceApi (public + signed HMAC-SHA256), BinanceException
├── service/     SignalService — foreground watcher + notifications
├── store/       Prefs, Journal (history, grading, persistence)
├── trade/       Portfolio (paper), TradeExecutor (paper or live)
├── ui/          CandleChartView, RsiView, adapters
└── util/        Fmt, Intervals
```

Data source: [Binance public API](https://developers.binance.com/docs/binance-spot-api-docs) ·
Testnet: [testnet.binance.vision](https://testnet.binance.vision)
