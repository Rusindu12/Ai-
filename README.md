# CryptoAI PRO — website + web terminal

The public site for **CryptoAI PRO**: a landing page (EN + සිංහල) and the **web
app** itself, plus PWA support so it can be installed to the home screen.

```
/
├── index.html            landing page: hero + animated chart, live price strip, stats band,
│                         interactive live demo (real ta.js on live candles), phone preview,
│                         features, included-matrix, install, safety, FAQ
├── robots.txt · sitemap.xml  search-engine files
├── app/                  the web app — index.html, app.js, ta.js
├── manifest.webmanifest  PWA: name, icons, start_url ./app/, shortcuts
├── sw.js                 service worker: offline shell, never caches exchange APIs
├── icons/                generated icons (192/512/maskable/apple-touch/favicon)
├── og-cover.png          social share image (1200×630)
└── .github/workflows/pages.yml   deploys the site to GitHub Pages
```

The Android APK is built and published from the
[`Rs-et`](https://github.com/Rusindu12/Rs-et) repository
([latest APK](https://github.com/Rusindu12/Rs-et/releases/download/cryptoai-apk-latest/CryptoAI-PRO.apk));
this repo hosts the site and the web terminal.

## Deploy (GitHub Pages)

The included workflow publishes the repo root to Pages on every push to `main`
(plus manual runs). One-time setup if the token cannot enable it:
**Settings → Pages → Build and deployment → Source: `GitHub Actions`**.

The site then lives at `https://rusindu12.github.io/Ai-/`.

## Local preview

```bash
python3 -m http.server 8080     # → http://localhost:8080
```

The landing page and the web app both work from a plain static server (the app
falls back to clearly-labelled demo data when it cannot reach an exchange).

## The live demo on the landing page

The `#demo` section loads candles straight from Binance and runs **`app/ta.js`**
in the visitor's browser, then shows the verdict, the confidence, the reasons,
ATR-based entry/target/stop, six indicator metrics and a fee-aware backtest on
the same candles. If the exchange is unreachable it falls back to
clearly-labelled synthetic candles ("the engine and the maths are real, the
prices are not"), so the section never lies about data.
