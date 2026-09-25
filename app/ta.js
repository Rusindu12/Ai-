/* ============================================================================
 * CryptoAI PRO — ta.js
 * Pure technical-analysis engine: indicators, signal scoring, backtester.
 * No DOM access, no network. Works in the WebView AND in Node (for tests):
 *   const TA = require('./ta.js')
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TA = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const last = (a) => a[a.length - 1];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, d) => {
    if (!isFinite(v)) return 0;
    const f = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * f) / f;
  };

  // ------------------------------------------------------------------- SMA
  function sma(values, p) {
    const out = new Array(values.length).fill(null);
    if (p <= 0) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= p) sum -= values[i - p];
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  }

  // ------------------------------------------------------------------- EMA
  function ema(values, p) {
    const out = new Array(values.length).fill(null);
    if (!values.length || p <= 0) return out;
    const k = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (i < p - 1) continue;
      if (prev === null) {
        // seed with SMA of the first p values
        let s = 0;
        for (let j = i - p + 1; j <= i; j++) s += values[j];
        prev = s / p;
      } else {
        prev = v * k + prev * (1 - k);
      }
      out[i] = prev;
    }
    return out;
  }

  // ------------------------------------------------------------------- RSI
  function rsi(values, p) {
    p = p || 14;
    const out = new Array(values.length).fill(null);
    if (values.length <= p) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= p; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let ag = gain / p, al = loss / p;
    out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = p + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      ag = (ag * (p - 1) + g) / p;
      al = (al * (p - 1) + l) / p;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }

  // ------------------------------------------------------------------ MACD
  function macd(values, fast, slow, signalP) {
    fast = fast || 12; slow = slow || 26; signalP = signalP || 9;
    const ef = ema(values, fast), es = ema(values, slow);
    const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const first = line.findIndex((v) => v != null);
    let sig = new Array(values.length).fill(null);
    let hist = new Array(values.length).fill(null);
    if (first >= 0) {
      const dense = line.slice(first);
      const s = ema(dense, signalP);
      for (let i = 0; i < dense.length; i++) {
        sig[first + i] = s[i];
        hist[first + i] = s[i] != null ? dense[i] - s[i] : null;
      }
    }
    return { line, signal: sig, hist };
  }

  // -------------------------------------------------------------- Bollinger
  function bollinger(values, p, k) {
    p = p || 20; k = k || 2;
    const mid = sma(values, p);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    const width = new Array(values.length).fill(null);
    for (let i = p - 1; i < values.length; i++) {
      let v = 0;
      for (let j = i - p + 1; j <= i; j++) v += Math.pow(values[j] - mid[i], 2);
      const sd = Math.sqrt(v / p);
      upper[i] = mid[i] + k * sd;
      lower[i] = mid[i] - k * sd;
      width[i] = mid[i] ? ((upper[i] - lower[i]) / mid[i]) * 100 : null;
    }
    return { mid, upper, lower, width };
  }

  // ------------------------------------------------------------------- ATR
  function atr(candles, p) {
    p = p || 14;
    const out = new Array(candles.length).fill(null);
    if (!candles.length) return out;
    const tr = candles.map((c, i) => {
      if (i === 0) return c.h - c.l;
      const pc = candles[i - 1].c;
      return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
    });
    let prev = null;
    for (let i = 0; i < candles.length; i++) {
      if (i < p - 1) continue;
      if (prev === null) {
        let s = 0;
        for (let j = i - p + 1; j <= i; j++) s += tr[j];
        prev = s / p;
      } else {
        prev = (prev * (p - 1) + tr[i]) / p;
      }
      out[i] = prev;
    }
    return out;
  }

  // ------------------------------------------------------------- Stochastic
  function stochastic(candles, p, smooth) {
    p = p || 14; smooth = smooth || 3;
    const raw = new Array(candles.length).fill(null);
    for (let i = p - 1; i < candles.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let j = i - p + 1; j <= i; j++) {
        hi = Math.max(hi, candles[j].h);
        lo = Math.min(lo, candles[j].l);
      }
      raw[i] = hi === lo ? 50 : ((candles[i].c - lo) / (hi - lo)) * 100;
    }
    const idx = raw.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const dense = idx.map((i) => raw[i]);
    const sm = sma(dense, smooth);
    const K = new Array(candles.length).fill(null);
    idx.forEach((i, n) => { K[i] = sm[n]; });
    const dIdx = K.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
    const Dsm = sma(dIdx.map((i) => K[i]), 3);
    const D = new Array(candles.length).fill(null);
    dIdx.forEach((i, n) => { D[i] = Dsm[n]; });
    return { k: K, d: D };
  }

  // ---------------------------------------------------------------- helper
  function pctChange(values, n) {
    if (values.length < n + 1) return 0;
    const a = values[values.length - 1 - n], b = last(values);
    return a ? ((b - a) / a) * 100 : 0;
  }

  function trendLabel(seq) {
    // seq: array of numbers, returns +1 up / -1 down / 0 flat over last 3 pts
    if (seq.length < 4) return 0;
    const a = seq[seq.length - 4], b = last(seq);
    if (a == null || b == null) return 0;
    const d = b - a;
    const scale = Math.abs(a) || 1;
    if (Math.abs(d) / scale < 0.0004) return 0;
    return d > 0 ? 1 : -1;
  }

  /* =========================================================================
   * analyze(candles) → full signal report
   * candles: [{t,o,h,l,c,v}] oldest → newest (recommend >= 200 bars)
   *
   * Scoring = trend block (follows the trend) + reversion block (fades extremes),
   * blended so a strong trend is not cancelled out by an overbought reading,
   * while a genuine trend/oscillator conflict degrades to NEUTRAL ("wait").
   * ======================================================================= */
  function analyze(candles) {
    const n = candles.length;
    if (!candles || n < 30) {
      return { ok: false, error: "not enough candles", score: 0, verdict: "NEUTRAL", confidence: 0, reasons: [] };
    }
    const closes = candles.map((c) => c.c);
    const vols = candles.map((c) => c.v || 0);

    const e20 = ema(closes, 20), e50 = ema(closes, 50);
    const e200 = n >= 210 ? ema(closes, 200) : new Array(n).fill(null);
    const r = rsi(closes, 14);
    const m = macd(closes);
    const bb = bollinger(closes, 20, 2);
    const a14 = atr(candles, 14);
    const st = stochastic(candles, 14, 3);

    const price = last(closes);
    const R = last(r);
    const H = last(m.hist);
    const Hprev = m.hist[m.hist.length - 2];
    const E20 = last(e20), E50 = last(e50), E200 = last(e200);
    const bbU = last(bb.upper), bbL = last(bb.lower), bbM = last(bb.mid);
    const bbWidth = last(bb.width);
    const A = last(a14) || price * 0.01;
    const K = last(st.k), D = last(st.d);
    const volAvg = last(sma(vols, 20)) || 0;
    const volNow = last(vols) || 0;
    const volRatio = volAvg ? volNow / volAvg : 1;
    const roc10 = pctChange(closes, 10);
    const roc30 = pctChange(closes, 30);
    const pctB = bbU !== bbL ? ((price - bbL) / (bbU - bbL)) * 100 : 50;

    const reasons = [];
    const trend = { pts: 0, max: 0 };
    const revert = { pts: 0, max: 0 };
    const put = (block, points, weight, en, si) => {
      const w = points * weight;
      block.pts += w;
      block.max += 2 * weight;
      if (Math.abs(points) >= 0.5) reasons.push({ p: w, en, si });
    };

    // ============================ TREND BLOCK (momentum / structure) ==========
    if (E20 != null && E50 != null) {
      if (price > E20 && E20 > E50) put(trend, 2, 1.6, "Uptrend — price above EMA20, which is above EMA50", "ඉහළ ප්‍රවණතාව — මිල EMA20ට ඉහළින්, EMA20 EMA50ට ඉහළින්");
      else if (price > E20) put(trend, 1, 1.6, "Short-term strength — price above EMA20", "කෙටි කාලීන ශක්තිය — මිල EMA20ට ඉහළින්");
      else if (price < E20 && E20 < E50) put(trend, -2, 1.6, "Downtrend — price below EMA20, which is below EMA50", "පහළ ප්‍රවණතාව — මිල EMA20ට පහළින්, EMA20 EMA50ට පහළින්");
      else put(trend, -1, 1.6, "Short-term weakness — price below EMA20", "කෙටි කාලීන දුර්වලතාව — මිල EMA20ට පහළින්");
    }
    if (E200 != null) {
      put(trend, price > E200 ? 1.2 : -1.2, 0.8,
        price > E200 ? "Above the long-term trend line (EMA200)" : "Below the long-term trend line (EMA200)",
        price > E200 ? "දිගු කාලීන ප්‍රවණතා රේඛාවට (EMA200) ඉහළින්" : "දිගු කාලීන ප්‍රවණතා රේඛාවට (EMA200) පහළින්");
    }
    if (H != null) {
      if (H > 0 && Hprev != null && Hprev <= 0) put(trend, 2, 1.5, "MACD bullish crossover just happened", "MACD ඉහළ ගමන් (bullish cross) අලුතින් සිදුවිය");
      else if (H < 0 && Hprev != null && Hprev >= 0) put(trend, -2, 1.5, "MACD bearish crossover just happened", "MACD පහළ ගමන් (bearish cross) අලුතින් සිදුවිය");
      else if (H > 0) put(trend, H > Hprev ? 1.3 : 0.5, 1.5,
        H > Hprev ? "MACD positive and rising" : "MACD positive but flattening",
        H > Hprev ? "MACD ධනාත්මක සහ ඉහළ යමින්" : "MACD ධනාත්මක නමුත් දුර්වල වෙමින්");
      else put(trend, H < Hprev ? -1.3 : -0.5, 1.5,
        H < Hprev ? "MACD negative and falling" : "MACD negative but recovering",
        H < Hprev ? "MACD සෘණාත්මක සහ පහළ යමින්" : "MACD සෘණාත්මක නමුත් යථා තත්ත්වයට");
    }
    const momo = clamp((roc10 * 0.65 + roc30 * 0.35) / 3, -2, 2);
    put(trend, Math.abs(momo) < 0.2 ? 0 : momo, 1.2,
      `Momentum ${roc10 >= 0 ? "+" : ""}${round(roc10, 2)}% (10 candles) / ${roc30 >= 0 ? "+" : ""}${round(roc30, 2)}% (30 candles)`,
      `ගමන් වේගය කැන්ඩල් 10කදී ${roc10 >= 0 ? "+" : ""}${round(roc10, 2)}% / කැන්ඩල් 30කදී ${roc30 >= 0 ? "+" : ""}${round(roc30, 2)}%`);
    {
      const up = last(candles).c >= last(candles).o;
      if (volRatio > 1.3) {
        put(trend, up ? 1 : -1, 0.6,
          `High volume (${round(volRatio, 1)}× average) on a ${up ? "green" : "red"} candle`,
          `ඉහළ පරිමාවක් (සාමාන්‍යයෙන් ${round(volRatio, 1)} ගුණයක්) ${up ? "කොළ" : "රතු"} කැන්ඩල් එකක් මත`);
      } else {
        put(trend, 0, 0.6,
          `Volume ${round(volRatio, 2)}× average — no strong conviction`,
          `පරිමාව සාමාන්‍යයෙන් ${round(volRatio, 2)} ගුණයක් — දැඩි විශ්වාසයක් නොමැත`);
      }
    }

    // ======================= REVERSION BLOCK (oscillator extremes) ============
    if (R != null) {
      if (R < 30) put(revert, 2, 1.0, `RSI ${round(R, 1)} — oversold, a bounce is likely`, `RSI ${round(R, 1)} — අධික ලෙස විකුණුම් (oversold), ඉහළ යාමේ ඉඩක්`);
      else if (R < 45) put(revert, 0.7, 1.0, `RSI ${round(R, 1)} — leaning weak, room to rise`, `RSI ${round(R, 1)} — දුර්වල පැත්තට බරයි, ඉහළ යාමට ඉඩ ඇත`);
      else if (R <= 55) put(revert, 0, 1.0, `RSI ${round(R, 1)} — neutral`, `RSI ${round(R, 1)} — සමතුලිත`);
      else if (R <= 70) put(revert, -0.7, 1.0, `RSI ${round(R, 1)} — leaning hot`, `RSI ${round(R, 1)} — තරමක් උණුසුම්`);
      else put(revert, -2, 1.0, `RSI ${round(R, 1)} — overbought, pullback risk`, `RSI ${round(R, 1)} — අධික ලෙස මිලදී ගැනුම් (overbought), පහත වැටීමේ අවදානම`);
    }
    if (bbU != null && bbL != null) {
      if (pctB < 8) put(revert, 1.6, 0.8, "Price hugging the lower Bollinger band", "මිල පහළ Bollinger බෑන්ඩ් එකේ ගැටෙමින්");
      else if (pctB > 92) put(revert, -1.6, 0.8, "Price hugging the upper Bollinger band", "මිල ඉහළ Bollinger බෑන්ඩ් එකේ ගැටෙමින්");
      else if (pctB > 55) put(revert, pctB > 75 ? -0.6 : 0.5, 0.8, `Price in the upper half of the Bollinger bands (${round(pctB, 0)}%)`, `මිල Bollinger බෑන්ඩ්වල ඉහළ භාගයේ (${round(pctB, 0)}%)`);
      else put(revert, pctB < 25 ? 0.6 : -0.5, 0.8, `Price in the lower half of the Bollinger bands (${round(pctB, 0)}%)`, `මිල Bollinger බෑන්ඩ්වල පහළ භාගයේ (${round(pctB, 0)}%)`);
    }
    if (K != null && D != null) {
      if (K < 20 && K > D) put(revert, 1.5, 0.8, `Stochastic ${round(K, 0)} — turning up from oversold`, `Stochastic ${round(K, 0)} — oversold සිට ඉහළට හැරෙමින්`);
      else if (K > 80 && K < D) put(revert, -1.5, 0.8, `Stochastic ${round(K, 0)} — turning down from overbought`, `Stochastic ${round(K, 0)} — overbought සිට පහළට හැරෙමින්`);
      else if (K < 25) put(revert, 0.9, 0.8, `Stochastic ${round(K, 0)} — deeply oversold`, `Stochastic ${round(K, 0)} — බෙහෙවින් oversold`);
      else if (K > 75) put(revert, -0.9, 0.8, `Stochastic ${round(K, 0)} — deeply overbought`, `Stochastic ${round(K, 0)} — බෙහෙවින් overbought`);
      else put(revert, K > D ? 0.5 : -0.5, 0.8, K > D ? "Stochastic momentum is upward" : "Stochastic momentum is downward",
        K > D ? "Stochastic ගමන් වේගය ඉහළට" : "Stochastic ගමන් වේගය පහළට");
    }

    const tNorm = trend.max ? trend.pts / trend.max : 0;     // -1 … +1
    const rNorm = revert.max ? revert.pts / revert.max : 0;
    const strong = Math.abs(tNorm) >= 0.55;
    const wT = strong ? 0.82 : 0.66;
    const wR = 1 - wT;
    const norm = clamp(tNorm * wT + rNorm * wR, -1, 1);
    const conflict = Math.abs(tNorm) >= 0.45 && Math.abs(rNorm) >= 0.45 && tNorm * rNorm < 0;

    let verdict = "NEUTRAL";
    if (norm >= 0.45) verdict = "STRONG BUY";
    else if (norm >= 0.2) verdict = "BUY";
    else if (norm <= -0.45) verdict = "STRONG SELL";
    else if (norm <= -0.2) verdict = "SELL";

    if (conflict) {
      reasons.push({
        p: 0,
        en: "Trend and oscillators disagree — the edge here is weak, wait for a cleaner setup",
        si: "ප්‍රවණතාව සහ oscillator දර්ශක එකිනෙකට විරුද්ධයි — මෙහි වාසිය දුර්වලයි, පැහැදිලි සංඥාවක් එනතුරු ඉන්න",
      });
    }

    const confidence = clamp(Math.round(46 + Math.abs(norm) * 52 - (conflict ? 10 : 0)), 5, 97);

    // ------------------------------------------------------- trade levels
    const isBuy = verdict === "BUY" || verdict === "STRONG BUY";
    const isSell = verdict === "SELL" || verdict === "STRONG SELL";
    const tpMult = verdict === "STRONG BUY" || verdict === "STRONG SELL" ? 3 : 2.2;
    const slMult = 1.3;
    let levels = null;
    if (isBuy) {
      const entry = price, sl = entry - slMult * A, tp = entry + tpMult * A;
      levels = { entry, tp, sl, rr: round((tp - entry) / Math.max(entry - sl, 1e-9), 2), riskPct: round(((entry - sl) / entry) * 100, 2), rewardPct: round(((tp - entry) / entry) * 100, 2) };
    } else if (isSell) {
      const entry = price, sl = entry + slMult * A, tp = entry - tpMult * A;
      levels = { entry, tp, sl, rr: round((entry - tp) / Math.max(sl - entry, 1e-9), 2), riskPct: round(((sl - entry) / entry) * 100, 2), rewardPct: round(((entry - tp) / entry) * 100, 2) };
    }

    reasons.sort((a, b) => Math.abs(b.p) - Math.abs(a.p));

    return {
      ok: true,
      price, verdict, score: round(norm * 100, 1), confidence, levels, conflict, reasons,
      trendScore: round(tNorm * 100, 1),
      revertScore: round(rNorm * 100, 1),
      metrics: {
        rsi: R == null ? null : round(R, 1), macdHist: H == null ? null : round(H, 6), macdUp: H != null && Hprev != null ? H > Hprev : null,
        ema20: round(E20, 6), ema50: round(E50, 6), ema200: E200 == null ? null : round(E200, 6),
        bbUpper: bbU == null ? null : round(bbU, 6), bbLower: bbL == null ? null : round(bbL, 6), bbMid: bbM == null ? null : round(bbM, 6),
        bbWidth: bbWidth == null ? null : round(bbWidth, 2), pctB: round(pctB, 1),
        atr: round(A, 6), atrPct: round((A / price) * 100, 2),
        stochK: K == null ? null : round(K, 1), stochD: D == null ? null : round(D, 1),
        roc10: round(roc10, 2), roc30: round(roc30, 2), volRatio: round(volRatio, 2),
        trend: E20 != null && E50 != null ? (price > E20 && E20 > E50 ? "UP" : price < E20 && E20 < E50 ? "DOWN" : "RANGE") : "RANGE",
      },
    };
  }

  /* =========================================================================
   * backtest(candles, opts)
   *   opts.symbol, opts.minScore (|score| needed to enter, default 22)
   *   opts.tpMult, opts.slMult (ATR multiples), opts.feePct (per side, default 0.1)
   *   opts.allowShort (default true), opts.lookback warmup 60
   * Returns {trades, wins, losses, winRate, pnlPct, maxDD, buyHoldPct, equity}
   * ======================================================================= */
  function backtest(candles, opts) {
    opts = opts || {};
    const minScore = opts.minScore != null ? opts.minScore : 22;
    const tpMult = opts.tpMult != null ? opts.tpMult : 2.2;
    const slMult = opts.slMult != null ? opts.slMult : 1.3;
    /* v50: optional fixed-percent targets (the bot's TP % / SL %) instead of ATR multiples */
    const tpPct = opts.tpPct > 0 ? opts.tpPct / 100 : 0;
    const slPct = opts.slPct > 0 ? opts.slPct / 100 : 0;
    const fee = (opts.feePct != null ? opts.feePct : 0.1) / 100;
    const allowShort = opts.allowShort !== false;
    const warmup = Math.max(60, opts.warmup || 60);
    const n = candles.length;

    let equity = 1, peak = 1, maxDD = 0;
    const trades = [];
    const equityCurve = [];
    let pos = null;

    for (let i = warmup; i < n; i++) {
      const c = candles[i];
      if (pos) {
        const hitSl = pos.dir > 0 ? c.l <= pos.sl : c.h >= pos.sl;
        const hitTp = pos.dir > 0 ? c.h >= pos.tp : c.l <= pos.tp;
        if (hitSl || hitTp) {
          const exit = hitSl ? pos.sl : pos.tp;                 // worst case first
          const gross = pos.dir > 0 ? (exit - pos.entry) / pos.entry : (pos.entry - exit) / pos.entry;
          const net = gross - fee * 2;
          equity *= 1 + net;
          trades.push({ dir: pos.dir, entry: pos.entry, exit, bars: i - pos.i, pct: net * 100, reason: hitSl ? "SL" : "TP" });
          pos = null;
        } else {
          equityCurve.push(equity * (1 + (pos.dir > 0 ? (c.c - pos.entry) / pos.entry : (pos.entry - c.c) / pos.entry)));
        }
      }
      if (!pos) {
        const rep = analyze(candles.slice(0, i + 1));
        if (rep.ok && rep.score >= minScore) {
          const a = rep.metrics.atr || c.c * 0.01;
          pos = { dir: 1, entry: c.c, sl: slPct ? c.c * (1 - slPct) : c.c - slMult * a, tp: tpPct ? c.c * (1 + tpPct) : c.c + tpMult * a, i };
        } else if (rep.ok && allowShort && rep.score <= -minScore) {
          const a = rep.metrics.atr || c.c * 0.01;
          pos = { dir: -1, entry: c.c, sl: slPct ? c.c * (1 + slPct) : c.c + slMult * a, tp: tpPct ? c.c * (1 - tpPct) : c.c - tpMult * a, i };
        }
      }
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, (peak - equity) / peak);
    }
    // close any open trade at the last close
    if (pos) {
      const exit = candles[n - 1].c;
      const gross = pos.dir > 0 ? (exit - pos.entry) / pos.entry : (pos.entry - exit) / pos.entry;
      const net = gross - fee * 2;
      equity *= 1 + net;
      trades.push({ dir: pos.dir, entry: pos.entry, exit, bars: n - 1 - pos.i, pct: net * 100, reason: "close" });
    }
    const wins = trades.filter((t) => t.pct > 0).length;
    const losses = trades.length - wins;
    const buyHold = candles.length > warmup ? ((last(candles).c - candles[warmup].c) / candles[warmup].c) * 100 : 0;
    return {
      trades: trades.length, wins, losses,
      winRate: trades.length ? round((wins / trades.length) * 100, 1) : 0,
      pnlPct: round((equity - 1) * 100, 2),
      maxDD: round(maxDD * 100, 2),
      buyHoldPct: round(buyHold, 2),
      avgPct: trades.length ? round(trades.reduce((s, t) => s + t.pct, 0) / trades.length, 2) : 0,
      last: trades.slice(-6),
      equityCurve,
    };
  }

  return {
    sma, ema, rsi, macd, bollinger, atr, stochastic, pctChange, analyze, backtest, clamp, round,
    version: "1.0.0",
  };
});
