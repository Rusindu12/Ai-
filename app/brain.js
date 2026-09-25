/* ============================================================================
 * CryptoAI PRO — brain.js · SELF-LEARNING TRADING BRAIN (ඉගෙන ගන්නා AI)
 * ---------------------------------------------------------------------------
 * Trading වල තියෙන factors 12ක් හැම tick එකකම analyze කරලා trade decision එක
 * ගන්නවා — ඒ විතරක් නෙවෙයි:
 *   • හැම closed trade එකක්ම (win/loss) බලලා feature weights ටික
 *     automatic update වෙනවා (online learning — perceptron-style)
 *   • "Train on history" — පරණ candles 500ක් උඩ simulate කරලා instant training
 *   • Weights localStorage එකේ persist වෙනවා — bot එක කාලය යන කොට හුඟක් හොඳ
 *
 * Pure JS, no dependencies. Works in WebView, browser AND Node (tests).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Brain = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* 📚 Huntraders knowledge engine (patterns.js) — candlestick + chart patterns */
  let Patterns = null;
  try { Patterns = (typeof self !== "undefined" && self.Patterns) || (typeof module !== "undefined" && module.exports && require("./patterns.js")) || null; }
  catch (e) { Patterns = null; }

  /* ------------------------------------------------- feature definitions -- */
  /* id + human label (app maps ids → i18n) — values normalized to [-1, +1]  */
  const FEATURES = [
    ["trendEma",  "EMA20 > EMA50 (trend)"],
    ["trendSlow", "EMA50 vs EMA150 (big trend)"],
    ["trendPx",   "Price > EMA50"],
    ["macd",      "MACD histogram"],
    ["rsi",       "RSI momentum"],
    ["stoch",     "Stochastic %K vs %D"],
    ["bbPos",     "Bollinger band position"],
    ["volX",      "Volume vs 20-bar average"],
    ["atr",       "ATR volatility (high = careful)"],
    ["structure", "Higher-highs / lower-lows"],
    ["candle",    "Last-3 candle strength"],
    ["btcCtx",    "BTC market context"],
    ["cndlBull",  "Huntraders: bullish candlestick pattern"],
    ["cndlBear",  "Huntraders: bearish candlestick pattern"],
    ["chartBull", "Huntraders: bullish chart pattern"],
    ["chartBear", "Huntraders: bearish chart pattern"],
    ["mtfAlign",  "Higher-timeframe trend alignment (v46)"],
    ["trendStr",  "Trend strength: EMA gap vs volatility (v46)"],
  ];

  /* seeded priors — trend-following bias, refined by training */
  const SEED = {
    trendEma: 1.0, trendSlow: 0.8, trendPx: 0.6, macd: 0.8, rsi: 0.5,
    stoch: 0.4, bbPos: 0.2, volX: 0.5, atr: -0.3, structure: 0.6,
    candle: 0.3, btcCtx: 0.7,
    /* 📚 book priors: "Chart patterns give the most reliable trading signals" */
    cndlBull: 0.8, cndlBear: 0.8, chartBull: 1.0, chartBear: 1.0,
    /* v46: trade WITH the higher timeframe; trend quality matters */
    mtfAlign: 0.9, trendStr: 0.4,
  };

  const LSKEY = "cryptoai.brain.v1";
  const LR = 0.06;          /* learning rate per example */
  const WCLAMP = 3;

  /* --------------------------------------------------------- persistence -- */
  function load() {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(LSKEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function persist() {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(LSKEY, JSON.stringify(S));
    } catch (e) { /* private mode */ }
  }

  const S = Object.assign({
    w: Object.assign({}, SEED),
    n: 0, wins: 0, losses: 0,          /* live lessons */
    hs: 0, hCorrect: 0,                /* history-training lessons */
    trainedAt: 0,
  }, load() || {});
  S.streak = typeof S.streak === "number" ? S.streak : 0;   /* v45: win/loss streak */
  S.pnlSum = typeof S.pnlSum === "number" ? S.pnlSum : 0;   /* v45: total USDT from brain trades */
  if (!S.acc || typeof S.acc !== "object") S.acc = {};     /* v46: per-feature reliability ∈ [-1,1] */
  if (!S.w || typeof S.w !== "object") S.w = Object.assign({}, SEED);
  FEATURES.forEach(([id]) => { if (typeof S.w[id] !== "number") S.w[id] = SEED[id] || 0; });
  /* v50: history-training lessons used to be counted as live wins / losses — that
     inflated the "Win rate" card and the live accuracy that sizes bot trades. Take
     them out once; from now on history training only moves the weights. */
  if (!S.histFix) {
    S.wins = Math.max(0, (S.wins || 0) - (S.hCorrect || 0));
    S.losses = Math.max(0, (S.losses || 0) - Math.max(0, (S.hs || 0) - (S.hCorrect || 0)));
    S.n = Math.max(0, (S.n || 0) - (S.hs || 0));
    S.histFix = 1;
    persist();
  }

  /* ------------------------------------------------------------ TA helpers */
  const last = (a) => a[a.length - 1];
  function ema(arr, n) {
    if (arr.length < n) return null;
    const k = 2 / (n + 1); let e = 0;
    for (let i = 0; i < n; i++) e += arr[i];
    e /= n;
    for (let i = n; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  function emaSeries(arr, n) {
    const out = new Array(arr.length).fill(null);
    if (arr.length < n) return out;
    const k = 2 / (n + 1); let e = 0;
    for (let i = 0; i < n; i++) e += arr[i];
    e /= n; out[n - 1] = e;
    for (let i = n; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out[i] = e; }
    return out;
  }
  function rsiVal(closes, n) {
    if (closes.length < n + 1) return null;
    let g = 0, l = 0;
    for (let i = closes.length - n; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    if (l === 0) return 100;
    const rs = (g / n) / (l / n);
    return 100 - 100 / (1 + rs);
  }
  function macdHist(closes) {
    const f = emaSeries(closes, 12), s = emaSeries(closes, 26);
    const line = closes.map((_, i) => (f[i] != null && s[i] != null) ? f[i] - s[i] : null).filter((x) => x != null);
    if (line.length < 9) return null;
    const sig = ema(line, 9);
    return last(line) - sig;
  }
  function stochK(klines, n) {
    if (klines.length < n) return null;
    let hi = -Infinity, lo = Infinity;
    for (let i = klines.length - n; i < klines.length; i++) { hi = Math.max(hi, klines[i].h); lo = Math.min(lo, klines[i].l); }
    const c = last(klines).c;
    return hi === lo ? 50 : ((c - lo) / (hi - lo)) * 100;
  }
  function atrPct(klines, n) {
    if (klines.length < n + 1) return null;
    let sum = 0;
    for (let i = klines.length - n; i < klines.length; i++) {
      const tr = Math.max(klines[i].h - klines[i].l, Math.abs(klines[i].h - klines[i - 1].c), Math.abs(klines[i].l - klines[i - 1].c));
      sum += tr;
    }
    return (sum / n) / last(klines).c * 100; /* % of price */
  }

  /* --------------------------------------------------- feature extraction -- */
  /* ctx: { btcChg } — BTC 24h % change for market-context feature            */
  function features(klines, ctx) {
    const f = {};
    if (!klines || klines.length < 60) return null;
    const closes = klines.map((k) => k.c);
    const px = last(closes);
    const e20 = ema(closes, 20), e50 = ema(closes, 50), e150 = ema(closes, Math.min(150, closes.length - 10));

    f.trendEma  = e20 != null && e50 != null ? Math.max(-1, Math.min(1, ((e20 - e50) / e50) * 100)) : 0;
    f.trendSlow = e50 != null && e150 != null ? Math.max(-1, Math.min(1, ((e50 - e150) / e150) * 50)) : 0;
    f.trendPx   = e50 != null ? Math.max(-1, Math.min(1, ((px - e50) / e50) * 50)) : 0;
    const mh = macdHist(closes);
    f.macd      = mh != null ? Math.max(-1, Math.min(1, (mh / px) * 800)) : 0;
    const r = rsiVal(closes, 14);
    f.rsi       = r != null ? (r - 50) / 25 : 0;                       /* >0 bullish momentum */
    const k = stochK(klines, 14), d = stochK(klines, klines.length >= 28 ? 28 : 14);
    f.stoch     = k != null && d != null ? Math.max(-1, Math.min(1, (k - d) / 20)) : 0;
    /* Bollinger position: where price sits inside 20/2 bands (top = +1) */
    let sma = 0; const n20 = Math.min(20, closes.length);
    for (let i = closes.length - n20; i < closes.length; i++) sma += closes[i];
    sma /= n20;
    let vari = 0;
    for (let i = closes.length - n20; i < closes.length; i++) vari += (closes[i] - sma) * (closes[i] - sma);
    const sd = Math.sqrt(vari / n20) || 1;
    f.bbPos     = Math.max(-1, Math.min(1, (px - sma) / (2 * sd)));
    /* volume vs 20-bar average */
    const vols = klines.map((x) => x.v || 0);
    let va = 0; for (let i = Math.max(0, vols.length - 20); i < vols.length; i++) va += vols[i];
    va /= Math.min(20, vols.length);
    const vx = va > 0 ? last(vols) / va : 1;
    f.volX      = Math.max(-1, Math.min(1, (vx - 1)));                  /* high vol + up candle = conviction */
    if (last(klines).c < last(klines).o) f.volX = -Math.abs(f.volX);
    const a = atrPct(klines, 14);
    f.atr       = a != null ? Math.max(-1, Math.min(1, (a - 1.5) / 2)) : 0;  /* >1.5% ATR = risky */
    /* structure: last 40 bars higher-highs vs lower-lows */
    const win = Math.min(40, klines.length);
    let hh = 0;
    for (let i = klines.length - win + 1; i < klines.length; i++) hh += klines[i].h >= klines[i - 1].h ? 1 : -1;
    f.structure = Math.max(-1, Math.min(1, hh / (win / 2)));
    /* candle strength: bodies of last 3 candles vs their range */
    let cs = 0;
    for (let i = klines.length - 3; i < klines.length; i++) {
      const rng = (klines[i].h - klines[i].l) || 1;
      cs += ((klines[i].c - klines[i].o) / rng);
    }
    f.candle    = Math.max(-1, Math.min(1, cs / 1.5));
    /* v46: trend QUALITY — EMA gap measured in ATRs (huge gap + low vol = real trend) */
    if (e20 != null && e50 != null && a != null && px) {
      const gap = Math.abs(e20 - e50) / px * 100;
      const ratio = gap / Math.max(a, 0.15);
      f.trendStr = Math.max(-1, Math.min(1, (e20 >= e50 ? 1 : -1) * ratio / 3));
    } else f.trendStr = 0;
    /* v46: higher-timeframe alignment passed in ctx (0 = unknown/neutral) */
    f.mtfAlign = ctx && typeof ctx.mtfBias === "number" ? Math.max(-1, Math.min(1, ctx.mtfBias)) : 0;
    const bc = ctx && ctx.btcChg != null ? Number(ctx.btcChg) : 0;
    f.btcCtx    = Math.max(-1, Math.min(1, bc / 4));                    /* ±4% BTC day = strong context */

    /* 📚 Huntraders pattern knowledge (candlesticks + chart formations) */
    f.cndlBull = f.cndlBear = f.chartBull = f.chartBear = 0;
    if (Patterns) {
      try {
        const p = (ctx && ctx.pat) ? ctx.pat : Patterns.detect(klines);   /* v48: reuse caller's detection */
        f.cndlBull = p.bull; f.cndlBear = -p.bear;              /* signed: bearish pushes short */
        f.chartBull = p.chartBull; f.chartBear = -p.chartBear;
      } catch (e) { /* pattern engine hiccup — indicators still stand */ }
    }

    return f;
  }

  /* ------------------------------------------------------------- decision -- */
  function decide(f, th) {
    if (!f) return { bias: 0, score: 0 };
    let num = 0, den = 0;
    /* v46: each feature's weight scales by its own track record (0.5x..1.5x) —
       features that keep being wrong fade out until they prove themselves again */
    FEATURES.forEach(([id]) => {
      const eff = (S.w[id] || 0) * (1 + 0.5 * (S.acc[id] || 0));
      num += eff * (f[id] || 0); den += Math.abs(eff);
    });
    const score = den > 0 ? num / den : 0;
    let t = th != null ? th : 0.2;
    /* v45: discipline — after 2+ straight losses demand a stronger signal;
       on a 3+ win streak trade slightly looser (confidence) */
    if (S.streak <= -2) t = Math.min(0.4, t + 0.04);
    else if (S.streak >= 3) t = Math.max(0.05, t - 0.02);
    return { score, t, bias: score >= t ? 1 : score <= -t ? -1 : 0 };
  }

  /* v46: conviction 0.4..1 — how much of the planned size this signal deserves.
     Strong score + proven live accuracy → full size; marginal signal → half. */
  function confidence(score, th) {
    const total = S.wins + S.losses;
    const acc = total >= 10 ? S.wins / total : 0.55;
    const strength = Math.min(1, Math.abs(score || 0) / Math.max(th || 0.2, 0.05) / 1.5);
    return Math.max(0.4, Math.min(1, 0.5 + 0.3 * strength + 0.2 * (acc - 0.5)));
  }

  /* ------------------------------------------------------------- learning -- */
  /* v45: outcome-weighted lessons — big wins/losses and high-conviction calls
     teach more; streak tracks consecutive wins(+) / losses(−) for discipline */
  function learn(f, outcome, weight, pnlUsd, hist) {
    if (!f) return;
    const w = weight != null ? Math.max(0.3, Math.min(2.5, weight)) : 1;
    FEATURES.forEach(([id]) => {
      const x = f[id] || 0;
      if (x !== 0) {
        S.w[id] = Math.max(-WCLAMP, Math.min(WCLAMP, (S.w[id] || 0) + LR * w * outcome * x));
        /* v46: did THIS feature point the right way? rolling reliability memory */
        const voted = x * (S.w[id] || 1) >= 0 ? outcome : -outcome;   /* contribution direction vs result */
        S.acc[id] = Math.max(-1, Math.min(1, (S.acc[id] || 0) * 0.95 + 0.05 * voted));
      }
    });
    if (hist) return;                  /* v50: history lesson — weights only, trainHistory persists once */
    S.n++;
    if (outcome > 0) { S.wins++; S.streak = S.streak >= 0 ? S.streak + 1 : 1; }
    else { S.losses++; S.streak = S.streak <= 0 ? S.streak - 1 : -1; }
    if (typeof pnlUsd === "number") S.pnlSum += pnlUsd;
    persist();
  }

  /* --------------------------------------------- history trainer (backtest) */
  /* walks the candles, simulates the brain's entries, and trains on what
     would have happened — instant "experience" without waiting for live trades */
  function trainHistory(klines, opts) {
    const fwd = (opts && opts.forward) || 12;      /* bars to hold */
    const th = (opts && opts.threshold) != null ? opts.threshold : 0.15;
    const start = 160, end = klines.length - fwd - 1;
    let signals = 0, correct = 0;
    const before = snapshot();
    for (let i = start; i < end; i += 3) {
      const slice = klines.slice(0, i + 1);
      const f = features(slice, null);
      if (!f) continue;
      const { bias, score } = decide(f, th);
      if (!bias) continue;
      const entry = klines[i].c, exitP = klines[i + fwd].c;
      const ret = (exitP - entry) / entry;
      const win = bias > 0 ? ret > 0.0015 : ret < -0.0015;   /* cover ~fees */
      learn(f, win ? 1 : -1, 1, undefined, true);
      signals++; if (win) correct++;
    }
    S.hs += signals; S.hCorrect += correct; S.trainedAt = Date.now();
    persist();
    return { signals, acc: signals ? correct / signals : 0, before, after: snapshot() };
  }

  function snapshot() {
    const w = {};
    FEATURES.forEach(([id]) => { w[id] = Math.round((S.w[id] || 0) * 100) / 100; });
    return { w, n: S.n, wins: S.wins, losses: S.losses };
  }

  function stats() {
    const total = S.wins + S.losses;
    return {
      n: S.n, wins: S.wins, losses: S.losses,
      winRate: total ? S.wins / total : null,
      streak: S.streak || 0,
      acc: Object.assign({}, S.acc),                /* v46: reliability map */
      avgPnl: total ? S.pnlSum / total : null,      /* v45: avg USDT per brain trade */
      hs: S.hs, trainedAt: S.trainedAt, w: snapshot().w,
    };
  }
  function reset() {
    S.w = Object.assign({}, SEED); S.n = 0; S.wins = 0; S.losses = 0; S.hs = 0; S.hCorrect = 0; S.trainedAt = 0; S.streak = 0; S.pnlSum = 0; S.acc = {};
    persist();
  }

  return {
    FEATURES, features, decide, learn, trainHistory, stats, reset, confidence,
    patterns: () => Patterns,
    _state: S,
  };
});
