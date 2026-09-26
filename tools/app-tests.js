/* CryptoAI PRO — regression tests for the v50 fixes.   run:  node tools/app-tests.js
 *
 * Loads ta.js + patterns.js + brain.js + app.js into a Node vm with DOM stubs (the same
 * approach as tools/regression.js in Rusindu12/1) and checks, without a browser or an
 * exchange, that the bugs found in the v49 audit stay fixed:
 *   paper engine · bot entries · candles/demo mode · live orders (mocked bridge) · backtest · brain
 * Works from this repo (app/) and from Rusindu12/1 (crypto-app/app/src/main/assets/). */
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
const ROOT = path.join(__dirname, "..");
const DIR = [path.join(ROOT, "app"), path.join(ROOT, "crypto-app", "app", "src", "main", "assets")]
  .find((d) => fs.existsSync(path.join(d, "app.js")));
if (!DIR) { console.error("app.js not found"); process.exit(1); }

/* ------------------------------------------------------------ sandbox + stubs */
const el = () => {
  const ctx2d = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === "measureText" ? (s) => ({ width: String(s || "").length * 7 }) : k.startsWith("create") ? () => ({ addColorStop() { } }) : () => { }), set: (o, k, v) => ((o[k] = v), true) });
  return {
    getContext: () => ctx2d, width: 800, height: 400, style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", checked: false, disabled: false,
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false }, addEventListener() { }, appendChild() { }, removeChild() { }, remove() { },
    querySelector: () => el(), querySelectorAll: () => [], setAttribute() { }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    parentElement: { clientWidth: 800, clientHeight: 400 }, clientWidth: 800, childNodes: [], firstChild: null,
  };
};
const sb = {
  console: { log() { }, warn() { }, error() { }, info() { } }, Math, JSON, Date, isNaN, isFinite, parseInt, parseFloat,
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  Number, String, Boolean, Array, Object, RegExp, Error, Promise, Symbol, Map, Set, WeakMap, Proxy, Intl,
  fetch: () => Promise.reject(new Error("offline")), performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, location: { search: "", hash: "", href: "http://localhost/app/" },
  navigator: { language: "en", vibrate() { } }, innerWidth: 412, innerHeight: 915,
};
sb.window = sb; sb.self = sb; sb.globalThis = sb;
sb.AndroidBridge = {};          // "running in the Android app" — live tests route bc() to a fake exchange below
sb.addEventListener = () => { };
sb.localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const els = {};
sb.document = {
  getElementById: (id) => (els[id] = els[id] || el()), addEventListener() { }, createElement: () => el(),
  querySelector: () => el(), querySelectorAll: () => [], body: el(), documentElement: { lang: "en" },
  hidden: false, visibilityState: "visible", readyState: "loading",
};
vm.createContext(sb);
for (const f of ["ta.js", "patterns.js", "brain.js", "app.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), sb, { filename: f }); }
  catch (e) { if (f !== "app.js") { console.error(f + " failed to load: " + e.message); process.exit(1); } }
}
const R = (code) => vm.runInContext(code, sb);   // reach the app's const / let bindings too
R("TA = window.TA; Brain = window.Brain;");      // init() (DOM ready) is never run here

/* --------------------------------------------------------------------- tiny runner */
let fails = 0, n = 0;
const ok = (name, cond, info) => { n++; console.log((cond ? "✅ " : "❌ ") + name + (cond || info == null ? "" : "   → " + JSON.stringify(info))); if (!cond) fails++; };
const near = (a, b, eps) => Math.abs(a - b) <= (eps != null ? eps : 1e-9);
const candles = (n, start, drift, tfMin) => {   // ascending candles ending "now"
  const step = (tfMin || 15) * 60000, t0 = Math.floor(Date.now() / step) * step - (n - 1) * step, out = []; let p = start;
  for (let i = 0; i < n; i++) { const o = p, c = p * (1 + drift + Math.sin(i / 7) * 0.001); out.push({ t: t0 + i * step, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 100 + (i % 9) * 10 }); p = c; }
  return out;
};
/* seeded random walk with a drift — the same shape the browser mock serves, where the
   trend strategy says BUY (≈ +38) — so bot entries are deterministic */
const seedy = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
function trendCandles(seedStr, n, last, tfMin) {
  const step = tfMin * 60000, r = rng(seedy(seedStr)), raw = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, c = o * (1 + 0.0016 + Math.sin(i / 9) * 0.0012 + (r() - 0.5) * 0.004);
    raw.push([o, Math.max(o, c) * (1 + r() * 0.0024), Math.min(o, c) * (1 - r() * 0.0024), c, 50 + r() * 200]); p = c;
  }
  const k = last / raw[n - 1][3], t0 = Math.floor(Date.now() / step) * step - (n - 1) * step;
  return raw.map((x, i) => ({ t: t0 + i * step, o: x[0] * k, h: x[1] * k, l: x[2] * k, c: x[3] * k, v: x[4] }));
}
const reset = () => R(`state.paper = freshPaper(); state.bot = null; state.botCfg = null; botCfg(); state.dataMode = "live"; state.tickers = {}; state.klinesCache = {}; state.repCache = {}; state.settings.liveMode = "paper";`);

(async () => {
  ok("app.js loaded (paper, bot and live functions exported)", ["openPaper", "checkPaperPositions", "paperSellQty", "botEvalSymbol", "livePlaceOrder", "botOnTick"].every((f) => typeof sb[f] === "function"));

  /* ----------------------------------------------------------- paper engine */
  reset();
  R(`botCfg().exitMode = "minprofit"`);   // the default exit mode
  let pos = sb.openPaper("BTCUSDT", 100000, 1000, 3, 1, "manual", 1).pos;
  sb.checkPaperPositions("BTCUSDT", 100400);                        // +0.4 %: in profit, far below the 3 % TP
  ok("minprofit mode leaves a MANUAL trade alone (was sold at +0.4 %)", R("paper().positions.length") === 1);
  sb.checkPaperPositions("BTCUSDT", 98000);                         // through the 1 % stop
  ok("a manual trade's SL still fires in minprofit mode", R("paper().positions.length") === 0 && R("paper().history[0].reason") === "SL");

  reset();
  R(`botCfg().exitMode = "minprofit"; botCfg().aiTp = false`);
  sb.openPaper("BTCUSDT", 100000, 1000, 1.5, 0.8, "bot", 1);
  sb.checkPaperPositions("BTCUSDT", 100400);
  ok("minprofit mode still sells BOT trades at min profit", R("paper().positions.length") === 0 && R("paper().history[0].reason") === "profit");

  reset();
  pos = sb.openPaper("BTCUSDT", 100000, 2000, 3, 1, "manual", 1).pos;    // 0.02 BTC
  const cash0 = R("paper().bal");
  const part = sb.paperSellQty("BTCUSDT", 0.005, 101000, "manual");
  const rest = R("paper().positions[0]");
  ok("partial sell keeps the rest of the position (qty, entry, TP, SL, source)",
    near(part.sold, 0.005) && rest && near(rest.qty, 0.015) && rest.entry === 100000 && near(rest.tp, 103000, 1e-6) && near(rest.sl, 99000, 1e-6) && rest.src === "manual", rest);
  ok("partial sell pays the right cash (0.005 × 101,000 − 0.1 % fee)", near(R("paper().bal") - cash0, 0.005 * 101000 * 0.999, 1e-6));

  reset();
  sb.openPaper("BTCUSDT", 100000, 1000, 0, 0, "manual", 1);              // 0.01 BTC
  R(`paper().orders.push({ id: "o1", sym: "BTCUSDT", side: "SELL", qty: 0.004, price: 100500, type: "LIMIT", closeLong: true, ts: now() })`);
  R(`state.tickers.BTCUSDT = { last: 100200 }`); sb.checkPaperLimitOrders();
  ok("a limit SELL above the market waits for its price", R("paper().orders.length") === 1 && near(R("paper().positions[0].qty"), 0.01));
  R(`state.tickers.BTCUSDT = { last: 100600 }`); sb.checkPaperLimitOrders();
  ok("…and fills at the limit price, partially, keeping the rest",
    R("paper().orders.length") === 0 && near(R("paper().positions[0].qty"), 0.006) && R("paper().history[0].price") === 100500 && near(R("paper().history[0].qty"), 0.004));

  /* ----------------------------------------------------- demo prices vs real trades */
  reset();
  sb.openPaper("BTCUSDT", 100000, 1000, 3, 1, "manual", 1);             // opened on live prices
  R(`state.dataMode = "demo"`);
  sb.checkPaperPositions("BTCUSDT", 90000);                         // simulated crash through the stop
  ok("simulated prices never close a trade opened on real prices", R("paper().positions.length") === 1);
  sb.openPaper("BTCUSDT", 90000, 900, 0, 0, "manual", 1);
  ok("a trade opened on simulated prices is flagged demo", R("paper().positions[1].demo") === true);
  const bal1 = R("paper().bal");
  R(`state.dataMode = "live"`); sb.voidDemoTrades();
  ok("demo trades are voided (refunded) when live prices return", R("paper().positions.length") === 1 && near(R("paper().bal") - bal1, 900 * 1.001, 1e-6));

  /* -------------------------------------------------------------------- candles */
  reset();
  R(`EX_IDS.forEach((id) => { EX[id].fetchKlines = async () => { throw new Error("down"); }; })`);
  let k = await sb.fetchKlinesSmart("BTCUSDT", "15m", 300);
  ok("live prices + no candles → flagged sample candles, not cached (bot/chart can tell)", k.demo === true && !R(`state.klinesCache["BTCUSDT|15m"]`));
  R(`state.klinesCache["ETHUSDT|15m"] = { at: 0, candles: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] }`);
  k = await sb.fetchKlinesSmart("ETHUSDT", "15m", 300);
  ok("…or the last REAL candles when there are some", !k.demo && k.length === 1);

  /* ------------------------------------------------------------------------ bot */
  const up = trendCandles("BTCUSDT|15m", 300, 100000, 15);
  const lastUp = 100000;
  ok("test data: the trend strategy says LONG on it", R("decide")(sb.TA.analyze(up), up, "trend", false) === 1);
  const botSetup = (cfg) => {
    reset();
    R(`Object.assign(botCfg(), ${JSON.stringify(Object.assign({ strategy: "trend", symbols: ["BTCUSDT"], maxPos: 3, cooldown: 0, size: 50, exitMode: "classic", aiTp: false, tf: "15m", volGuard: false }, cfg))}); bot().running = true;`);
    R(`state.tickers.BTCUSDT = { last: ${lastUp}, chg: 0 }; state.tickers.SOLUSDT = { last: ${lastUp}, chg: 0 }`);
    sb.fetchKlinesSmart = async () => up;
  };
  botSetup();
  for (let i = 0; i < 3; i++) await sb.botEvalSymbol("BTCUSDT", R("botCfg()"));
  const nBot = R(`paper().positions.filter((x) => x.src === "bot").length`);
  ok("the bot opens ONE position per coin (cooldown 0 used to stack 3)", nBot === 1, nBot);

  botSetup();
  R(`state.dataMode = "demo"`);
  await sb.botTickInner(R("bot()"), R("botCfg()"));
  ok("in demo mode the bot waits — no trades on simulated prices", R("paper().positions.length") === 0);

  botSetup();
  const fake = up.slice(); fake.demo = true;
  sb.fetchKlinesSmart = async () => fake;
  await sb.botEvalSymbol("BTCUSDT", R("botCfg()"));
  ok("the bot skips flagged sample candles", R("paper().positions.length") === 0);
  botSetup();
  const old = up.map((c) => Object.assign({}, c, { t: c.t - 6 * 3600000 }));
  sb.fetchKlinesSmart = async () => old;
  await sb.botEvalSymbol("BTCUSDT", R("botCfg()"));
  ok("the bot skips stale candles (last candle hours old)", R("paper().positions.length") === 0);

  /* ------------------------------------------------------ adaptive AI sell rate */
  const adjust = (metrics, px = 100, patterns = { hit: [] }) => {
    sb.aiAdjustPos("BTCUSDT", R("botCfg()"), [{ t: Date.now(), c: px }],
      { metrics: Object.assign({ atr: 1, macdHist: 0, rsi: 50 }, metrics) }, R("bot()"), 0.2, patterns);
  };
  const aiPos = (dir = 1, amount = 50, src = "bot") => {
    const p = sb.openPaper("BTCUSDT", 100, amount, 4, 1, src, dir).pos;
    p.aiTpPct = 4; p.aiTp0 = 4;
    return p;
  };
  reset();
  let ap = aiPos();
  adjust({}, 99);
  ok("AI lowers the original target even while recovering", ap.aiTpPct === 1.41 && ap.aiTp0 === 4 && near(ap.tp, 101.41), ap);
  adjust({ atr: 4 }, 99);
  ok("AI can raise the target again on stronger volatility", ap.aiTpPct === 5.66 && ap.aiTp0 === 4);
  adjust({}, 101);
  ok("AI can lower a profitable trade's target below its original rate", ap.aiTpPct === 1.39 && ap.aiTp0 === 4);
  const heldTp = ap.tp, heldRate = ap.aiTpPct;
  R("botCfg().aiTp = false"); adjust({ atr: 3 });
  ok("AI sell rate OFF freezes existing targets", ap.tp === heldTp && ap.aiTpPct === heldRate);
  R("botCfg().aiTp = true");
  const manual = aiPos(1, 50, "manual"), limit = aiPos(1, 50, "limit");
  adjust({ atr: 2 });
  ok("AI never overwrites manual or limit trade targets", manual.aiTpPct === 4 && limit.aiTpPct === 4 && manual.tp === 104 && limit.tp === 104);

  reset();
  ap = aiPos();
  const sp = aiPos(-1, 50, "bot-dca");
  adjust({}, 100, { hit: [{ side: -1, v: 0.8, name: "bearish reversal" }] });
  ok("reversal is evaluated per direction, not from the first position", ap.aiTpPct === 0.3 && sp.aiTpPct === 1.4 && sp.tp < sp.entry);
  ok("AI updates a DCA trade too", sp.aiTpUpdatedAt > 0 && sp.aiTp0 === 4);
  adjust({ macdHist: 1 });
  ok("positive MACD fades a short but not a long", sp.aiTpPct === 0.3 && ap.aiTpPct === 1.4);
  adjust({ rsi: 80 });
  ok("RSI extreme lowers a long target to the fee-aware floor", ap.aiTpPct === 0.3 && ap.aiTpReason === "RSI extreme");

  reset(); ap = aiPos(1, 1);
  const tinyShort = aiPos(-1, 1);
  R("botCfg().size = 10000; botCfg().minProfit = 0.1");
  adjust({ macdHist: -1 });
  ok("floor uses actual position size, not next buy size, even above the 8% cap", ap.aiTpPct > 8 && sb.posNetPnl(ap, ap.tp) >= 0.1 && sb.posNetPnl(tinyShort, tinyShort.tp) >= 0.1);
  sb.splitPaper(ap, ap.qty / 2); adjust({ macdHist: -1 });
  ok("partial sell remainder still meets the net-profit floor", sb.posNetPnl(ap, ap.tp) >= 0.1);

  reset(); ap = aiPos();
  adjust({}, 103); adjust({}, 100.4);
  ok("peak-profit giveback lowers the target without changing the original", ap.aiTpPct === 0.3 && ap.aiTp0 === 4 && ap.aiTpReason.startsWith("profit lock"));
  R("botCfg().exitMode = 'minprofit'");
  sb.checkPaperPositions("BTCUSDT", 99);
  ok("lowered AI target does not bypass min-profit checks at a loss", R("paper().positions.length") === 1);
  sb.checkPaperPositions("BTCUSDT", 100.4);
  ok("paper exit uses the revised target, not the original 4%", R("paper().positions.length") === 0 && R("paper().history[0].reason") === "profit");

  reset(); ap = aiPos(); R("botCfg().exitMode = 'classic'");
  adjust({ macdHist: -1 }); sb.checkPaperPositions("BTCUSDT", 100.4);
  ok("classic paper TP uses the revised price", R("paper().positions.length") === 0 && near(R("paper().history[0].price"), 100.3));

  reset(); ap = aiPos();
  const protectedPos = JSON.stringify(ap);
  R("state.dataMode = 'demo'"); adjust({ atr: 2 }); R("state.dataMode = 'live'");
  const demoK = [{ t: Date.now(), c: 100 }]; demoK.demo = true;
  for (const badK of [demoK, [{ t: Date.now() - 86400000, c: 100 }], [{ t: Date.now(), c: NaN }], []]) {
    sb.aiAdjustPos("BTCUSDT", R("botCfg()"), badK, { metrics: { atr: 2 } }, R("bot()"), 0.2, { hit: [] });
  }
  ok("demo, stale and invalid data cannot revise real targets", JSON.stringify(ap) === protectedPos);

  reset();
  ap = sb.openPaper("BTCUSDT", 100, 50, 0, 1, "bot", 1).pos;
  const liveAi = { id: "adaptive-live", sym: "BTCUSDT", qty: 0.5, entry: 100, tp: 104, sl: 99 };
  R("bot()").livePos.push(liveAi);
  // Capture debounced persistence requests (the VM normally stubs timers).
  const originalSaveSoon = sb.saveSoon; let saveRequests = 0;
  sb.saveSoon = () => { saveRequests++; sb.save(); };
  adjust({});
  ok("old paper and live positions are adopted, including missing TP/dir", ap.aiTpPct === 1.4 && near(ap.tp, 101.4) && liveAi.aiTpPct === 1.4 && near(liveAi.tp, 101.4) && Number.isFinite(liveAi.peakMove));
  const initialAdopted = liveAi.aiTp0;
  const lastUpdate = ap.aiTpUpdatedAt;
  adjust({ atr: 1.01 });
  ok("noise guard leaves target and update timestamp unchanged", ap.aiTpPct === 1.4 && ap.aiTpUpdatedAt === lastUpdate);
  saveRequests = 0; adjust({}, 100.1);
  ok("peak-only changes request persistence", saveRequests > 0 && ap.peakMove === 0.1);
  adjust({ macdHist: -1 });
  const storedAi = JSON.parse(sb.localStorage.getItem("cryptoai.pro.v2"));
  ok("original and revised rates, reason and timestamp persist for paper + live", storedAi.paper.positions[0].aiTpPct === 0.3 && storedAi.livePos[0].aiTpPct === 0.3 && storedAi.livePos[0].aiTp0 === initialAdopted && storedAi.livePos[0].aiTpUpdatedAt > 0 && storedAi.livePos[0].aiTpReason === "momentum fade");
  R("liveSelling.add('adaptive-live')"); adjust({ atr: 3 }); R("liveSelling.clear()");
  ok("AI does not move the target while a live sell is in flight", liveAi.aiTpPct === 0.3);
  sb.saveSoon = originalSaveSoon;
  R("state.paper = null; state.bot = null; load()");
  ok("saved AI rates survive an app reload", R("paper().positions[0].aiTp0") === 1.4 && R("bot().livePos[0].aiTpPct") === 0.3);

  botSetup({ aiTp: true }); ap = sb.openPaper("BTCUSDT", 100000, 50, 7, 1, "bot", 1).pos;
  ap.aiTpPct = 7; ap.aiTp0 = 7;
  await sb.botEvalSymbol("BTCUSDT", R("botCfg()"));
  ok("normal bot analysis actually invokes adaptive adjustment", ap.aiTpPct !== 7 && ap.aiTp0 === 7 && ap.aiTpUpdatedAt > 0);

  /* ------------------------------------- position controls, audit and exit guard */
  reset(); ap = aiPos();
  R("bot().running = true");
  const unpaused = aiPos(-1);
  ok("one trade can pause AI revisions without changing global settings", sb.setAiTargetPaused(ap.id, false, true) && ap.aiTpPaused && R("botCfg().aiTp") === true);
  adjust({ atr: 2 });
  ok("paused target stays fixed; other positions still adapt", ap.aiTpPct === 4 && ap.tp === 104 && unpaused.aiTpPct === 2.8);
  ok("AI pause control rejects missing and manual positions", !sb.setAiTargetPaused("missing", false, true) && !sb.setAiTargetPaused(aiPos(1, 50, "manual").id, false, true));
  ok("status distinguishes a paused trade", sb.aiRevisionStatus(ap) === "pos.aiPaused");
  sb.save(); R("state.paper = null; state.bot = null; load()");
  ap = R("paper().positions[0]");
  ok("pause survives reload", ap.aiTpPaused === true);
  sb.setAiTargetPaused(ap.id, false, false); adjust({ atr: 2 });
  ok("resume lets fresh analysis revise the target", ap.aiTpPct === 2.8 && ap.aiTpPaused === false);
  for (const [setup, label] of [
    ["bot().running = false", "pos.aiStopped"],
    ["bot().running = true; botCfg().aiTp = false", "pos.aiOff"],
    ["botCfg().aiTp = true; state.dataMode = 'demo'", "pos.aiWaiting"],
    ["state.dataMode = 'live'; botCfg().symbols = []", "pos.aiUnselected"],
    ["botCfg().symbols = ['BTCUSDT']", "pos.aiAuto"],
  ]) { R(setup); ok("AI status: " + label, sb.aiRevisionStatus(ap) === label); }

  reset(); ap = aiPos();
  for (let i = 0; i < 14; i++) adjust({ atr: i % 2 ? 3 : 1 }, 99);
  ok("target audit is newest-first and bounded to 10 entries", ap.aiTpHistory.length === 10 && ap.aiTpHistory[0].to === ap.aiTpPct && ap.aiTpHistory[0].from === ap.aiTpHistory[1].to);
  const auditLength = ap.aiTpHistory.length, latestAudit = ap.aiTpHistory[0];
  adjust({ atr: 3.001 }, 99);
  ok("noise does not create an audit entry", ap.aiTpHistory.length === auditLength && ap.aiTpHistory[0] === latestAudit);
  sb.save(); R("state.paper = null; state.bot = null; load()"); ap = R("paper().positions[0]");
  ok("target audit survives reload", ap.aiTpHistory.length === 10 && ap.aiTpHistory[0].to === ap.aiTpPct);
  const split = sb.splitPaper(ap, ap.qty / 2);
  sb.setAiTargetPaused(split.id, false, true);
  const splitAudit = JSON.stringify(split.aiTpHistory);
  adjust({ atr: 2 }, 99);
  ok("partial position histories are isolated on later updates", JSON.stringify(split.aiTpHistory) === splitAudit && ap.aiTpHistory !== split.aiTpHistory);

  for (const dir of [1, -1]) {
    reset(); ap = aiPos(dir);
    adjust({ atr: 10 }, dir > 0 ? 104 : 96);
    ok("reached " + (dir > 0 ? "long" : "short") + " target is not moved away before exit", ap.aiTpPct === 4 && near(ap.tp, dir > 0 ? 104 : 96) && !ap.aiTpHistory);
    sb.setAiTargetPaused(ap.id, false, true);
    sb.checkPaperPositions("BTCUSDT", dir > 0 ? 104.1 : 95.9);
    ok("pausing AI does not block a paper profit exit (dir " + dir + ")", R("paper().positions.length") === 0);
  }
  reset(); ap = aiPos(); R("botCfg().minProfit = 5");
  adjust({ atr: 10 }, 104);
  ok("reached-target guard does not bypass the minimum net-profit floor", ap.aiTpPct > 4 && sb.posNetPnl(ap, ap.tp) >= 5);

  reset(); ap = aiPos(); adjust({});
  R("state.settings.lang = 'en'; state.tickers.BTCUSDT = { last: 100.1 }");
  sb.paintPositions();
  ok("position card shows fee-adjusted loss despite positive gross movement", els.posList.innerHTML.includes("Estimated net P/L") && els.posList.innerHTML.includes("-$0.05"));
  ok("profit-only positions do not advertise an active stop loss", els.posList.innerHTML.includes("OFF (profit-only mode)"));
  R("botCfg().exitMode = 'classic'"); sb.paintPositions();
  ok("classic paper bot card discloses its minimum-profit stop restriction", els.posList.innerHTML.includes("Paper bot SL waits below minimum profit"));
  ok("position card exposes revision reason, timestamp and history", els.posList.innerHTML.includes("Volatility + conviction") && els.posList.innerHTML.includes("Target updated") && els.posList.innerHTML.includes("Recent target changes"));
  ap.aiTpReason = '<img src=x onerror=alert(1)>';
  ap.aiTpHistory[0].reason = ap.aiTpReason;
  sb.paintPositions();
  ok("target reasons are HTML escaped", !els.posList.innerHTML.includes("<img") && els.posList.innerHTML.includes("&lt;img"));
  R("state.dataMode = 'demo'"); sb.paintPositions();
  ok("simulated quote does not fabricate P/L on a real trade", els.posList.innerHTML.includes("estimate unavailable") && /data-close="[^"]+" disabled/.test(els.posList.innerHTML));
  R("state.dataMode = 'live'; state.tickers = {}; state.settings.liveMode = 'live'");
  const visibleLive = { id: 12345, sym: "BTCUSDT", qty: 0.5, entry: 100, tp: 104, sl: 99, aiTpPct: 4, aiTp0: 4 };
  R("bot()").livePos.push(visibleLive); sb.paintPositions();
  ok("tracked live positions render without fabricating a live quote or paper close button", els.posList.innerHTML.includes("Tracked live bot positions") && els.posList.innerHTML.includes("estimate unavailable") && !els.posList.innerHTML.includes("data-close"));
  ok("live pause handles numeric exchange order ids", sb.setAiTargetPaused("12345", true, true) && visibleLive.aiTpPaused);
  R("liveSelling.add(12345)");
  ok("in-flight live sells cannot be paused or resumed", !sb.setAiTargetPaused("12345", true, false));
  R("liveSelling.clear(); state.paper = null; state.bot = null; load()");
  ok("live pause persists", R("bot().livePos[0].aiTpPaused") === true);
  R("state.settings.lang = 'si'");
  ok("AI reasons and control labels support Sinhala", sb.aiReasonText("momentum fade") === R("t('pos.aiFade')") && !sb.aiTargetPanel(R("bot().livePos[0]"), true, false).includes("Pause AI revisions"));
  R("state.settings.lang = 'en'");

  /* ------------------------------------------------- live orders (mocked bridge) */
  const sent = [];
  let wallet = { BTC: 0, USDT: 1000 }, syncs = 0;
  const signed = (ex) => (m, p, pj) => {
    const q = JSON.parse(pj || "{}");
    if (/account|wallet-balance/.test(p)) return JSON.stringify(ex === "bybit"
      ? { retCode: 0, result: { list: [{ coin: Object.keys(wallet).map((c) => ({ coin: c, walletBalance: String(wallet[c]) })) }] } }
      : { balances: Object.keys(wallet).map((a) => ({ asset: a, free: String(wallet[a]), locked: "0" })) });
    sent.push(Object.assign({ ex }, q));
    if (ex === "bybit") return JSON.stringify({ retCode: 0, result: { orderId: "b" + sent.length } });
    const qty = +q.quantity, px = 100000;
    if (q.side === "BUY") { wallet.BTC += qty * 0.999; return JSON.stringify({ orderId: sent.length, executedQty: q.quantity, cummulativeQuoteQty: String(qty * px), fills: [{ price: String(px), qty: q.quantity, commission: String(qty * 0.001), commissionAsset: "BTC" }] }); }
    if (qty > wallet.BTC + 1e-12) return JSON.stringify({ code: -2010, msg: "Account has insufficient balance for requested action." });
    wallet.BTC -= qty; return JSON.stringify({ orderId: sent.length, executedQty: q.quantity });
  };
  const bridge = {
    binanceSigned: signed("binance"), bybitSigned: signed("bybit"),
    binanceSyncTime: () => { syncs++; return 0; }, bybitSyncTime: () => { syncs++; return 0; },
  };
  const phone = [];
  sb.bc = (m, ...a) => { phone.push([m, a[0]]); return bridge[m] ? bridge[m](...a) : null; };
  sb.httpGet = async (url) => /bybit/.test(url)
    ? JSON.stringify({ retCode: 0, result: { list: [{ lotSizeFilter: { basePrecision: "0.000001", minOrderQty: "0.000011", minOrderAmt: "5" } }] } })
    : JSON.stringify({ symbols: [{ filters: [{ filterType: "LOT_SIZE", stepSize: "0.00001000", minQty: "0.00001000" }] }] });

  ok("roundQty keeps exact steps (1.13 / 0.01 used to give 1.12)", sb.roundQty(1.13, { step: 0.01, dp: 2 }) === 1.13 && sb.roundQty(0.00045, { step: 0.00001, dp: 5 }) === 0.00045 && sb.roundQty(0.25, { step: 0.00001, dp: 5 }) === 0.25);
  ok("plainNum never sends exponent notation", R("plainNum(1e-7)") === "0.0000001" && R("plainNum(112000)") === "112000" && R("plainNum(0.0005, 5)") === "0.00050");

  R(`state.settings.exchange = "bybit"; qtyFilters = {}`);
  await sb.livePlaceOrder("BTCUSDT", "BUY", 0.0005, 100000, "MARKET");
  let o = sent[sent.length - 1];
  ok("Bybit market order: orderType \"Market\", qty in coins (marketUnit baseCoin)", o.orderType === "Market" && o.marketUnit === "baseCoin" && o.qty === "0.000500", o);
  await sb.livePlaceOrder("BTCUSDT", "BUY", 0.001, 99000, "LIMIT");
  o = sent[sent.length - 1];
  ok("Bybit limit order: orderType \"Limit\" with price + GTC (price used to be dropped)", o.orderType === "Limit" && o.price === "99000" && o.timeInForce === "GTC", o);
  ok("Bybit step read from basePrecision (\"0.000001\" is the step, not a decimal count)", near(R(`qtyFilters.BTCUSDT.step`), 0.000001));
  ok("the exchange clock is synced before signed calls", syncs >= 1);

  R(`state.settings.exchange = "binance"; qtyFilters = {}`);
  const fill = sb.liveFill({ executedQty: "0.00050", cummulativeQuoteQty: "50.1", fills: [{ commission: "0.0000005", commissionAsset: "BTC" }] }, "BTCUSDT", 0.0005, 99000);
  ok("live BUY books the executed qty minus the coin fee, at the average fill price", near(fill.qty, 0.0004995) && near(fill.price, 100200, 1e-6), fill);

  // bot live flow: buy → saved → one per coin → max positions counts it → stop → watchdog sells what is held
  reset(); sent.length = 0; wallet = { BTC: 0, USDT: 1000 };
  R(`state.settings.exchange = "binance"; state.settings.liveMode = "live"; qtyFilters = {}`);
  R(`Object.assign(botCfg(), { strategy: "trend", symbols: ["BTCUSDT", "SOLUSDT"], maxPos: 1, cooldown: 0, size: 50, exitMode: "minprofit", minProfit: 0.01, aiTp: false, tf: "15m", volGuard: false }); bot().running = true;`);
  R(`state.tickers.BTCUSDT = { last: 100000, chg: 0 }; state.tickers.SOLUSDT = { last: 200, chg: 0 }`);
  const kB = trendCandles("BTCUSDT|15m", 300, 100000, 15), kS = trendCandles("SOLUSDT|15m", 300, 200, 15);
  sb.fetchKlinesSmart = async (s) => (s === "BTCUSDT" ? kB : kS);
  for (let i = 0; i < 3; i++) { await sb.botEvalSymbol("BTCUSDT", R("botCfg()")); await sb.botEvalSymbol("SOLUSDT", R("botCfg()")); }
  const buys = sent.filter((x) => x.side === "BUY");
  ok("live bot: one buy per coin, and Max positions counts live positions", buys.length === 1 && buys[0].symbol === "BTCUSDT", buys.map((x) => x.symbol));
  const saved = JSON.parse(sb.localStorage.getItem("cryptoai.pro.v2") || "{}");
  ok("live positions are saved (they used to vanish on restart)", Array.isArray(saved.livePos) && saved.livePos.length === 1 && near(saved.livePos[0].qty, 0.0004995));
  phone.length = 0;
  await sb.botStop();                                                 // ■ Stop with an open live position
  const sells = sent.filter((x) => x.side === "SELL");
  const parkedTp = R("plainNum(bot().livePos[0].parkedPx)");
  ok("after Stop a resting LIMIT sell stays on the exchange", sells.length === 1 && sells[0].type === "LIMIT" && sells[0].timeInForce === "GTC" && sells[0].quantity === "0.00049" && sells[0].price === parkedTp, sells[0]);
  ok("the live position stays until the exchange fills that order", R("bot().livePos.length") === 1 && !!R("bot().livePos[0].exitOrderId"));
  ok("Stop does not keep the phone awake", R("bot().running") === false && R("bot().watchdog") === false
    && phone.some((c) => c[0] === "stopBgService")
    && phone.some((c) => c[0] === "setTradingActive" && c[1] === false)
    && phone.some((c) => c[0] === "setKeepScreenOn" && c[1] === false)
    && !phone.some((c) => c[0] === "startBgService" || c[0] === "requestBatteryExemption" || (c[0] === "setTradingActive" && c[1] === true) || (c[0] === "setKeepScreenOn" && c[1] === true)));
  phone.length = 0;
  sb.liveWatchdogResume();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  ok("reopening does not start the wake-lock service for a parked live exit", !phone.some((c) => c[0] === "startBgService" || (c[0] === "setTradingActive" && c[1] === true)) && sent.filter((x) => x.side === "SELL").length === 1);

  reset(); sent.length = 0; wallet = { BTC: 0.0005, USDT: 1000 };
  R(`state.settings.exchange = "binance"; state.settings.liveMode = "live"; state.dataMode = "live"; qtyFilters = {}; bot().running = false; botCfg().exitMode = "classic";`);
  R(`bot().livePos = [{ id: "c1", sym: "BTCUSDT", qty: 0.0005, entry: 100000, tp: 104000, sl: 99000 }]`);
  await sb.parkLiveExits();
  const oco = sent.filter((x) => x.stopPrice);
  ok("classic Stop parks a Binance OCO so both target and stop live on the exchange", oco.length === 1 && oco[0].side === "SELL" && oco[0].price === "104000" && oco[0].stopPrice === "99000" && oco[0].stopLimitTimeInForce === "GTC", oco[0]);

  R(`state.dataMode = "demo"; bot().running = true; bot().watchdog = false; bot().livePos = [{ sym: "BTCUSDT", qty: 0.0004, entry: 90000, tp: 91000, sl: 89000, id: "x" }]`);
  sent.length = 0; sb.botOnTick("BTCUSDT", 100600);
  await new Promise((r) => setImmediate(r));
  ok("no real orders while the prices are simulated", sent.length === 0);

  for (const mode of ["minprofit", "classic"]) {
    reset(); sent.length = 0; wallet = { BTC: 0.0005, USDT: 1000 };
    R(`state.settings.exchange = "binance"; state.settings.liveMode = "live"; qtyFilters = {}; bot().running = true; botCfg().exitMode = "${mode}"; botCfg().aiTp = true;`);
    const lp = { id: "ai-exit-" + mode, sym: "BTCUSDT", qty: 0.0005, entry: 100000, tp: 104000, sl: 99000, aiTp0: 4, aiTpPct: 4 };
    R("bot()").livePos.push(lp);
    sb.aiAdjustPos("BTCUSDT", R("botCfg()"), [{ t: Date.now(), c: 100400 }],
      { metrics: { atr: 1000, macdHist: -1, rsi: 50 } }, R("bot()"), 0.2, { hit: [] });
    sb.setAiTargetPaused(lp.id, true, true);
    sb.botOnTick("BTCUSDT", 100400);
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    ok("live " + mode + " exit uses the revised AI target even while revisions are paused (mock exchange)", lp.aiTpPct === 0.3 && lp.aiTp0 === 4 && sent.filter((x) => x.side === "SELL").length === 1 && R("bot().livePos.length") === 0);
  }

  /* ------------------------------------------------------------ backtest + brain */
  const bt = sb.TA.backtest(candles(400, 100, 0.001, 5), { minScore: 10, tpPct: 1.5, slPct: 0.8, feePct: 0.1 });
  const tr = bt.last.find((x) => x.reason === "TP") || bt.last[0];
  ok("backtest uses TP / SL percentages (the app passed 0.3 × ATR ≈ 0.12 %)", tr && (tr.reason === "TP" ? near(tr.exit / tr.entry - 1, 0.015, 1e-9) : near(1 - tr.exit / tr.entry, 0.008, 1e-9)), tr);

  const Brain = sb.Brain;
  const st0 = Brain.stats();
  Brain.trainHistory(candles(500, 100, 0.0015, 15));
  const st1 = Brain.stats();
  ok("history training no longer counts as live wins / losses (inflated \"Win rate\")", st1.n === st0.n && st1.wins === st0.wins && st1.losses === st0.losses && st1.hs > st0.hs, { st0: [st0.n, st0.wins], st1: [st1.n, st1.wins, st1.hs] });

  ok("MACD hist is readable (\"+250\", not \"+2.5e+2\")", R("fmtSig(250.4)") === "250" && R("fmtSig(2.534)") === "2.53" && R("fmtSig(0.000123)") === "0.00012");

  console.log(`\n${n - fails}/${n} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("test crashed:", e); process.exit(1); });
