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
  sb.bc = (m, ...a) => (bridge[m] ? bridge[m](...a) : null);
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
  R(`bot().running = false; bot().watchdog = true`);                   // ■ Stop with an open live position
  sb.botOnTick("BTCUSDT", 100600);
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  const sells = sent.filter((x) => x.side === "SELL");
  ok("after Stop the watchdog sells the live position (it never did)", sells.length === 1, sent);
  ok("…and sells what the wallet holds, rounded to the step (0.00049, not 0.0005 → -2010)", sells[0] && sells[0].quantity === "0.00049" && R("bot().livePos.length") === 0, sells[0]);

  R(`state.dataMode = "demo"; bot().running = true; bot().watchdog = false; bot().livePos = [{ sym: "BTCUSDT", qty: 0.0004, entry: 90000, tp: 91000, sl: 89000, id: "x" }]`);
  sent.length = 0; sb.botOnTick("BTCUSDT", 100600);
  await new Promise((r) => setImmediate(r));
  ok("no real orders while the prices are simulated", sent.length === 0);

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
