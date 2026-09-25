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
├── app/                  the web app (v50) — index.html, ta.js, patterns.js, brain.js,
│                         app.js, sysmgmt.js, worker.js — the Rusindu12/1 terminal (v49)
│                         plus the fixes from the v50 audit (see tools/upstream/)
├── manifest.webmanifest  PWA: name, icons, start_url ./app/, shortcuts
├── sw.js                 service worker: offline shell, never caches exchange APIs
├── icons/                generated icons (192/512/maskable/apple-touch/favicon)
├── og-cover.png          social share image (1200×630)
├── tools/sync-app.sh     pulls the latest terminal from Rusindu12/1 into app/
├── tools/check-site.py   pre-deploy checks (JS parses, SW precache list, no stray text…)
├── tools/app-tests.js    regression tests for the app (paper, bot, live orders) — node only
├── tools/upstream/       the v50 fixes as a patch for Rusindu12/1 (for its own APK and site)
├── INSTALL_SI.md         Sinhala install guide for the APK (linked from the site's footer)
├── .github/workflows/pages.yml   deploys the site to GitHub Pages
└── .github/workflows/apk.yml     builds the Android APK from app/ and publishes it (main)
```

The terminal and the Android shell were first built in
[`Rusindu12/1`](https://github.com/Rusindu12/1) (live at <https://rusindu12.github.io/1/>).
This repo hosts the site, the web terminal — v50: v49 plus the fixes from a full check —
and its own build of the Android app, so the APK has the same fixes as the web app
(see [The Android APK](#the-android-apk)).
(The older `Rs-et` APK stopped at the 20 Sep build.)

## The Android APK

[`.github/workflows/apk.yml`](.github/workflows/apk.yml) puts `app/` into the Android shell
of Rusindu12/1 (Kotlin signing bridge, bot service; pinned by `SHELL_REF`), sets versionCode
50, builds it with Gradle and checks it: the app tests pass, the package and version are
right, the signature verifies and every file of `app/` is inside, byte for byte.

- every push that touches `app/` → the APK is attached to the workflow run (artifact)
- pushes to `main` → it is published to the
  [`cryptoai-apk-latest` release](https://github.com/Rusindu12/Ai-/releases/tag/cryptoai-apk-latest):
  **<https://github.com/Rusindu12/Ai-/releases/download/cryptoai-apk-latest/CryptoAI-PRO.apk>**
  — the link behind the site's Download buttons and `INSTALL_SI.md` (`tools/check-site.py`
  fails if they drift from the workflow)

The APK is debug-signed on a fresh runner (as in Rusindu12/1), so every build has a new
signature: to install a newer build, uninstall the old app first (that clears its data —
paper account, brain, API keys). The fix is a release keystore kept in repository secrets;
see item 1 in [`tools/upstream/README.md`](tools/upstream/README.md). To build with a newer
Android shell, change `SHELL_REF` (and `VERSION_CODE` / `VERSION_NAME`) in the workflow.

## Keeping the web app in sync with Rusindu12/1

`app/` is meant to be byte-identical to `crypto-app/app/src/main/assets/` in Rusindu12/1.
**Right now it is one step ahead:** it has the v50 fixes (paper trading, bot, live
orders — found in a full check of v49). The APK built here has them; to give Rusindu12/1's
own APK and site the same fixes, apply `tools/upstream/v50-app-fixes.patch` there — see
[`tools/upstream/README.md`](tools/upstream/README.md).
Until then `tools/sync-app.sh` refuses to run, so a sync can't undo the fixes.

Once both repos match again, a sync is:

```bash
tools/sync-app.sh          # copies the latest files, then runs check-site.py + app-tests.js
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
