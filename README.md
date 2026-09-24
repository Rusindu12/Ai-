CryptoAI PRO site — built by R Sehansa · RS Ai Group

# CryptoAI PRO — website + web terminal

The public site for **CryptoAI PRO**: a landing page (EN + සිංහල) and the **web
app** itself, plus PWA support so it can be installed to the home screen.

```
/
├── index.html            landing page: hero + animated chart, live price strip, stats band,
│                         interactive live demo (real ta.js on live candles), phone preview,
│                         features, included-matrix, install, safety, FAQ
├── robots.txt · sitemap.xml  search-engine files
├── app/                  the web app (v49) — index.html, ta.js, patterns.js, brain.js,
│                         app.js, sysmgmt.js, worker.js — a copy of the Rusindu12/1 terminal
├── manifest.webmanifest  PWA: name, icons, start_url ./app/, shortcuts
├── sw.js                 service worker: offline shell, never caches exchange APIs
├── icons/                generated icons (192/512/maskable/apple-touch/favicon)
├── og-cover.png          social share image (1200×630)
├── tools/sync-app.sh     pulls the latest terminal from Rusindu12/1 into app/
├── tools/check-site.py   pre-deploy checks (JS parses, SW precache list, no stray text…)
└── .github/workflows/pages.yml   deploys the site to GitHub Pages
```

The Android app and the terminal itself are developed in
[`Rusindu12/1`](https://github.com/Rusindu12/1) (live at
<https://rusindu12.github.io/1/>), whose CI publishes the
[latest APK](https://github.com/Rusindu12/1/releases/download/cryptoai-apk-latest/CryptoAI-PRO.apk)
on every push. This repo hosts the site and an identical copy of the web terminal.
(The older `Rs-et` APK stopped at the 20 Sep build; the download buttons now point at `Rusindu12/1`.)

## Keeping the web app in sync with Rusindu12/1

`app/` must stay byte-identical to `crypto-app/app/src/main/assets/` in Rusindu12/1:

```bash
tools/sync-app.sh          # copies the latest files, then runs tools/check-site.py
git diff --stat            # review
# bump VERSION in sw.js (so installed copies refresh), add any new app/*.js to its SHELL list
git commit -am "app: sync with Rusindu12/1@<sha>" && git push   # → Pages redeploys
```

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
the same candles. Where `api.binance.com` is geo-blocked (HTTP 451, e.g. in
the US) the demo and the price strip retry on `data-api.binance.vision`,
Binance's market-data-only host. If both are unreachable it falls back to
clearly-labelled synthetic candles ("the engine and the maths are real, the
prices are not"), so the section never lies about data.
