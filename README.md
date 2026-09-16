# 🤖 AI Trading Bot — Android

A complete React Native Android application that connects to the **Binance API**
(spot Testnet *or* LIVE) and runs an AI-powered trading engine with ten
real-time technical indicators, a composite scoring model, risk-managed
order execution, biometric security and AES-256 encrypted credential storage.

> ⚠️ **Risk disclosure** — automated trading can lose money quickly. Nothing in
> this app is financial advice and no profit is guaranteed. The default mode is
> **paper trading on Binance Spot Testnet**. Real order placement must be
> explicitly armed, and LIVE keys must be explicitly confirmed.

---

## 📦 Getting the APK

The repo ships with a GitHub Actions pipeline (`build-apk.yml`). Every push
builds and uploads:

* `AI-Trading-Bot-release.apk` — signed release build
* `AI-Trading-Bot-debug.apk` — debug build

Download from **Actions → Build Android APK → latest run → Artifacts**, or
install the release APK directly on any ARM device (Android 6.0+, API 23+):

```bash
adb install AI-Trading-Bot-release.apk
```

### Building locally

Requires Node ≥ 18, JDK 17 and an Android SDK:

```bash
npm install
cd android && ./gradlew assembleRelease          # release APK
# or for an x86_64 emulator:
cd android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64
```

The release build is signed with the **committed demo keystore**
(`android/app/release.keystore`) for reproducible builds. **Generate your own
key material before distributing.**

---

## 🧩 Features

### 1 · Authentication & setup
* Secure entry of Binance **API key / secret key**
* One-tap toggle between **Binance Spot Testnet** and **LIVE**
* Credentials encrypted twice before touching disk:
  1. JS envelope — AES-256 (CryptoJS, PBKDF-stretched master key)
  2. Disk layer — Android `EncryptedSharedPreferences` with an
     Android-Keystore resident master key (**AES-256-GCM** values /
     AES-256-SIV keys, `SecureStorageModule.kt`)
* **Biometric authentication** (fingerprint / face) gate using
  `androidx.biometric.BiometricPrompt` (`BiometricAuthModule.kt`) with device
  credential fallback; toggleable in Setup
* Live **API connection status** (green/red pulsing dot) with a signed
  `/api/v3/account` handshake test

### 2 · Dashboard
* Real-time portfolio balance (USDT, BTC, ETH + total USD)
* P&L % for **day / week / month / all-time**, computed from encrypted equity
  snapshots
* Active trades counter + live open-position P&L
* Live **top-10 ticker tape** (BTC, ETH, BNB, SOL, XRP, DOGE, ADA, AVAX, LINK,
  DOT) with price, 24 h change and poll-history sparklines
* **AI confidence score (0–100 %)** with gauge
* **Market sentiment** (Bullish / Bearish / Neutral) meter from top-10 moves
* Quick actions: **Start Bot · Stop Bot · Emergency Stop** (stop-only or
  stop-and-flatten confirmation)

### 3 · Live trading engine
Every analysis cycle fetches 500 candles of the selected symbol/timeframe plus
multi-timeframe candles, recomputes every indicator and scores the market:

| Indicator | Parameters |
|---|---|
| RSI | 14, Wilder smoothing |
| MACD | 12 / 26 / 9 |
| Bollinger Bands | 20 period, 2σ |
| EMA | 9 / 21 / 50 / 200 |
| Stochastic | 14, 3, 3 |
| ATR | 14 |
| Volume profile | 24 bins, POC + HVN |
| Fibonacci | 120-bar swing retracement |
| Ichimoku | 9 / 26 / 52, displacement 26 |
| VWAP | session cumulative |

**Signal model** (weights from the reference spec):

```
RSI <30 → +20 · RSI >70 → −20
MACD bullish cross & hist>0 → +15 · bearish → −15
price ≤ lower band → +15 · ≥ upper band → −15
EMA 9>21>50 → +20 · 9<21<50 → −20
volume > 1.5×avg → +10
Stoch K<20 & K>D → +10 · K>80 & K<D → −10
multi-timeframe confluence (1m,5m,15m,1h,4h) → ±15
extensions: Ichimoku cloud ±5 · VWAP ±5

score ≥ 60 STRONG_BUY · ≥30 BUY · ≤−30 SELL · ≤−60 STRONG_SELL · else HOLD
AI confidence = min(100, |score|)
```

**Execution**
* LONG entries sized at `riskPct` of available USDT (virtual 10 000 $ bankroll
  in paper mode, real balance when armed)
* ATR-based **stop-loss (default 1.5×ATR)** and **take-profit (2.5×ATR)**,
  checked every cycle; exits also on opposite SELL signals
* Real orders only when: credentials saved **+** "live order placement" armed
  **+** explicit confirmation — MARKET orders via `/api/v3/order`
* Activity log, trade history with win rate / P&L stats, all persisted in the
  encrypted store

## 🏗️ Architecture

```
android/app/src/main/java/com/aitradingbot/modules/   ← Kotlin native modules
  SecureStorageModule.kt   EncryptedSharedPreferences + SecureRandom
  BiometricAuthModule.kt   BiometricPrompt wrapper
  BotNativePackage.kt
src/
  api/binance.ts           REST client, HMAC-SHA256 signing, clock sync
  security/vault.ts        AES-256 envelope + key management
  engine/indicators.ts     all 10 indicator families (pure TS, unit-tested)
  engine/signal.ts         composite scoring / classification
  engine/engine.ts         bot loop, SL/TP, order execution, persistence
  state/AppState.tsx       provider: pollers, balances, tickers, P&L, lock
  components/              charts (dependency-free View rendering) + UI kit
  screens/                 Lock · Setup · Dashboard · Bot · Trades
```

Design choices worth noting:

* **Zero third-party native chart/navigation libraries** — candlesticks,
  sparklines, gauges and score bars are drawn with plain Views, keeping the
  Gradle build minimal and reliable.
* Custom Kotlin modules instead of JS-only native plugins: biometrics and the
  Keystore-backed store are first-party code.
* The JS bundle is pre-compiled into the release APK (offline-capable); the
  app talks to Binance directly over HTTPS (public market data needs no keys).

## 🧪 Testing

```bash
npx jest    # 16 unit tests over indicators + signal model
npx tsc --noEmit
```

## 🔐 Security notes

* Keys never leave the device unencrypted; the master key lives in the Android
  Keystore (hardware-backed where available).
* Recommend API keys with **spot-trading-only** permissions, no withdrawals.
* The committed release keystore is for CI reproducibility — replace before
  publishing (see comment in `android/app/build.gradle`).
