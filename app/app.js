/* ============================================================================
 * CryptoAI PRO — app.js
 * Sinhala + English crypto terminal: markets, candles, TA signals, paper/live
 * trading, auto-bot with risk limits, alerts and an optional AI explanation.
 *
 * Runs inside the Android WebView (window.AndroidBridge from Kotlin) and in a
 * plain browser (fetch instead of the bridge, paper mode only).
 * ========================================================================== */
"use strict";

/* ------------------------------------------------------------------ bridge */
const B = (typeof window !== "undefined" && window.AndroidBridge) ? window.AndroidBridge : null;

/** Call a bridge method safely; returns null when unavailable or throwing. */
function bc(method, ...args) {
  if (!B || typeof B[method] !== "function") return null;
  try { return B[method](...args); } catch (e) { console.warn("bridge " + method, e); return null; }
}
const hasBridge = () => !!B;

/* ------------------------------------------------------------------- utils */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const now = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 9);
const dayKey = (d) => new Date(d || now()).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtPrice(v) {
  v = Number(v);
  if (!isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1) return v.toFixed(a >= 100 ? 2 : 4);
  if (a >= 0.01) return v.toFixed(5);
  if (a >= 0.0001) return v.toFixed(6);
  return v.toPrecision(4);
}
function fmtQty(v) {
  v = Number(v);
  if (!isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(v) >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return v.toPrecision(5);
}
const fmtUsd = (v) => (v < 0 ? "-" : "") + "$" + Math.abs(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => (v > 0 ? "+" : "") + (Number(v) || 0).toFixed(2) + "%";
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const ago = (ts) => { const s = Math.floor((now() - ts) / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h"; };

/* --------------------------------------------------------------------- i18n */
const STR = {
  en: {
    "nav.markets": "Markets", "nav.chart": "Chart", "nav.signals": "Signal", "nav.trade": "Trade", "nav.bot": "Bot",
    "conn.live": "live", "conn.demo": "demo data", "conn.off": "offline", "conn.loading": "loading…",
    "sort.vol": "🔥 Top volume", "sort.gain": "📈 Gainers", "sort.loss": "📉 Losers", "sort.fav": "★ Watchlist",
    "demo.note": "⚠ No exchange connection — showing simulated demo data. Signals & bot work, prices are not real.",
    "m.note": "Tap a market to open its chart. Paper trading uses live prices; live trading needs API keys.",
    "chart.hint": "Drag on the chart to inspect candles.",
    "chart.analyse": "📊 Analyse", "chart.alert": "🔔 Alert", "chart.trade": "💱 Trade",
    "sig.blocks": "Signal blocks", "sig.trend": "Trend / momentum", "sig.revert": "Oscillator extremes",
    "sig.why": "Why", "sig.ind": "Indicators", "sig.plan": "Trade plan (ATR based)",
    "sig.planNote": "Entry / target / stop are derived from volatility (ATR). Not financial advice.",
    "sig.wait": "wait for a clearer setup", "sig.entry": "Entry", "sig.tp": "Target", "sig.sl": "Stop", "sig.rr": "Reward : risk",
    "sig.confidence": "confidence", "sig.none": "Not enough data for a signal yet.",
    "VERDICT.STRONG BUY": "STRONG BUY", "VERDICT.BUY": "BUY", "VERDICT.NEUTRAL": "NEUTRAL — WAIT",
    "VERDICT.SELL": "SELL", "VERDICT.STRONG SELL": "STRONG SELL",
    "trade.paper": "📝 Paper", "trade.live": "⚡ Live", "trade.balance": "Balance", "trade.equity": "Equity",
    "trade.free": "Free USDT", "trade.pos": "Positions", "trade.orders": "Open orders", "trade.history": "History",
    "trade.order": "Order", "trade.market": "Market", "trade.limit": "Limit", "trade.limitPrice": "Limit price",
    "trade.amount": "Amount", "trade.tp": "TP %", "trade.sl": "SL %", "trade.none": "Nothing here yet.",
    "trade.paperNote": "Paper mode — orders are simulated with a 0.10% fee, real fees can be higher.",
    "trade.liveNote": "Live mode — orders go to your exchange account with real money.",
    "trade.needKeys": "Add API keys in settings to trade live (read + trade permission only, never withdrawal).",
    "trade.browserNote": "Live trading works in the Android app (API requests are signed on-device). In a browser only paper mode is available.",
    "trade.buy": "BUY", "trade.sell": "SELL", "trade.est": "est.",
    "trade.confirmLive": "Send this LIVE order to the exchange?",
    "trade.placed": "Order placed", "trade.filled": "Filled", "trade.closed": "Closed", "trade.tp": "Target hit", "trade.sl": "Stop hit",
    "trade.insufficient": "Not enough balance",
    "pos.entry": "entry", "pos.now": "now", "pos.pnl": "P&L", "pos.close": "Close", "pos.breakEven": "Break-even",
    "bot.title": "Bot", "bot.idle": "Idle", "bot.running": "Running", "bot.stopped": "Stopped",
    "bot.strategy": "Strategy", "bot.symbols": "Symbols", "bot.timeframe": "Timeframe",
    "bot.size": "Order size (USDT)", "bot.short": "Allow short (sell first)", "bot.notify": "Notifications & voice",
    "bot.keep": "Keep screen awake", "bot.risk": "Risk limits", "bot.maxPos": "Max positions",
    "bot.cool": "Cooldown (min)", "bot.daily": "Daily loss stop", "bot.start": "▶ Start bot", "bot.stop": "■ Stop",
    "bot.log": "Activity log", "bot.clear": "clear",
    "bot.stat.signals": "Signals", "bot.stat.trades": "Trades", "bot.stat.win": "Win rate", "bot.stat.pnl": "Bot P&L",
    "bot.riskNote": "The bot stops itself when the daily loss limit is hit. Duplicate entries per symbol are blocked for the cooldown window.",
    "bot.strat.signal": "AI signal (trend + oscillators)",
    "bot.strat.trend": "Trend follower (EMA cross + MACD)",
    "bot.strat.revert": "Mean reversion (RSI extremes)",
    "bot.strat.breakout": "Breakout (Donchian 20)",
    "bot.desc.signal": "Opens when the blended signal score passes the threshold; target/stop from ATR.",
    "bot.desc.trend": "Long while EMA20 > EMA50 and MACD histogram is positive; exits when structure flips.",
    "bot.desc.revert": "Buys oversold (RSI < 30) and sells overbought (RSI > 70) with tight stops.",
    "bot.desc.breakout": "Buys a close above the 20-bar high, sells below the 20-bar low.",
    "bot.started": "Bot started", "bot.stopped": "Bot stopped", "bot.dailyStop": "Daily loss limit reached — bot stopped",
    "bot.noSymbol": "Pick at least one symbol.",
    "set.title": "Settings", "set.general": "General", "set.lang": "Language", "set.sound": "Sound alerts",
    "set.haptic": "Haptic feedback", "set.tts": "Speak signals (TTS)", "set.keep": "Keep screen awake",
    "set.data": "Market data", "set.exchange": "Exchange (public data)", "set.testnet": "Testnet / demo keys",
    "set.exNote": "Public price data needs no account. Signals, chart and paper trading work without any key.",
    "set.keys": "API keys (live trading)", "set.save": "Save", "set.test": "Test connection", "set.clear": "Delete keys",
    "set.keyWarn": "Use keys with trading enabled and withdrawal DISABLED. Keys are stored in this app's private storage and only used to sign requests on your device.",
    "set.keySaved": "Keys saved", "set.keyOk": "Connection OK", "set.keyFail": "Connection failed",
    "set.noKeys": "No keys saved",
    "set.aiTitle": "AI explanation (optional)", "set.aiProv": "Provider", "set.aiModel": "Model",
    "set.aiNote": "With a key, the AI turns the indicator report into plain language. Without one, the built-in rule-based explanation is used.",
    "set.paper": "Paper account", "set.resetPaper": "Reset to 10,000 USDT", "set.wipe": "Erase all data",
    "set.about": "About", "set.version": "Version", "set.engine": "TA engine", "set.mode": "Runtime",
    "set.disclaimer": "Educational tool. Crypto trading is risky — you can lose money. Signals are not financial advice; never trade more than you can afford to lose.",
    "sym.title": "Choose market",
    "alert.title": "Price alert", "alert.price": "Price", "alert.when": "When", "alert.above": "Rises above",
    "alert.below": "Falls below", "alert.add": "Add alert", "alert.list": "Active alerts", "alert.none": "No alerts yet.",
    "alert.hit": "Price alert", "alert.needPrice": "Enter a price",
    "ai.off": "Off (built-in rules)", "ai.custom": "Custom (OpenAI compatible)",
    "cancel": "Cancel", "confirm": "Confirm",
    "ok": "OK", "error": "Error", "saved": "Saved", "copied": "Copied",
    "ai.title": "AI explanation", "ai.generate": "Generate",
    "ai.needKey": "Add an AI key in settings — or use the built-in explanation.",
    "ai.thinking": "Asking the AI…",
    "bt.run": "🧪 Backtest", "bt.running": "Running…", "bt.header": "Backtest (last {n} candles, 0.10% fee/side)",
    "bt.result": "{trades} trades · win rate {win}% · net {pnl}% · max drawdown {dd}% · buy&hold {bh}%",
    "bt.few": "Not enough history to backtest.",
    "bt.disclaimer": "Past performance does not predict the future.",
    "live.unsupported": "Live trading is only available in the Android app.",
    "scan.run": "🔎 Scan all signals", "scan.title": "Signal scan", "scan.stop": "Stop",
    "scan.running": "Scanning {done}/{total}…", "scan.result": "{n} pairs on {tf} · {strong} strong",
    "scan.empty": "Run a scan to rank every market by signal strength.",
    "mtf.title": "Multi-timeframe", "mtf.refresh": "Refresh", "mtf.consensus": "Consensus",
    "mtf.note": "When several timeframes agree, the setup is stronger than a single reading.",
    "calc.title": "Position size calculator", "calc.account": "Account (USDT)", "calc.risk": "Risk %",
    "calc.stop": "Stop price", "calc.size": "Position size", "calc.notional": "Notional", "calc.riskAmt": "Risk",
    "calc.use": "Use this size in the order",
    "calc.badStop": "The stop must be below the entry price for a long (above it for a short).",
    "stats.title": "Paper statistics", "stats.trades": "Closed trades", "stats.win": "Win rate",
    "stats.expect": "Expectancy / trade", "stats.pf": "Profit factor", "stats.equity": "Equity curve (paper)",
    "stats.none": "Close a few paper trades to see statistics.",
  },
  si: {
    "nav.markets": "වෙළඳපොල", "nav.chart": "ප්‍රස්තාරය", "nav.signals": "සංඥා", "nav.trade": "වෙළඳාම", "nav.bot": "රොබෝ",
    "conn.live": "සජීවී", "conn.demo": "නියැදි දත්ත", "conn.off": "නොබැඳි", "conn.loading": "පූරණය…",
    "sort.vol": "🔥 වැඩිම පරිමාව", "sort.gain": "📈 ඉහළ ගිය", "sort.loss": "📉 පහළ ගිය", "sort.fav": "★ මගේ ලැයිස්තුව",
    "demo.note": "⚠ හුවමාරු සම්බන්ධතාවක් නැත — නියැදි (demo) දත්ත පෙන්වයි. සංඥා සහ රොබෝ වැඩ කරයි, මිල සැබෑ නොවේ.",
    "m.note": "මිල සටහන බැලීමට යම් කොයින් එකක් ඔබන්න. Paper වෙළඳාම සජීවී මිල භාවිතා කරයි; සැබෑ වෙළඳාමට API යතුරු අවශ්‍යයි.",
    "chart.hint": "කැන්ඩල් බැලීමට ප්‍රස්තාරය මත ඇඟිල්ල අදින්න.",
    "chart.analyse": "📊 විශ්ලේෂණය", "chart.alert": "🔔 සටහන්", "chart.trade": "💱 වෙළඳාම",
    "sig.blocks": "සංඥා කොටස්", "sig.trend": "ප්‍රවණතාව / ගමන් වේගය", "sig.revert": "Oscillator අන්ත",
    "sig.why": "හේතු", "sig.ind": "දර්ශක", "sig.plan": "වෙළඳ සැලැස්ම (ATR මත)",
    "sig.planNote": "ඇතුළත් වීම / ඉලක්කය / නැවතුම වෙනස්වීම් (ATR) මත ගණනය කර ඇත. මෙය ආයෝජන උපදෙසක් නොවේ.",
    "sig.wait": "පැහැදිලි සංඥාවක් එනතුරු ඉන්න", "sig.entry": "ඇතුල්වීම", "sig.tp": "ඉලක්කය", "sig.sl": "නැවතුම", "sig.rr": "ලාභ : අවදානම",
    "sig.confidence": "විශ්වාසය", "sig.none": "සංඥාවක් සඳහා ප්‍රමාණවත් දත්ත නැත.",
    "VERDICT.STRONG BUY": "ශක්තිමත් මිලදී ගැනීම", "VERDICT.BUY": "මිලදී ගන්න", "VERDICT.NEUTRAL": "රැඳී සිටින්න",
    "VERDICT.SELL": "විකුණන්න", "VERDICT.STRONG SELL": "ශක්තිමත් විකුණුම්",
    "trade.paper": "📝 පුහුණු", "trade.live": "⚡ සැබෑ", "trade.balance": "ශේෂය", "trade.equity": "මුළු වටිනාකම",
    "trade.free": "නිදහස් USDT", "trade.pos": "ස්ථාපන", "trade.orders": "විවෘත ඇණවුම්", "trade.history": "ඉතිහාසය",
    "trade.order": "ඇණවුම", "trade.market": "වෙළඳපොල", "trade.limit": "සීමා", "trade.limitPrice": "සීමා මිල",
    "trade.amount": "ප්‍රමාණය", "trade.tp": "TP %", "trade.sl": "SL %", "trade.none": "තවම කිසිවක් නැත.",
    "trade.paperNote": "පුහුණු (paper) ලෙස — 0.10% ගාස්තුවක් යොදා ගණනය කරයි; සැබෑ ගාස්තු වැඩි විය හැක.",
    "trade.liveNote": "සැබෑ ලෙස — ඇණවුම් ඔබේ හුවමාරු ගිණුමට සැබෑ මුදලින් යයි.",
    "trade.needKeys": "සැබෑ වෙළඳාමට සැකසුම්වල API යතුරු එක් කරන්න (trade අවසරය පමණක් දෙන්න, withdrawal කිසිසේත් නොදෙන්න).",
    "trade.browserNote": "සැබෑ වෙළඳාම Android app එකේදී පමණක් (API ඉල්ලීම් උපාංගයේදීම අත්සන් වේ). බ්‍රව්සරයේ paper mode පමණි.",
    "trade.buy": "මිලදී ගන්න", "trade.sell": "විකුණන්න", "trade.est": "ඇස්තමේන්තු",
    "trade.confirmLive": "මේ සැබෑ ඇණවුම හුවමාරුවට යවන්නද?",
    "trade.placed": "ඇණවුම යවන ලදී", "trade.filled": "සම්පූර්ණයි", "trade.closed": "වසා දමන ලදී", "trade.tp": "ඉලක්කය වැදුණි", "trade.sl": "නැවතුම වැදුණි",
    "trade.insufficient": "ශේෂය ප්‍රමාණවත් නැත",
    "pos.entry": "ඇතුල් මිල", "pos.now": "දැන්", "pos.pnl": "ලාභ/පාඩුව", "pos.close": "වසන්න", "pos.breakEven": "සමතුලිත",
    "bot.title": "රොබෝ", "bot.idle": "නිශ්චල", "bot.running": "ක්‍රියාත්මක", "bot.stopped": "නවතා ඇත",
    "bot.strategy": "උපාය", "bot.symbols": "කොයින්", "bot.timeframe": "කාල රාමුව",
    "bot.size": "ඇණවුම් ප්‍රමාණය (USDT)", "bot.short": "Short වෙළඳාම (මුලින් විකුණුම්)", "bot.notify": "දැනුම්දීම් සහ හඬ",
    "bot.keep": "තිරය අවදිව තබන්න", "bot.risk": "අවදානම් සීමා", "bot.maxPos": "උපරිම ස්ථාපන",
    "bot.cool": "නැවත ඇතුල්වීමට (මිනි)", "bot.daily": "දෛනික පාඩු සීමාව", "bot.start": "▶ රොබෝ අරඹන්න", "bot.stop": "■ නවත්වන්න",
    "bot.log": "ක්‍රියාකාරකම් සටහන", "bot.clear": "මකන්න",
    "bot.stat.signals": "සංඥා", "bot.stat.trades": "වෙළඳාම්", "bot.stat.win": "දිනුම් %", "bot.stat.pnl": "රොබෝ ලාභය",
    "bot.riskNote": "දෛනික පාඩු සීමාවට ළඟා වූ විට රොබෝ තමන්ම නවතී. එකම කොයින් එකට නැවත ඇතුල්වීම නියමිත කාලයක් තුළ අවහිරයි.",
    "bot.strat.signal": "AI සංඥාව (ප්‍රවණතාව + oscillators)",
    "bot.strat.trend": "ප්‍රවණතාව අනුගමනය (EMA cross + MACD)",
    "bot.strat.revert": "මිල ආපසු හැරවීම (RSI අන්ත)",
    "bot.strat.breakout": "බිඳීම (Donchian 20)",
    "bot.desc.signal": "සංඥා ලකුණු සීමාව පසු කළ විට ඇතුල් වේ; ඉලක්කය/නැවතුම ATR මත.",
    "bot.desc.trend": "EMA20 > EMA50 සහ MACD ධනාත්මක විට buy; ව්‍යුහය පෙරළෙන විට පිටවීම.",
    "bot.desc.revert": "RSI < 30 විට මිලදී ගනී, RSI > 70 විට විකුණයි — කුඩා නැවතුම් සමඟ.",
    "bot.desc.breakout": "20-කැන්ඩල් ඉහළම මිලට ඉහළින් වැසුණු විට buy, පහළම මිලට පහළින් විකුණුම්.",
    "bot.started": "රොබෝ ආරම්භ කළා", "bot.stopped": "රොබෝ නැවැත්වූවා", "bot.dailyStop": "දෛනික පාඩු සීමාවට ළඟා විය — රොබෝ නැවතුණි",
    "bot.noSymbol": "අවම වශයෙන් එක් කොයින් එකක් තෝරන්න.",
    "set.title": "සැකසුම්", "set.general": "සාමාන්‍ය", "set.lang": "භාෂාව", "set.sound": "හඬ දැනුම්දීම්",
    "set.haptic": "කම්පන ප්‍රතිචාර", "set.tts": "සංඥා හඬින් කියවන්න (TTS)", "set.keep": "තිරය අවදිව තබන්න",
    "set.data": "වෙළඳපොල දත්ත", "set.exchange": "හුවමාරුව (පොදු දත්ත)", "set.testnet": "Testnet / නියැදි යතුරු",
    "set.exNote": "පොදු මිල දත්ත සඳහා ගිණුමක් අවශ්‍ය නැත. සංඥා, ප්‍රස්තාරය සහ paper වෙළඳාම යතුරක් නැතුවම වැඩ කරයි.",
    "set.keys": "API යතුරු (සැබෑ වෙළඳාම)", "set.save": "සුරකින්න", "set.test": "සම්බන්ධතාව පරීක්ෂා කරන්න", "set.clear": "යතුරු මකන්න",
    "set.keyWarn": "වෙළඳාමට අවසර දී ඇති, නමුත් withdrawal අක්‍රීය කර ඇති යතුරු පමණක් භාවිතා කරන්න. යතුරු මේ app එකේ පෞද්ගලික ගබඩාවේ තබා, ඉල්ලීම් අත්සන් කිරීමට පමණක් භාවිතා කරයි.",
    "set.keySaved": "යතුරු සුරැකුණි", "set.keyOk": "සම්බන්ධතාව සාර්ථකයි", "set.keyFail": "සම්බන්ධතාව අසාර්ථකයි",
    "set.noKeys": "යතුරු සුරකා නැත",
    "set.aiTitle": "AI පැහැදිලි කිරීම (විකල්ප)", "set.aiProv": "සේවා සපයන්නා", "set.aiModel": "මාදිලිය",
    "set.aiNote": "යතුරක් තිබේ නම් AI එක දර්ශක වාර්තාව සරල භාෂාවට හරවයි. නැත්නම් ගොඩනඟා ඇති රීති මත පැහැදිලි කිරීම භාවිතා වේ.",
    "set.paper": "පුහුණු ගිණුම", "set.resetPaper": "10,000 USDT ලෙස නැවත සකසන්න", "set.wipe": "සියලු දත්ත මකන්න",
    "set.about": "පිළිබඳව", "set.version": "අනුවාදය", "set.engine": "TA එන්ජිම", "set.mode": "ධාවන පරිසරය",
    "set.disclaimer": "අධ්‍යාපනික මෙවලමක් පමණි. Crypto වෙළඳාම අවදානම් සහිතයි — මුදල් අහිමි විය හැක. සංඥා ආයෝජන උපදෙස් නොවේ; ඔබට අහිමි කර ගැනීමට හැකි මුදලට වඩා කිසිසේත් වෙළඳාම් නොකරන්න.",
    "sym.title": "වෙළඳපොල තෝරන්න",
    "alert.title": "මිල සටහන", "alert.price": "මිල", "alert.when": "කවදාද", "alert.above": "ඉහළ ගිය විට",
    "alert.below": "පහළ ගිය විට", "alert.add": "සටහන එක් කරන්න", "alert.list": "සක්‍රීය සටහන්", "alert.none": "තවම සටහන් නැත.",
    "alert.hit": "මිල සටහන", "alert.needPrice": "මිලක් ඇතුළත් කරන්න",
    "ai.off": "නිවා දමන්න (ගොඩනඟා ඇති රීති)", "ai.custom": "ඔබේම (OpenAI අනුකූල)",
    "cancel": "අවලංගු", "confirm": "තහවුරු",
    "ok": "හරි", "error": "දෝෂයක්", "saved": "සුරැකුණි", "copied": "පිටපත් විය",
    "ai.title": "AI පැහැදිලි කිරීම", "ai.generate": "සාදන්න",
    "ai.needKey": "සැකසුම්වල AI යතුරක් එක් කරන්න — නැත්නම් ගොඩනඟා ඇති පැහැදිලි කිරීම භාවිතා කරන්න.",
    "ai.thinking": "AI එකෙන් අසමින්…",
    "bt.run": "🧪 පසුපරීක්ෂාව", "bt.running": "ක්‍රියාත්මක…", "bt.header": "පසුපරීක්ෂාව (අවසන් කැන්ඩල් {n}, ගාස්තු 0.10%/පැත්ත)",
    "bt.result": "වෙළඳාම් {trades} · දිනුම් {win}% · ශුද්ධ ලාභය {pnl}% · උපරිම බැස්ම {dd}% · buy&hold {bh}%",
    "bt.few": "පසුපරීක්ෂාවට ප්‍රමාණවත් ඉතිහාසයක් නැත.",
    "bt.disclaimer": "අතීත ප්‍රතිඵල අනාගතය සහතික නොකරයි.",
    "live.unsupported": "සැබෑ වෙළඳාම Android app එකේදී පමණි.",
    "scan.run": "🔎 හැම සංඥාවම scan කරන්න", "scan.title": "සංඥා scan", "scan.stop": "නවත්වන්න",
    "scan.running": "Scan වෙමින් {done}/{total}…", "scan.result": "{tf} මත කොයින් {n}ක් · ශක්තිමත් {strong}ක්",
    "scan.empty": "හැම වෙළඳපොලක්ම සංඥා ශක්තිය අනුව ශ්‍රේණිගත කරන්න scan එකක් run කරන්න.",
    "mtf.title": "කාල රාමු කිහිපයක්", "mtf.refresh": "යාවත්කාලීන", "mtf.consensus": "එකඟතාව",
    "mtf.note": "කාල රාමු කිහිපයක් එකඟ වන විට, තනි කියවීමකට වඩා එම සැකසුම ශක්තිමත්.",
    "calc.title": "ස්ථාන ප්‍රමාණ ගණකය", "calc.account": "ගිණුම (USDT)", "calc.risk": "අවදානම %",
    "calc.stop": "නැවතුම් මිල", "calc.size": "ප්‍රමාණය", "calc.notional": "වටිනාකම", "calc.riskAmt": "අවදානම",
    "calc.use": "මේ ප්‍රමාණය ඇණවුමට දාන්න",
    "calc.badStop": "Long එකකට නැවතුම් මිල ඇතුල් මිලට පහළින් විය යුතුයි (short එකකට ඉහළින්).",
    "stats.title": "පුහුණු සංඛ්‍යාලේඛන", "stats.trades": "වසා දැමූ වෙළඳාම්", "stats.win": "දිනුම් %",
    "stats.expect": "එක් වෙළඳාමක බලාපොරොත්තුව", "stats.pf": "ලාභ සාධකය", "stats.equity": "මුළු වටිනාකම් වක්‍රය (පුහුණු)",
    "stats.none": "සංඛ්‍යාලේශන බලන්න paper වෙළඳාම් කිහිපයක් වසන්න.",
  },
};
function t(key, vars) {
  const lang = (state && state.settings.lang) || "en";
  let s = (STR[lang] && STR[lang][key]) || STR.en[key] || key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.replace("{" + k + "}", vars[k]); });
  return s;
}
const vLabel = (v) => t("VERDICT." + v);

/* ------------------------------------------------------------------- state */
const WATCHLIST = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT",
  "DOTUSDT", "LINKUSDT", "LTCUSDT", "TRXUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT",
  "SUIUSDT", "INJUSDT", "TIAUSDT", "FILUSDT", "ETCUSDT", "BCHUSDT", "PEPEUSDT", "SHIBUSDT", "TONUSDT"];

const TFS = ["1m", "5m", "15m", "1h", "4h", "1d"];
const TF_MIN = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

const state = {
  tab: "markets",
  settings: {
    lang: "en", exchange: "binance", testnet: false, sound: true, haptic: true, tts: false, keep: false,
    aiProvider: "off", aiKey: "", aiModel: "meta-llama/llama-3.3-70b-instruct:free", aiBase: "",
    liveMode: "paper",
  },
  favs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  sym: "BTCUSDT",
  tf: "5m",
  sort: "vol",
  search: "",
  tickers: {},              // sym -> {last, chg, high, low, vol, ts}
  klines: [],               // current chart candles
  klinesCache: {},          // "sym|tf" -> {at, candles}
  dataMode: "loading",      // live | demo | off
  dataSource: "—",
  ci: null,                 // crosshair index
  chartInd: { ema: true, bb: false, vol: true, rsi: true },
  paper: null,
  bot: null,
  alerts: [],
  toOpenOrders: [],
};

let TA = null; // ta.js

/* -------------------------------------------------------------- persistence */
const LSKEY = "cryptoai.pro.v2";
function save() {
  try {
    const s = {
      settings: state.settings, favs: state.favs, sym: state.sym, tf: state.tf, sort: state.sort,
      paper: state.paper, bot: botCfg(), alerts: state.alerts, chartInd: state.chartInd,
    };
    localStorage.setItem(LSKEY, JSON.stringify(s));
  } catch (e) { /* storage full / private mode */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LSKEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.settings) Object.assign(state.settings, s.settings);
    if (s.favs) state.favs = s.favs;
    if (s.sym) state.sym = s.sym;
    if (s.tf && TFS.indexOf(s.tf) >= 0) state.tf = s.tf;
    if (s.sort) state.sort = s.sort;
    if (s.paper) state.paper = s.paper;
    if (s.alerts) state.alerts = s.alerts;
    if (s.chartInd) Object.assign(state.chartInd, s.chartInd);
    if (s.botCfg) state.botCfg = s.botCfg;
  } catch (e) { console.warn("load", e); }
}
function freshPaper() {
  return { bal: 10000, positions: [], orders: [], history: [], day: dayKey(), dayPnl: 0, seq: 1, eq: [{ t: now(), v: 10000 }] };
}
function botCfg() {
  return state.botCfg || (state.botCfg = {
    strategy: "signal", tf: "15m", size: 50, tp: 1.5, sl: 0.8, symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    allowShort: false, notify: true, keep: false, maxPos: 3, cooldown: 15, dailyLoss: 50,
  });
}

/* ============================================================================
 * MARKET DATA — exchanges, WebSocket streams, REST fallback, offline demo
 * ========================================================================== */
function seedy(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const EX = {
  binance: {
    label: "Binance", kind: "binance",
    nsym: (s) => s.toUpperCase(),
    fetchTickers: async (syms) => {
      const u = "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(syms));
      const j = JSON.parse(await httpGet(u));
      const out = {};
      (j || []).forEach((x) => {
        out[x.symbol] = { last: +x.lastPrice, chg: +x.priceChangePercent, high: +x.highPrice, low: +x.lowPrice, vol: +x.quoteVolume, ts: now() };
      });
      return out;
    },
    fetchTicker: async (sym) => {
      const j = JSON.parse(await httpGet("https://api.binance.com/api/v3/ticker/24hr?symbol=" + sym));
      return { last: +j.lastPrice, chg: +j.priceChangePercent, high: +j.highPrice, low: +j.lowPrice, vol: +j.quoteVolume, ts: now() };
    },
    fetchKlines: async (sym, tf, limit) => {
      const j = JSON.parse(await httpGet(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${tf}&limit=${limit}`));
      return j.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
    },
    wsUrl: (syms) => "wss://stream.binance.com:9443/stream?streams=" + syms.map((s) => s.toLowerCase() + "@ticker").join("/"),
    wsParse: (m) => {
      const d = m && m.data; if (!d || !d.s) return null;
      return [d.s, { last: +d.c, chg: +d.P, high: +d.h, low: +d.l, vol: +d.q, ts: now() }];
    },
  },

  bybit: {
    label: "Bybit", kind: "bybit",
    nsym: (s) => s.toUpperCase(),
    fetchTickers: async (syms) => {
      const j = JSON.parse(await httpGet("https://api.bybit.com/v5/market/tickers?category=spot"));
      const out = {};
      ((j.result && j.result.list) || []).forEach((x) => {
        if (syms.indexOf(x.symbol) < 0) return;
        out[x.symbol] = { last: +x.lastPrice, chg: +x.price24hPcnt * 100, high: +x.highPrice24h, low: +x.lowPrice24h, vol: +x.turnover24h, ts: now() };
      });
      if (!Object.keys(out).length) throw new Error("empty bybit tickers");
      return out;
    },
    fetchTicker: async (sym) => {
      const j = JSON.parse(await httpGet(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`));
      const x = j.result.list[0];
      return { last: +x.lastPrice, chg: +x.price24hPcnt * 100, high: +x.highPrice24h, low: +x.lowPrice24h, vol: +x.turnover24h, ts: now() };
    },
    fetchKlines: async (sym, tf, limit) => {
      const iv = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" }[tf] || "5";
      const j = JSON.parse(await httpGet(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=${iv}&limit=${Math.min(limit, 1000)}`));
      return ((j.result && j.result.list) || []).map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
    },
    wsUrl: () => "wss://stream.bybit.com/v5/public/spot",
    wsOpen: (ws, syms) => ws.send(JSON.stringify({ op: "subscribe", args: syms.map((s) => "tickers." + s) })),
    wsParse: (m) => {
      if (!m || !m.topic || m.topic.indexOf("tickers.") !== 0 || !m.data) return null;
      const d = m.data, s = m.topic.split(".")[1];
      return [s, { last: +d.lastPrice, chg: +d.price24hPcnt * 100, high: +d.highPrice24h, low: +d.lowPrice24h, vol: +d.turnover24h, ts: now() }];
    },
  },

  okx: {
    label: "OKX", kind: "okx",
    nsym: (s) => s.replace(/USDT$/, "-USDT"),
    fetchTickers: async (syms) => {
      const j = JSON.parse(await httpGet("https://www.okx.com/api/v5/market/tickers?instType=SPOT"));
      const want = syms.map((s) => s.replace(/USDT$/, "-USDT"));
      const out = {};
      (j.data || []).forEach((x) => {
        if (want.indexOf(x.instId) < 0) return;
        const o = +x.open24h || +x.last;
        out[x.instId.replace("-USDT", "USDT")] = { last: +x.last, chg: o ? ((+x.last - o) / o) * 100 : 0, high: +x.high24h, low: +x.low24h, vol: +x.volCcy24h, ts: now() };
      });
      if (!Object.keys(out).length) throw new Error("empty okx tickers");
      return out;
    },
    fetchTicker: async (sym) => {
      const j = JSON.parse(await httpGet("https://www.okx.com/api/v5/market/ticker?instId=" + sym.replace(/USDT$/, "-USDT")));
      const x = j.data[0], o = +x.open24h || +x.last;
      return { last: +x.last, chg: o ? ((+x.last - o) / o) * 100 : 0, high: +x.high24h, low: +x.low24h, vol: +x.volCcy24h, ts: now() };
    },
    fetchKlines: async (sym, tf, limit) => {
      const bar = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" }[tf] || "5m";
      const j = JSON.parse(await httpGet(`https://www.okx.com/api/v5/market/candles?instId=${sym.replace(/USDT$/, "-USDT")}&bar=${bar}&limit=${Math.min(limit, 300)}`));
      return (j.data || []).map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
    },
    wsUrl: () => "wss://ws.okx.com:8443/ws/v5/public",
    wsOpen: (ws, syms) => ws.send(JSON.stringify({ op: "subscribe", args: syms.map((s) => ({ channel: "tickers", instId: s.replace(/USDT$/, "-USDT") })) })),
    wsParse: (m) => {
      if (!m || !m.arg || m.arg.channel !== "tickers" || !m.data) return null;
      const x = m.data[0], o = +x.open24h || +x.last;
      return [x.instId.replace("-USDT", "USDT"), { last: +x.last, chg: o ? ((+x.last - o) / o) * 100 : 0, high: +x.high24h, low: +x.low24h, vol: +x.volCcy24h, ts: now() }];
    },
  },
};
const EX_IDS = Object.keys(EX);
const exNow = () => EX[state.settings.exchange] || EX.binance;

/* --------------------------------------------------------------- http layer */
async function httpGet(url, headers) {
  if (B) {
    const r = B.httpGet(url, JSON.stringify(headers || {}));
    return checkBridgeReply(r, url);
  }
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}
async function httpPost(url, body, headers) {
  const h = Object.assign({ "Content-Type": "application/json" }, headers || {});
  if (B) {
    const r = B.httpPost(url, body, JSON.stringify(h));
    return checkBridgeReply(r, url);
  }
  const res = await fetch(url, { method: "POST", headers: h, body });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.text();
}
function checkBridgeReply(r, url) {
  if (r == null) throw new Error("no reply from device network");
  const s = String(r);
  if (s.charAt(0) === "{") {
    let j = null;
    try { j = JSON.parse(s); } catch (e) { j = null; }
    if (j && j.error === true) throw new Error(j.msg || "network error");
  }
  return s;
}

/* --------------------------------------------------------- demo (simulated) */
const DEMO_BASE = { BTCUSDT: 63000, ETHUSDT: 2450, BNBUSDT: 560, SOLUSDT: 145, XRPUSDT: 0.52, ADAUSDT: 0.34,
  DOGEUSDT: 0.105, AVAXUSDT: 23.5, DOTUSDT: 4.1, LINKUSDT: 11.2, LTCUSDT: 68, TRXUSDT: 0.165, ATOMUSDT: 4.4,
  NEARUSDT: 3.6, APTUSDT: 5.4, ARBUSDT: 0.62, OPUSDT: 1.15, SUIUSDT: 1.35, INJUSDT: 17.5, TIAUSDT: 4.3,
  FILUSDT: 3.4, ETCUSDT: 18.6, BCHUSDT: 330, PEPEUSDT: 0.0000075, SHIBUSDT: 0.0000135, TONUSDT: 5.2 };
const demo = { prices: {}, klines: {}, timer: null };

function demoInit() {
  WATCHLIST.forEach((s) => {
    const rnd = mulberry(seedy(s) + 7);
    const base = DEMO_BASE[s] || 1 + (seedy(s) % 5000) / 100;
    const chg = (rnd() - 0.45) * 9;
    const last = base * (1 + chg / 100);
    demo.prices[s] = { last, open: base, high: base * (1 + Math.abs(chg) / 100 + rnd() * 0.01), low: base * (1 - Math.abs(chg) / 60), vol: 5e6 + rnd() * 9e7, ts: now() };
  });
}
function demoTick() {
  Object.keys(demo.prices).forEach((s) => {
    const p = demo.prices[s];
    const rnd = Math.random;
    const vol = s === "BTCUSDT" ? 0.0009 : 0.0022;
    p.last = Math.max(1e-8, p.last * (1 + (rnd() - 0.5) * vol));
    p.high = Math.max(p.high, p.last); p.low = Math.min(p.low, p.last);
    p.vol += rnd() * 20000;
    p.ts = now();
    publishTicker(s, { last: p.last, chg: ((p.last - p.open) / p.open) * 100, high: p.high, low: p.low, vol: p.vol, ts: p.ts });
  });
}
function demoCandles(sym, tf, n) {
  const base = (demo.prices[sym] && demo.prices[sym].last) || DEMO_BASE[sym] || 100;
  const rnd = mulberry(seedy(sym + tf) + Math.floor(now() / (TF_MIN[tf] * 60000)));
  const step = TF_MIN[tf] * 60000;
  const t0 = Math.floor(now() / step) * step - (n - 1) * step;
  const vol = sym === "BTCUSDT" ? 0.006 : 0.012;
  const out = [];
  let p = base * (1 - (rnd() - 0.45) * 0.06);
  for (let i = 0; i < n; i++) {
    const drift = ((i / n) - 0.5) * 0.002;
    const o = p, c = Math.max(1e-10, p * (1 + (rnd() - 0.5) * vol / 3 + drift));
    const h = Math.max(o, c) * (1 + rnd() * vol / 6), l = Math.min(o, c) * (1 - rnd() * vol / 6);
    out.push({ t: t0 + i * step, o, h, l, c, v: 500 + rnd() * 2500 });
    p = c;
  }
  // anchor the last close on the current demo price so the chart matches the ticker
  const k = base / out[out.length - 1].c;
  return out.map((x) => ({ t: x.t, o: x.o * k, h: x.h * k, l: x.l * k, c: x.c * k, v: x.v }));
}

/* ------------------------------------------------------------------ loading */
let ws = null, wsTries = 0, wsTimer = null, pollTimer = null, tickTimer = null;

async function fetchTickersSmart() {
  const order = [state.settings.exchange].concat(EX_IDS.filter((e) => e !== state.settings.exchange));
  let lastErr = null;
  for (const id of order) {
    try {
      const map = await EX[id].fetchTickers(WATCHLIST);
      if (map && Object.keys(map).length) {
        Object.assign(state.tickers, map);
        state.dataMode = "live"; state.dataSource = EX[id].label;
        if (id !== state.settings.exchange) logLine("data: " + EX[id].label + " (fallback)", "warn");
        return true;
      }
    } catch (e) { lastErr = e; }
  }
  console.warn("tickers failed", lastErr);
  return false;
}

async function fetchKlinesSmart(sym, tf, limit) {
  const key = sym + "|" + tf;
  const order = [state.settings.exchange].concat(EX_IDS.filter((e) => e !== state.settings.exchange));
  for (const id of order) {
    try {
      const k = await EX[id].fetchKlines(sym, tf, limit);
      if (k && k.length > 30) {
        state.klinesCache[key] = { at: now(), candles: k };
        return k;
      }
    } catch (e) { /* try next */ }
  }
  const c = demoCandles(sym, tf, Math.min(limit, 300));
  state.klinesCache[key] = { at: now(), candles: c };
  return c;
}

function publishTicker(sym, tk) {
  const prev = state.tickers[sym];
  state.tickers[sym] = tk;
  if (sym === state.sym) paintChartHeader();
  const row = document.querySelector('[data-mrow="' + sym + '"]');
  if (row) paintRow(row, sym);
  if (state.tab === "trade" && (!prev || now() - (prev.painted || 0) > 900)) {
    tk.painted = now();
    paintPositions(); paintHistory(); paintStats(); updateOrderEst(); paintBalancesThrottled();
  }
  checkAlerts(sym, tk.last);
  onPrice(sym, tk.last);
}

async function startData() {
  setConn("loading");
  const ok = await fetchTickersSmart();
  if (!ok) {
    demoInit();
    state.dataMode = "demo"; state.dataSource = "demo";
    Object.keys(demo.prices).forEach((s) => {
      const p = demo.prices[s];
      state.tickers[s] = { last: p.last, chg: ((p.last - p.open) / p.open) * 100, high: p.high, low: p.low, vol: p.vol, ts: now() };
    });
    logLine("no exchange connection — demo data", "warn");
  }
  setConn(state.dataMode === "live" ? "live" : "demo");
  state.klines = await fetchKlinesSmart(state.sym, state.tf, 300);
  renderAll();
  startStream();
  startTimers();
}

function startStream() {
  closeStream();
  if (state.dataMode === "demo") {
    if (!demo.timer) demo.timer = setInterval(demoTick, 1500);
    return;
  }
  if (demo.timer) { clearInterval(demo.timer); demo.timer = null; }
  const ex = exNow();
  const syms = WATCHLIST.map((s) => ex.nsym(s));
  try {
    ws = new WebSocket(ex.wsUrl(syms));
  } catch (e) { ws = null; }
  if (!ws) { startPolling(); return; }
  ws.onopen = () => {
    wsTries = 0;
    if (ex.wsOpen) { try { ex.wsOpen(ws, syms); } catch (e) { } }
    setConn("live");
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };
  ws.onmessage = (ev) => {
    let m = null;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    const r = ex.wsParse(m);
    if (r) publishTicker(r[0], r[1]);
  };
  ws.onerror = () => { };
  ws.onclose = () => {
    ws = null;
    if (state.dataMode !== "live") return;
    wsTries++;
    if (wsTries <= 5) {
      const delay = Math.min(30000, 1500 * Math.pow(2, wsTries));
      logLine("stream closed — reconnecting in " + Math.round(delay / 1000) + "s", "warn");
      wsTimer = setTimeout(startStream, delay);
      startPolling();
    } else {
      logLine("stream unavailable — REST polling", "warn");
      startPolling();
    }
  };
}
function closeStream() {
  if (wsTimer) { clearTimeout(wsTimer); wsTimer = null; }
  if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { } ws = null; }
}
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const map = await EX[state.settings.exchange].fetchTickers(WATCHLIST);
      Object.keys(map).forEach((s) => publishTicker(s, map[s]));
    } catch (e) { }
  }, 7000);
}
function startTimers() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(async () => {
    if (document.hidden) return;
    // refresh the visible chart + the signal report every 45s on live data
    if (state.dataMode === "live" && state.tab === "chart") {
      const cache = state.klinesCache[state.sym + "|" + state.tf];
      if (!cache || now() - cache.at > 45000) {
        state.klines = await fetchKlinesSmart(state.sym, state.tf, 300);
        renderChart();
      }
    }
    if (state.dataMode === "live" && (!state.tickers[state.sym] || now() - state.tickers[state.sym].ts > 60000)) {
      const ok = await fetchTickersSmart();
      if (!ok) { demoInit(); state.dataMode = "demo"; state.dataSource = "demo"; setConn("demo"); startStream(); }
    }
    if (state.tab === "signals") paintSignals();
  }, 20000);
}

/* --------------------------------------------------------------- connection */
function setConn(mode) {
  const dot = $("connDot"), txt = $("connTxt");
  dot.className = "dot " + (mode === "live" ? "live" : mode === "demo" ? "demo" : mode === "loading" ? "" : "off");
  txt.textContent = mode === "live" ? (state.dataSource + " · " + t("conn.live")) : mode === "demo" ? t("conn.demo") : mode === "loading" ? t("conn.loading") : t("conn.off");
  $("mNote").textContent = state.dataMode === "demo" ? t("demo.note") : t("m.note");
}

/* ============================================================================
 * NOTIFICATIONS / TOASTS / HAPTICS
 * ========================================================================== */
let audioCtx = null;
function beep(freq, ms) {
  if (!state.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "sine"; o.frequency.value = freq || 880;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (ms || 180) / 1000);
    o.start(t0); o.stop(t0 + (ms || 180) / 1000 + 0.02);
  } catch (e) { }
}
function haptic(ms) { if (state.settings.haptic) bc("haptic", ms || 30); }
function toast(msg, cls, ms) {
  const box = $("toasts");
  const n = el("div", "toast " + (cls || ""), esc(msg));
  box.appendChild(n);
  setTimeout(() => { n.style.opacity = "0"; n.style.transition = "opacity .3s"; setTimeout(() => n.remove(), 320); }, ms || 2600);
}
function notify(title, text, kind) {
  toast(title + " — " + text, kind === "bad" ? "bad" : kind === "ok" ? "ok" : "");
  bc("notifySignal", title, text);
  haptic(60);
  beep(kind === "bad" ? 520 : 940);
  if (state.settings.tts) bc("speak", title + ". " + text);
}

/* ============================================================================
 * PRICE ALERTS
 * ========================================================================== */
function checkAlerts(sym, price) {
  if (!state.alerts.length) return;
  let changed = false;
  state.alerts = state.alerts.filter((a) => {
    if (a.sym !== sym) return true;
    const hit = a.dir === "above" ? price >= a.price : price <= a.price;
    if (!hit) return true;
    notify(t("alert.hit"), `${a.sym.replace("USDT", "/USDT")} ${a.dir === "above" ? "≥" : "≤"} ${fmtPrice(a.price)} (${fmtPrice(price)})`, "ok");
    changed = true;
    return false;
  });
  if (changed) { save(); paintAlertBadge(); if ($("alertModal").classList.contains("on")) paintAlerts(); }
}
function paintAlertBadge() {
  const nb = $("navBadge");
  if (!nb) return;
  nb.style.display = state.alerts.length ? "grid" : "none";
  nb.textContent = state.alerts.length;
}
function paintAlerts() {
  const box = $("alertList");
  if (!state.alerts.length) { box.innerHTML = '<div class="empty">' + t("alert.none") + "</div>"; return; }
  box.innerHTML = state.alerts.map((a) => `
    <div class="row between" style="padding:7px 0;border-bottom:1px dashed rgba(31,42,66,.8)">
      <div><b>${esc(a.sym.replace("USDT", "/USDT"))}</b>
        <span class="small ${a.dir === "above" ? "up" : "dn"}">${a.dir === "above" ? "≥" : "≤"} ${fmtPrice(a.price)}</span></div>
      <button class="btn ghost sm" data-delalert="${a.id}">✕</button>
    </div>`).join("");
  box.querySelectorAll("[data-delalert]").forEach((b) => b.onclick = () => {
    state.alerts = state.alerts.filter((x) => x.id !== b.dataset.delalert); save(); paintAlerts(); paintAlertBadge();
  });
}

/* ============================================================================
 * UI — markets list
 * ========================================================================== */
const priceHist = {};   // sym -> rolling last prices for the sparkline

function pushHist(sym, p) {
  const a = priceHist[sym] || (priceHist[sym] = []);
  a.push(p); if (a.length > 48) a.shift();
}

function sortedSymbols() {
  let list = WATCHLIST.slice();
  if (state.sort === "fav") list = state.favs.slice();
  else if (state.sort === "gain") list.sort((a, b) => chg(b) - chg(a));
  else if (state.sort === "loss") list.sort((a, b) => chg(a) - chg(b));
  else list.sort((a, b) => vol(b) - vol(a));
  if (state.search) {
    const q = state.search.toUpperCase().replace("/", "");
    list = list.filter((s) => s.indexOf(q) >= 0);
  }
  return list;
}
const chg = (s) => (state.tickers[s] ? state.tickers[s].chg : 0);
const vol = (s) => (state.tickers[s] ? state.tickers[s].vol || 0 : 0);

function paintMarkets() {
  const box = $("mList");
  const list = sortedSymbols();
  if (!list.length) { box.innerHTML = '<div class="empty">—</div>'; return; }
  box.innerHTML = "";
  list.forEach((s) => {
    const row = el("div", "mrow");
    row.dataset.mrow = s;
    row.innerHTML = `
      <button class="star ${state.favs.indexOf(s) >= 0 ? "on" : ""}" data-fav="${s}">★</button>
      <div class="sym"><b>${esc(s.replace("USDT", "/USDT"))}</b><span>${esc(s.slice(0, 1))} · ${state.dataSource}</span></div>
      <canvas width="104" height="52" data-spark="${s}"></canvas>
      <div class="px mono" data-px="${s}">—</div>
      <div class="chg" data-chg="${s}">—</div>`;
    box.appendChild(row);
    paintRow(row, s);
  });
  box.querySelectorAll("[data-fav]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const s = b.dataset.fav;
    const i = state.favs.indexOf(s);
    if (i >= 0) state.favs.splice(i, 1); else state.favs.push(s);
    save(); paintMarkets(); paintBotSymbols();
    haptic(20);
  });
  box.querySelectorAll("[data-mrow]").forEach((r) => r.onclick = () => {
    state.sym = r.dataset.mrow;
    save(); switchTab("chart"); loadChart();
  });
}

function paintRow(row, sym) {
  const tk = state.tickers[sym];
  const px = row.querySelector('[data-px="' + sym + '"]');
  const ch = row.querySelector('[data-chg="' + sym + '"]');
  if (!tk) { if (px) px.textContent = "—"; return; }
  pushHist(sym, tk.last);
  if (px) px.textContent = fmtPrice(tk.last);
  if (ch) {
    ch.textContent = fmtPct(tk.chg);
    ch.className = "chg" + (tk.chg < 0 ? " dn" : "");
  }
  const cv = row.querySelector('[data-spark="' + sym + '"]');
  if (cv) drawSpark(cv, priceHist[sym] || [tk.last], tk.chg >= 0);
}

function drawSpark(cv, arr, up) {
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (!arr || arr.length < 2) return;
  const mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr);
  const rx = mx - mn || 1;
  ctx.beginPath();
  arr.forEach((v, i) => {
    const x = (i / (arr.length - 1)) * (w - 4) + 2;
    const y = h - 4 - ((v - mn) / rx) * (h - 8);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = up ? "#0ecb81" : "#f6465d";
  ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(w - 2, h); ctx.lineTo(2, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, up ? "rgba(14,203,129,.35)" : "rgba(246,70,93,.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fill();
}

function paintTickerStrip() {
  const box = $("tickTrack");
  const items = state.favs.concat(WATCHLIST.filter((s) => state.favs.indexOf(s) < 0)).slice(0, 14);
  const html = items.map((s) => {
    const tk = state.tickers[s] || {};
    return `<span class="tk">${esc(s.replace("USDT", "/USDT"))} <b>${fmtPrice(tk.last)}</b>
      <span class="${(tk.chg || 0) >= 0 ? "up" : "dn"}">${fmtPct(tk.chg || 0)}</span></span>`;
  }).join("");
  box.innerHTML = html + html;
}

/* ============================================================================
 * UI — chart
 * ========================================================================== */
function paintChartHeader() {
  const tk = state.tickers[state.sym] || {};
  $("symName").textContent = state.sym.replace("USDT", "/USDT");
  const b = $("chgBadge");
  b.textContent = fmtPct(tk.chg || 0);
  b.className = "badge" + ((tk.chg || 0) < 0 ? " dn" : "");
  const c = state.klines.length ? state.klines[state.klines.length - 1] : null;
  const hi = tk.high || (c ? c.h : 0), lo = tk.low || (c ? c.l : 0);
  $("chartStats").innerHTML = [
    ["Last", fmtPrice(tk.last || (c && c.c))],
    ["24h high", fmtPrice(hi)],
    ["24h low", fmtPrice(lo)],
    ["24h vol", tk.vol ? (tk.vol / 1e6).toFixed(2) + "M" : "—"],
    ["24h chg", `<span class="${(tk.chg || 0) >= 0 ? "up" : "dn"}">${fmtPct(tk.chg || 0)}</span>`],
  ].map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("");
  if (state.tab === "trade") { $("ordSym").textContent = state.sym.replace("USDT", "/USDT"); $("ordLast").textContent = fmtPrice(tk.last); updateOrderEst(); }
}

function candWidth(canvasW, n) {
  const vis = Math.min(140, n);
  return { vis, cw: canvasW / vis };
}

function renderChart() {
  const cv = $("chart");
  const wrap = cv.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const W = wrap.clientWidth, H = 260;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const all = state.klines;
  if (!all || all.length < 5) {
    ctx.fillStyle = "#5b6a86"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("loading…", W / 2, H / 2);
    renderRsi();
    return;
  }
  const { vis, cw } = candWidth(W, all.length);
  const candles = all.slice(all.length - vis);
  const closes = candles.map((c) => c.c);
  const padR = 52, padT = 8, padB = 16;
  const volH = state.chartInd.vol ? (H - padT - padB) * 0.22 : 0;
  const priceH = H - padT - padB - volH - 4;

  let mn = Infinity, mx = -Infinity;
  candles.forEach((c) => { mn = Math.min(mn, c.l); mx = Math.max(mx, c.h); });
  const e20 = TA.ema(closes, 20), e50 = TA.ema(closes, 50);
  const bb = state.chartInd.bb ? TA.bollinger(closes, 20, 2) : null;
  if (state.chartInd.ema) [e20, e50].forEach((s) => s.forEach((v, i) => { if (v != null && i >= vis - Math.min(vis, s.length)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }));
  if (bb) bb.upper.forEach((v, i) => { if (v != null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } });
  const padP = (mx - mn) * 0.06 || mx * 0.004 || 1;
  mn -= padP; mx += padP;
  const plotW = W - padR;
  const X = (i) => i * cw + cw / 2;
  const Y = (p) => padT + priceH - ((p - mn) / (mx - mn)) * priceH;

  // grid + price axis
  ctx.font = "10px ui-monospace,monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const p = mn + ((mx - mn) * g) / 4, y = Y(p);
    ctx.strokeStyle = "rgba(31,42,66,.75)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(plotW, y + .5); ctx.stroke();
    ctx.fillStyle = "#5b6a86"; ctx.fillText(fmtPrice(p), plotW + 4, y);
  }
  // time axis
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let g = 0; g < 5; g++) {
    const i = Math.floor((vis - 1) * (g / 4));
    const c = candles[i]; if (!c) continue;
    const d = new Date(c.t);
    const lbl = TF_MIN[state.tf] >= 1440 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    ctx.fillStyle = "#4a5a7a";
    ctx.fillText(lbl, clamp(X(i), 16, plotW - 16), H - padB + 3);
  }
  // volume
  if (state.chartInd.vol) {
    const vmax = Math.max.apply(null, candles.map((c) => c.v || 0)) || 1;
    candles.forEach((c, i) => {
      const h = ((c.v || 0) / vmax) * (volH - 3);
      ctx.fillStyle = c.c >= c.o ? "rgba(14,203,129,.35)" : "rgba(246,70,93,.35)";
      ctx.fillRect(i * cw + cw * 0.15, padT + priceH + 4 + (volH - 3 - h), Math.max(cw * 0.7, 1), h);
    });
  }
  // bollinger
  if (bb) {
    ctx.strokeStyle = "rgba(139,92,246,.8)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    [bb.upper, bb.lower].forEach((s) => {
      const off = all.length - vis;
      ctx.beginPath();
      for (let i = 0; i < vis; i++) { const v = s[off + i]; if (v == null) continue; const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }
  // candles
  const off = all.length - vis;
  candles.forEach((c, i) => {
    const up = c.c >= c.o;
    const col = up ? "#0ecb81" : "#f6465d";
    ctx.strokeStyle = col; ctx.fillStyle = col;
    const x = X(i);
    ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.lineWidth = 1; ctx.stroke();
    const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
    const bh = Math.max(y2 - y1, 1);
    const bw = Math.max(cw * 0.66, 1);
    ctx.fillRect(x - bw / 2, y1, bw, bh);
  });
  // EMAs
  if (state.chartInd.ema) {
    [["#f0b90b", e20], ["#38bdf8", e50]].forEach(([col, s]) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.beginPath();
      let started = false;
      for (let i = 0; i < vis; i++) {
        const v = s[off + i]; if (v == null) continue;
        const x = X(i), y = Y(v);
        started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
      }
      ctx.stroke();
    });
  }
  // last price marker
  const tk = state.tickers[state.sym];
  const lastP = (tk && tk.last) || candles[candles.length - 1].c;
  if (lastP >= mn && lastP <= mx) {
    const y = Y(lastP);
    const upL = (tk ? tk.chg : 0) >= 0;
    ctx.strokeStyle = upL ? "rgba(14,203,129,.8)" : "rgba(246,70,93,.8)";
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = upL ? "#0ecb81" : "#f6465d";
    ctx.fillRect(plotW + 1, y - 8, padR - 2, 16);
    ctx.fillStyle = "#04140c"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 10px ui-monospace,monospace";
    ctx.fillText(fmtPrice(lastP), plotW + padR / 2, y);
  }
  // crosshair
  if (state.ci != null && candles[state.ci]) {
    const i = clamp(state.ci, 0, vis - 1), c = candles[i];
    ctx.strokeStyle = "rgba(233,238,251,.35)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(i), padT); ctx.lineTo(X(i), H - padB); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, Y(c.c)); ctx.lineTo(plotW, Y(c.c)); ctx.stroke();
    ctx.setLineDash([]);
    const tip = $("chartTip");
    const d = new Date(c.t);
    tip.style.display = "block";
    tip.style.left = Math.min(X(i) + 10, W - 116) + "px";
    tip.style.top = clamp(Y(c.h) - 10, 6, H - 92) + "px";
    tip.innerHTML = `<div class="dim">${d.toLocaleString()}</div>
      O <b>${fmtPrice(c.o)}</b> H <b>${fmtPrice(c.h)}</b><br>L <b>${fmtPrice(c.l)}</b> C <b class="${c.c >= c.o ? "up" : "dn"}">${fmtPrice(c.c)}</b>
      <div class="dim">vol ${(c.v / 1000).toFixed(1)}k</div>`;
  } else {
    $("chartTip").style.display = "none";
  }
  renderRsi();
  lastChartGeom = { W, padR, plotW, cw, vis, off };
}
let lastChartGeom = null;

function renderRsi() {
  const cv = $("rsiChart");
  const on = state.chartInd.rsi;
  cv.style.display = on ? "block" : "none";
  if (!on) return;
  const wrap = cv.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const W = wrap.clientWidth, H = 64;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const all = state.klines;
  if (!all || all.length < 20 || !TA) return;
  const { vis } = candWidth(W, all.length);
  const off = all.length - vis;
  const r = TA.rsi(all.map((c) => c.c), 14).slice(off);
  const padR = 52, plotW = W - padR;
  const Y = (v) => H - 12 - (v / 100) * (H - 22);
  // bands
  [[70, "rgba(246,70,93,.5)"], [30, "rgba(14,203,129,.5)"], [50, "rgba(90,105,140,.35)"]].forEach(([lvl, col]) => {
    ctx.strokeStyle = col; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(lvl)); ctx.lineTo(plotW, Y(lvl)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#4a5a7a"; ctx.font = "9px ui-monospace,monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(String(lvl), plotW + 4, Y(lvl));
  });
  ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1.5; ctx.beginPath();
  let started = false;
  r.forEach((v, i) => {
    if (v == null) return;
    const x = i * (plotW / vis) + (plotW / vis) / 2, y = Y(v);
    started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), started = true);
  });
  ctx.stroke();
  ctx.fillStyle = "#5b6a86"; ctx.font = "9px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillText("RSI 14", 4, 3);
}

function bindChartTouch() {
  const wrap = $("chart").parentElement;
  const cv = $("chart");
  let pinned = null;
  const at = (ev) => {
    const rect = cv.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    if (!lastChartGeom) return;
    const i = clamp(Math.floor(x / lastChartGeom.cw), 0, lastChartGeom.vis - 1);
    if (i !== state.ci) { state.ci = i; renderChart(); }
  };
  const clear = () => { pinned = null; };
  wrap.addEventListener("pointerdown", (e) => { pinned = true; at(e); e.preventDefault(); });
  wrap.addEventListener("pointermove", (e) => { if (pinned || e.pointerType === "mouse") at(e); });
  wrap.addEventListener("pointerup", () => { clear(); setTimeout(() => { state.ci = null; renderChart(); }, 2600); });
  wrap.addEventListener("pointerleave", () => { clear(); setTimeout(() => { state.ci = null; renderChart(); }, 800); });
  wrap.addEventListener("touchstart", (e) => { pinned = true; at(e); e.preventDefault(); }, { passive: false });
  wrap.addEventListener("touchmove", (e) => { at(e); e.preventDefault(); }, { passive: false });
  wrap.addEventListener("touchend", () => { clear(); setTimeout(() => { state.ci = null; renderChart(); }, 2600); });
}

async function loadChart() {
  paintChartHeader();
  const cache = state.klinesCache[state.sym + "|" + state.tf];
  if (state.dataMode === "demo" || !cache || now() - cache.at > 30000) {
    state.klines = await fetchKlinesSmart(state.sym, state.tf, 300);
  } else {
    state.klines = cache.candles;
  }
  renderChart();
  if (!state.tickers[state.sym]) {
    try {
      const tk = await exNow().fetchTicker(exNow().nsym(state.sym));
      publishTicker(state.sym, tk);
    } catch (e) { }
  }
  paintChartHeader();
}

/* ============================================================================
 * UI — signals
 * ========================================================================== */
let lastReport = null;

function paintSignals() {
  const v = $("sigVerdict");
  if (!state.klines || state.klines.length < 30 || !TA) {
    v.className = "verdict neutral"; v.innerHTML = `<div class="v">—</div><div class="small mut">${t("sig.none")}</div>`;
    return;
  }
  const rep = TA.analyze(state.klines);
  lastReport = rep;
  if (!rep.ok) return;
  const cls = rep.verdict.indexOf("BUY") >= 0 ? "buy" : rep.verdict.indexOf("SELL") >= 0 ? "sell" : "neutral";
  const col = cls === "buy" ? "#0ecb81" : cls === "sell" ? "#f6465d" : "#8394b4";
  v.className = "verdict " + cls;
  v.innerHTML = `
    <div class="v" style="color:${col}">${esc(vLabel(rep.verdict))}</div>
    <div class="small mut mt">${esc(state.sym.replace("USDT", "/USDT"))} · ${esc(state.tf)} · ${fmtPrice(rep.price)}
      ${rep.conflict ? "· ⚠" : ""}</div>
    <div class="gauge" style="max-width:220px;margin:9px auto 0"><i style="width:${rep.confidence}%;background:${col}"></i></div>
    <div class="tiny mut">${t("sig.confidence")} ${rep.confidence}% · score ${rep.score}</div>`;

  // blocks
  const tb = $("sigTrendBar"), rb = $("sigRevertBar");
  const tn = (rep.trendScore + 100) / 2, rn = (rep.revertScore + 100) / 2;
  tb.style.width = tn + "%"; tb.style.background = rep.trendScore >= 0 ? "var(--up)" : "var(--dn)";
  rb.style.width = rn + "%"; rb.style.background = rep.revertScore >= 0 ? "var(--info)" : "var(--dn)";
  $("sigTrendLbl").textContent = `${t("sig.trend")}: ${rep.trendScore > 0 ? "+" : ""}${rep.trendScore}`;
  $("sigRevertLbl").textContent = `${t("sig.revert")}: ${rep.revertScore > 0 ? "+" : ""}${rep.revertScore}`;

  // reasons
  const lang = state.settings.lang;
  $("sigReasons").innerHTML = rep.reasons.length
    ? rep.reasons.slice(0, 8).map((r) => {
      const ic = r.p > 0.4 ? "🟢" : r.p < -0.4 ? "🔴" : "⚪";
      return `<div class="reason"><span class="ic">${ic}</span><span class="tx">${esc(lang === "si" ? r.si : r.en)}</span></div>`;
    }).join("")
    : `<div class="hint">${t("sig.wait")}</div>`;

  // metrics
  const m = rep.metrics;
  const cells = [
    ["RSI 14", m.rsi == null ? "—" : m.rsi, m.rsi == null ? "" : m.rsi > 70 ? "dn" : m.rsi < 30 ? "up" : ""],
    ["MACD hist", m.macdHist == null ? "—" : (m.macdHist > 0 ? "+" : "") + m.macdHist.toPrecision(2), m.macdHist > 0 ? "up" : "dn"],
    ["Trend", m.trend, m.trend === "UP" ? "up" : m.trend === "DOWN" ? "dn" : ""],
    ["EMA 20", m.ema20 == null ? "—" : fmtPrice(m.ema20), ""],
    ["EMA 50", m.ema50 == null ? "—" : fmtPrice(m.ema50), ""],
    ["EMA 200", m.ema200 == null ? "—" : fmtPrice(m.ema200), ""],
    ["Bollinger %B", m.pctB + "%", m.pctB > 92 ? "dn" : m.pctB < 8 ? "up" : ""],
    ["Stoch %K", m.stochK == null ? "—" : m.stochK, m.stochK > 80 ? "dn" : m.stochK < 20 ? "up" : ""],
    ["ATR", m.atrPct + "%", ""],
    ["Mom 10", fmtPct(m.roc10), m.roc10 >= 0 ? "up" : "dn"],
    ["Mom 30", fmtPct(m.roc30), m.roc30 >= 0 ? "up" : "dn"],
    ["Volume", m.volRatio + "×", m.volRatio > 1.3 ? "gold" : ""],
  ];
  $("sigMetrics").innerHTML = cells.map(([k, val, cl]) =>
    `<div class="metric"><div class="k">${esc(k)}</div><div class="v ${cl}">${esc(String(val))}</div></div>`).join("");

  // levels
  const L = $("sigLevels"), card = $("sigLevelsCard");
  if (rep.levels && rep.levels.entry) {
    card.style.display = "block";
    const isBuy = rep.verdict.indexOf("BUY") >= 0;
    L.innerHTML = `
      <div class="lvl"><div class="k">${t("sig.entry")}</div><div class="v">${fmtPrice(rep.levels.entry)}</div></div>
      <div class="lvl"><div class="k">${t("sig.tp")} (${rep.levels.rewardPct}%)</div><div class="v up">${fmtPrice(rep.levels.tp)}</div></div>
      <div class="lvl"><div class="k">${t("sig.sl")} (${rep.levels.riskPct}%)</div><div class="v dn">${fmtPrice(rep.levels.sl)}</div></div>`;
    $("sigLevelsNote").textContent = `${t("sig.rr")} ${rep.levels.rr} : 1 · ${isBuy ? "LONG" : "SHORT"} · ${t("sig.planNote")}`;
  } else {
    card.style.display = "none";
  }
  paintBotStats();
  if (state.tab === "trade") { $("calcStop").value = ""; paintCalc(); }
}

/* ============================================================================
 * AI explanation (optional provider) + backtest worker
 * ========================================================================== */
function localNarrative(rep) {
  const si = state.settings.lang === "si";
  const sym = state.sym.replace("USDT", "/USDT");
  const head = si
    ? `${sym} (${state.tf}) සඳහා සංඥාව: ${vLabel(rep.verdict)} — විශ්වාසය ${rep.confidence}%. මිල ${fmtPrice(rep.price)}.`
    : `Signal for ${sym} (${state.tf}): ${vLabel(rep.verdict)} with ${rep.confidence}% confidence. Price ${fmtPrice(rep.price)}.`;
  const why = rep.reasons.slice(0, 4).map((r) => "• " + (si ? r.si : r.en)).join("\n");
  const plan = rep.levels
    ? (si
      ? `\n\nසැලැස්ම: ඇතුල්වීම ${fmtPrice(rep.levels.entry)}, ඉලක්කය ${fmtPrice(rep.levels.tp)} (+${rep.levels.rewardPct}%), නැවතුම ${fmtPrice(rep.levels.sl)} (-${rep.levels.riskPct}%). ලාභ:අවදානම ${rep.levels.rr}:1.`
      : `\n\nPlan: entry ${fmtPrice(rep.levels.entry)}, target ${fmtPrice(rep.levels.tp)} (+${rep.levels.rewardPct}%), stop ${fmtPrice(rep.levels.sl)} (-${rep.levels.riskPct}%). Reward:risk ${rep.levels.rr}:1.`)
    : (si ? `\n\n${t("sig.wait")}.` : `\n\n${t("sig.wait")}.`);
  const risk = si
    ? "\n\nමතක් කිරීම: මෙය ආයෝජන උපදෙසක් නොවේ. අවදානම කළමනාකරණය කරන්න."
    : "\n\nReminder: this is not financial advice. Manage your risk.";
  return head + "\n" + why + plan + risk;
}

async function aiExplain() {
  const out = $("aiOut");
  if (!lastReport) paintSignals();
  const rep = lastReport;
  if (!rep || !rep.ok) { toast(t("sig.none"), "bad"); return; }
  if (!state.settings.aiKey || state.settings.aiProvider === "off") {
    out.innerHTML = '<div class="ai-out">' + esc(localNarrative(rep)) + "</div>";
    toast(t("ai.needKey"));
    return;
  }
  out.innerHTML = '<span class="spinner"></span> ' + t("ai.thinking");
  const si = state.settings.lang === "si";
  const prompt = [
    si ? "ඔබ cryptos වෙළඳ විශ්ලේෂකයෙක්. පහත දත්ත මත පමණක් තීරණය කරන්න." : "You are a crypto market analyst. Reason only from the data below.",
    si ? "සිංහලෙන්, සරලව, වාක්‍ය 4කින් පැහැදිලි කරන්න." : "Explain in 4 short sentences, plain language, no hype.",
    `Pair: ${state.sym} ${state.tf} @ ${rep.price}`,
    `Verdict: ${rep.verdict} confidence ${rep.confidence} score ${rep.score} (trend block ${rep.trendScore}, oscillator block ${rep.revertScore})`,
    `Metrics: RSI ${rep.metrics.rsi}, MACD hist ${rep.metrics.macdHist}, trend ${rep.metrics.trend}, EMA20 ${rep.metrics.ema20}, EMA50 ${rep.metrics.ema50}, %B ${rep.metrics.pctB}, stoch ${rep.metrics.stochK}, ATR% ${rep.metrics.atrPct}, vol× ${rep.metrics.volRatio}`,
    rep.levels ? `Plan: entry ${rep.levels.entry} tp ${rep.levels.tp} sl ${rep.levels.sl} rr ${rep.levels.rr}` : "No plan (neutral).",
    si ? "අවදානම ගැන එක් වාක්‍යයක් අන්තිමට එක් කරන්න." : "End with one sentence about risk.",
  ].join("\n");
  try {
    let url, body, headers;
    if (state.settings.aiProvider === "openrouter") {
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers = { Authorization: "Bearer " + state.settings.aiKey };
    } else if (state.settings.aiProvider === "huggingface") {
      url = "https://router.huggingface.co/v1/chat/completions";
      headers = { Authorization: "Bearer " + state.settings.aiKey };
    } else {
      url = state.settings.aiBase || "https://api.openai.com/v1/chat/completions";
      headers = { Authorization: "Bearer " + state.settings.aiKey };
    }
    body = JSON.stringify({
      model: state.settings.aiModel || "meta-llama/llama-3.3-70b-instruct:free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    });
    const raw = await httpPost(url, body, headers);
    const j = JSON.parse(raw);
    const txt = (((j.choices || [])[0] || {}).message || {}).content;
    out.innerHTML = '<div class="ai-out">' + esc(txt || JSON.stringify(j).slice(0, 400)) + "</div>";
  } catch (e) {
    out.innerHTML = '<div class="ai-out">' + esc(localNarrative(rep)) + "</div>";
    toast("AI: " + (e && e.message ? e.message : "failed"), "bad");
  }
}

async function runBacktest() {
  const out = $("btOut");
  if (!state.klines || state.klines.length < 120 || !TA) { out.textContent = t("bt.few"); return; }
  out.innerHTML = '<span class="spinner"></span> ' + t("bt.running");
  await sleep(30);
  const cfg = botCfg();
  const r = TA.backtest(state.klines, {
    minScore: 25, tpMult: (cfg.tp / 100) * 20, slMult: (cfg.sl / 100) * 20, allowShort: cfg.allowShort, feePct: 0.1,
  });
  const pnlCls = r.pnlPct >= 0 ? "up" : "dn";
  out.innerHTML = `
    <div class="small b">${t("bt.header", { n: state.klines.length })}</div>
    <div class="mt">${t("bt.result", { trades: r.trades, win: r.winRate, pnl: r.pnlPct, dd: r.maxDD, bh: r.buyHoldPct })}</div>
    <div class="small ${pnlCls} mt">${r.trades ? "avg " + r.avgPct + "% per trade" : ""}</div>
    <div class="tiny dim mt">${t("bt.disclaimer")}</div>`;
}

/* ============================================================================
 * TAB SWITCHING + shell rendering
 * ========================================================================== */
function switchTab(name) {
  state.tab = name;
  document.querySelectorAll("main .tab").forEach((s) => s.classList.toggle("on", s.id === "t-" + name));
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  $("main").scrollTop = 0;
  if (name === "chart") { paintChartHeader(); requestAnimationFrame(renderChart); }
  /* keep the calculator's auto-filled stop in sync with the signal plan */
  if (name === "markets") { paintMarkets(); scanInfo(); }
  if (name === "signals") { paintSignals(); paintMTF(); }
  if (name === "trade") { if (!lastReport) paintSignals(); paintTrade(); paintCalc(); paintStats(); }
  if (name === "bot") paintBot();
}

function renderAll() {
  paintTickerStrip();
  paintMarkets();
  paintChartHeader();
  paintSignals();
  paintTrade();
  paintCalc();
  paintStats();
  paintBot();
  paintScan();
  scanInfo();
  setConn(state.dataMode === "live" ? "live" : state.dataMode === "demo" ? "demo" : "off");
}

/* ============================================================================
 * PAPER TRADING ENGINE (spot semantics for longs, bot can also short)
 * ========================================================================== */
const FEE_RATE = 0.001;                       // 0.10% per side (taker)
function paper() {
  if (!state.paper) state.paper = freshPaper();
  const p = state.paper;
  if (p.day !== dayKey()) { p.day = dayKey(); p.dayPnl = 0; }
  return p;
}
function paperEquity() {
  const p = paper();
  let eq = p.bal;
  p.positions.forEach((x) => { const tk = state.tickers[x.sym]; if (tk) eq += x.dir * x.qty * tk.last; });
  return eq;
}
function paperUnreal() {
  let u = 0;
  paper().positions.forEach((x) => {
    const tk = state.tickers[x.sym]; if (!tk) return;
    u += x.dir * (tk.last - x.entry) * x.qty;
  });
  return u;
}
function openPaper(sym, price, usdtAmount, tpPct, slPct, src, dir) {
  const p = paper();
  dir = dir || 1;
  const qty = usdtAmount / price;
  const openCash = dir > 0 ? -(qty * price * (1 + FEE_RATE)) : (qty * price * (1 - FEE_RATE));
  if (dir > 0 && -openCash > p.bal) return { error: "insufficient" };
  p.bal += openCash;
  const pos = {
    id: "p" + (p.seq++), sym, dir, qty, entry: price, ts: now(), openCash, src: src || "manual",
    tp: tpPct ? price * (1 + (dir > 0 ? tpPct : -tpPct) / 100) : null,
    sl: slPct ? price * (1 - (dir > 0 ? slPct : -slPct) / 100) : null,
  };
  p.positions.push(pos);
  p.history.unshift({ ts: now(), sym, side: dir > 0 ? "BUY" : "SHORT", qty, price, src: pos.src, pnl: null });
  save();
  return { ok: true, pos };
}
function closePaper(posId, price, reason) {
  const p = paper();
  const i = p.positions.findIndex((x) => x.id === posId);
  if (i < 0) return { error: "no position" };
  const pos = p.positions[i];
  const closeCash = pos.dir > 0 ? pos.qty * price * (1 - FEE_RATE) : -(pos.qty * price * (1 + FEE_RATE));
  p.bal += closeCash;
  const pnl = pos.openCash + closeCash;
  p.positions.splice(i, 1);
  p.dayPnl += pnl;
  if (!p.eq) p.eq = [];
  p.eq.push({ t: now(), v: paperEquity() });
  if (p.eq.length > 300) p.eq.shift();
  p.history.unshift({ ts: now(), sym: pos.sym, side: pos.dir > 0 ? "SELL" : "BUY-BACK", qty: pos.qty, price, src: pos.src, pnl, reason });
  const bot = state.bot;
  if (bot && pos.src === "bot") {
    bot.stats.trades++;
    if (pnl >= 0) bot.stats.wins++; else bot.stats.losses++;
    bot.stats.pnl += pnl;
  }
  save();
  return { ok: true, pnl };
}
function closePaperAll(sym, price, reason) {
  paper().positions.filter((x) => !sym || x.sym === sym).forEach((x) => closePaper(x.id, price, reason));
}
function checkPaperPositions(sym, price) {
  const p = paper();
  p.positions.filter((x) => x.sym === sym).forEach((pos) => {
    if (pos.tp && ((pos.dir > 0 && price >= pos.tp) || (pos.dir < 0 && price <= pos.tp))) {
      const r = closePaper(pos.id, pos.tp, "TP");
      notify(t("trade.tp"), `${pos.sym.replace("USDT", "/USDT")} ${pos.dir > 0 ? "long" : "short"} closed at ${fmtPrice(pos.tp)} · ${r.pnl >= 0 ? "+" : ""}${fmtUsd(r.pnl)}`, "ok");
      paintTrade(); paintBotStats();
    } else if (pos.sl && ((pos.dir > 0 && price <= pos.sl) || (pos.dir < 0 && price >= pos.sl))) {
      const r = closePaper(pos.id, pos.sl, "SL");
      notify(t("trade.sl"), `${pos.sym.replace("USDT", "/USDT")} ${pos.dir > 0 ? "long" : "short"} stopped at ${fmtPrice(pos.sl)} · ${fmtUsd(r.pnl)}`, "bad");
      paintTrade(); paintBotStats();
    }
  });
}

/* ============================================================================
 * LIVE TRADING (signed on-device by the Kotlin bridge)
 * ========================================================================== */
const liveEx = () => (state.settings.exchange === "bybit" ? "bybit" : "binance");
const canTradeLive = () => hasBridge() && (state.settings.exchange === "binance" || state.settings.exchange === "bybit");

async function liveCall(method, path, params) {
  const ex = liveEx();
  const raw = bc(ex + "Signed", method, path, JSON.stringify(params || {}));
  if (raw == null) throw new Error(t("live.unsupported"));
  const j = JSON.parse(raw);
  if (j && (j.error === true || j.retCode > 0 || (j.code != null && j.code < 0))) {
    throw new Error(j.msg || j.retMsg || ("error " + (j.code || j.retCode)));
  }
  return j;
}
async function liveBalances() {
  if (liveEx() === "bybit") {
    const j = await liveCall("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" });
    const list = ((j.result || {}).list || [])[0] || {};
    const out = {};
    (list.coin || []).forEach((c) => { out[c.coin] = { free: +c.walletBalance, locked: 0 }; });
    return out;
  }
  const j = await liveCall("GET", "/api/v3/account", {});
  const out = {};
  (j.balances || []).forEach((b) => { if (+b.free || +b.locked) out[b.asset] = { free: +b.free, locked: +b.locked }; });
  return out;
}
let qtyFilters = {};
async function qtyFilter(sym) {
  if (qtyFilters[sym]) return qtyFilters[sym];
  let f = { step: 0.00001, min: 0, dp: 6 };
  try {
    if (liveEx() === "bybit") {
      const j = JSON.parse(await httpGet(`https://api.bybit.com/v5/market/instruments-info?category=spot&symbol=${sym}`));
      const x = (((j.result || {}).list || [])[0] || {}).lotSizeFilter || {};
      const step = +x.basePrecision ? Math.pow(10, -+x.basePrecision) : +(x.qtyStep || 0.000001);
      f = { step: step || 0.000001, min: +(x.minOrderQty || 0), dp: Math.max(0, Math.round(-Math.log10(step || 0.000001))) };
    } else {
      const j = JSON.parse(await httpGet("https://api.binance.com/api/v3/exchangeInfo?symbol=" + sym));
      const s = (j.symbols || [])[0] || {};
      const lot = (s.filters || []).find((x) => x.filterType === "LOT_SIZE") || {};
      const step = +(lot.stepSize || 0.000001);
      f = { step, min: +(lot.minQty || 0), dp: Math.max(0, Math.round(-Math.log10(step))) };
    }
  } catch (e) { /* keep defaults */ }
  qtyFilters[sym] = f;
  return f;
}
function roundQty(qty, f) {
  const s = f.step || 0.000001;
  const v = Math.floor(qty / s) * s;
  return +v.toFixed(f.dp);
}
async function livePlaceOrder(sym, side, qty, price, type) {
  const f = await qtyFilter(sym);
  const q = roundQty(qty, f);
  if (!(q > 0) || q < (f.min || 0)) throw new Error("qty below exchange minimum (" + (f.min || f.step) + ")");
  if (liveEx() === "bybit") {
    const p = { category: "spot", symbol: sym, side: side === "BUY" ? "Buy" : "Sell", orderType: type || "Market", qty: String(q) };
    if ((type || "Market") === "Limit") { p.price = String(price); p.timeInForce = "GTC"; }
    return await liveCall("POST", "/v5/order/create", p);
  }
  const p = { symbol: sym, side: side, type: type || "MARKET", quantity: String(q) };
  if ((type || "MARKET") === "LIMIT") { p.price = String(price); p.timeInForce = "GTC"; }
  return await liveCall("POST", "/api/v3/order", p);
}
async function liveOpenOrders() {
  if (liveEx() === "bybit") {
    const j = await liveCall("GET", "/v5/order/realtime", { category: "spot", openOnly: "0" });
    return (((j.result || {}).list) || []).map((o) => ({ id: o.orderId, sym: o.symbol, side: o.side === "Buy" ? "BUY" : "SELL", qty: +o.qty, price: +o.price, type: o.orderType, ts: +o.createdTime }));
  }
  const j = await liveCall("GET", "/api/v3/openOrders", {});
  return (j || []).map((o) => ({ id: o.orderId, sym: o.symbol, side: o.side, qty: +o.origQty, price: +o.price, type: o.type, ts: o.time }));
}
async function liveCancel(sym, id) {
  if (liveEx() === "bybit") return await liveCall("POST", "/v5/order/cancel", { category: "spot", symbol: sym, orderId: id });
  return await liveCall("DELETE", "/api/v3/order", { symbol: sym, orderId: id });
}

/* ============================================================================
 * UI — trade tab
 * ========================================================================== */
function paintTrade() {
  const live = state.settings.liveMode === "live";
  document.querySelectorAll("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.settings.liveMode));
  $("balCard").querySelector("h3").textContent = t("trade.balance") + (live ? " · LIVE" : " · paper");
  const ordNote = $("ordNote");
  if (live) {
    ordNote.innerHTML = canTradeLive()
      ? '<span class="dn">' + t("trade.liveNote") + "</span> " + t("trade.needKeys")
      : t("trade.browserNote") + " " + t("trade.live.unsupported");
  } else {
    ordNote.textContent = t("trade.paperNote");
  }
  paintBalances();
  paintPositions();
  paintOrders();
  paintHistory();
  updateOrderEst();
}

let lastBalFetch = 0;
function paintBalancesThrottled() {
  if (state.settings.liveMode !== "live") { paintBalances(); return; }
  if (now() - lastBalFetch < 15000) return;
  lastBalFetch = now();
  paintBalances();
}
async function paintBalances() {
  const live = state.settings.liveMode === "live";
  const box = $("balBody");
  if (!live) {
    const p = paper();
    const eq = paperEquity(), u = paperUnreal();
    const base = state.sym.replace("USDT", "");
    box.innerHTML = `
      <div class="grid3">
        <div><div class="small dim">${t("trade.equity")}</div><div class="bb">${fmtUsd(eq)}</div></div>
        <div><div class="small dim">${t("trade.free")}</div><div class="bb">${fmtUsd(p.bal)}</div></div>
        <div><div class="small dim">${t("pos.pnl")}</div><div class="bb ${u >= 0 ? "up" : "dn"}">${fmtUsd(u)}</div></div>
      </div>
      <div class="small dim mt">${t("bot.stat.pnl")}: <span class="${p.dayPnl >= 0 ? "up" : "dn"}">${fmtUsd(p.dayPnl)}</span> ·
        ${p.positions.length} ${t("trade.pos").toLowerCase()} · ${base}</div>`;
    return;
  }
  if (!canTradeLive()) { box.innerHTML = '<div class="hint">' + t("trade.browserNote") + "</div>"; return; }
  box.innerHTML = '<div class="hint"><span class="spinner"></span> …</div>';
  try {
    const bal = await liveBalances();
    const base = state.sym.replace("USDT", "");
    const usdt = bal.USDT || { free: 0, locked: 0 };
    const b = bal[base] || { free: 0, locked: 0 };
    box.innerHTML = `
      <div class="grid3">
        <div><div class="small dim">USDT</div><div class="bb">${fmtUsd(usdt.free)}</div></div>
        <div><div class="small dim">${esc(base)}</div><div class="bb">${fmtQty(b.free)}</div></div>
        <div><div class="small dim">${liveEx()}</div><div class="bb small">${state.settings.testnet ? "testnet" : "mainnet"}</div></div>
      </div>`;
  } catch (e) {
    box.innerHTML = '<div class="hint dn">' + esc(e.message || "error") + "</div>";
  }
}

function paintPositions() {
  const box = $("posList");
  const live = state.settings.liveMode === "live";
  if (live) { box.innerHTML = '<div class="hint">' + t("trade.liveNote") + ' <span class="mut">(' + t("trade.none") + ")</span></div>"; return; }
  const ps = paper().positions;
  if (!ps.length) { box.innerHTML = '<div class="empty">' + t("trade.none") + "</div>"; return; }
  box.innerHTML = ps.map((p) => {
    const tk = state.tickers[p.sym] || { last: p.entry };
    const pnl = p.dir * (tk.last - p.entry) * p.qty;
    const pct = p.entry ? ((tk.last - p.entry) / p.entry) * 100 * p.dir : 0;
    const lo = Math.min(p.tp || tk.last, p.sl || tk.last, p.entry), hi = Math.max(p.tp || tk.last, p.sl || tk.last, p.entry);
    const at = hi > lo ? ((tk.last - lo) / (hi - lo)) * 100 : 50;
    const tpPos = hi > lo ? (((p.tp || hi) - lo) / (hi - lo)) * 100 : 100;
    const slPos = hi > lo ? (((p.sl || lo) - lo) / (hi - lo)) * 100 : 0;
    return `<div class="pos">
      <div class="hd"><span>${esc(p.sym.replace("USDT", "/USDT"))}
        <span class="tiny ${p.dir > 0 ? "up" : "dn"}">${p.dir > 0 ? "LONG" : "SHORT"}</span>
        <span class="tiny dim">${p.src === "bot" ? "🤖" : "👤"}</span></span>
        <span class="pnl ${pnl >= 0 ? "up" : "dn"}">${fmtUsd(pnl)} (${fmtPct(pct)})</span></div>
      <table class="kv"><tr>
        <td>${t("pos.entry")} <b>${fmtPrice(p.entry)}</b></td>
        <td>qty <b>${fmtQty(p.qty)}</b></td>
        <td>${t("pos.now")} <b>${fmtPrice(tk.last)}</b></td>
      </tr></table>
      <div class="pbar">
        <span style="left:${clamp(slPos, 0, 100)}%;width:2px;background:var(--dn)"></span>
        <span style="left:${clamp(tpPos, 0, 100)}%;width:2px;background:var(--up)"></span>
        <span style="left:${clamp(at, 0, 100)}%;width:4px;background:var(--gold);margin-left:-2px"></span>
      </div>
      <div class="row between mt tiny dim"><span>SL ${p.sl ? fmtPrice(p.sl) : "—"}</span><span>TP ${p.tp ? fmtPrice(p.tp) : "—"}</span></div>
      <button class="btn ghost sm block mt" data-close="${p.id}">${t("pos.close")}</button>
    </div>`;
  }).join("");
  box.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => {
    const pos = paper().positions.find((x) => x.id === b.dataset.close);
    const tk = state.tickers[pos.sym] || { last: pos.entry };
    const r = closePaper(pos.id, tk.last, "manual");
    toast(`${t("trade.closed")} · ${fmtUsd(r.pnl)}`, r.pnl >= 0 ? "ok" : "bad");
    haptic(35); paintTrade(); paintBotStats();
  });
}

function paintOrders() {
  const box = $("ordList");
  const live = state.settings.liveMode === "live";
  const orders = live ? state.toOpenOrders : paper().orders;
  if (!orders.length) { box.innerHTML = '<div class="empty">' + t("trade.none") + "</div>"; return; }
  box.innerHTML = orders.map((o) => `
    <div class="row between" style="padding:7px 0;border-bottom:1px dashed rgba(31,42,66,.8)">
      <div><b>${esc((o.sym || "").replace("USDT", "/USDT"))}</b>
        <span class="small ${o.side === "BUY" || o.side === "Buy" ? "up" : "dn"}">${esc(o.side)}</span>
        <span class="small mut">${o.type || "LIMIT"}</span></div>
      <div class="small mono">${fmtQty(o.qty)} @ ${fmtPrice(o.price)}</div>
      <button class="btn ghost sm" data-cancel="${o.id}" data-sym="${o.sym}">✕</button>
    </div>`).join("");
  box.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = async () => {
    if (!live) {
      const p = paper();
      p.orders = p.orders.filter((o) => o.id !== b.dataset.cancel);
      save(); paintOrders(); return;
    }
    try { await liveCancel(b.dataset.sym, b.dataset.cancel); toast(t("ok"), "ok"); refreshLiveOrders(); }
    catch (e) { toast(t("error") + ": " + e.message, "bad"); }
  });
}
async function refreshLiveOrders() {
  if (state.settings.liveMode !== "live" || !canTradeLive()) return;
  try { state.toOpenOrders = await liveOpenOrders(); paintOrders(); } catch (e) { }
}

function paintHistory() {
  const box = $("histList");
  const h = paper().history.slice(0, 25);
  if (!h.length) { box.innerHTML = '<div class="empty">' + t("trade.none") + "</div>"; return; }
  box.innerHTML = h.map((x) => `
    <div class="row between small" style="padding:6px 0;border-bottom:1px dashed rgba(31,42,66,.8)">
      <span><b>${esc((x.sym || "").replace("USDT", "/USDT"))}</b>
        <span class="${x.side === "BUY" || x.side === "SELL" ? (x.side === "BUY" ? "up" : "dn") : "gold"}">${esc(x.side)}</span>
        ${x.reason ? '<span class="tiny dim">' + esc(x.reason) + "</span>" : ""}</span>
      <span class="mono mut">${fmtQty(x.qty)} @ ${fmtPrice(x.price)}</span>
      <span class="${x.pnl == null ? "dim" : x.pnl >= 0 ? "up" : "dn"} mono">${x.pnl == null ? "—" : fmtUsd(x.pnl)}</span>
    </div>`).join("");
}

function updateOrderEst() {
  const tk = state.tickers[state.sym] || {};
  const qty = parseFloat($("ordAmt").value) || 0;
  const price = parseFloat($("ordPrice").value) || tk.last || 0;
  const v = qty * price;
  $("buyEst").textContent = v ? fmtUsd(v) : t("trade.est") + " —";
  $("sellEst").textContent = v ? fmtUsd(v) : t("trade.est") + " —";
  $("ordLast").textContent = "last " + fmtPrice(tk.last);
}

async function placeOrder(side) {
  const tk = state.tickers[state.sym] || {};
  const live = state.settings.liveMode === "live";
  const isLimit = document.querySelector("#typeSeg button.on").dataset.t === "limit";
  const price = isLimit ? parseFloat($("ordPrice").value) : tk.last;
  const qty = parseFloat($("ordAmt").value);
  const tp = parseFloat($("ordTp").value) || 0;
  const sl = parseFloat($("ordSl").value) || 0;
  if (!price || !qty || qty <= 0) { toast(t("error") + ": " + t("trade.amount"), "bad"); return; }
  if (live && !canTradeLive()) { toast(t("live.unsupported"), "bad"); return; }

  if (side === "SELL") {
    // spot semantics: sell closes what you hold (paper: your long positions)
    if (!live) {
      const pos = paper().positions.filter((x) => x.sym === state.sym && x.dir > 0);
      if (!pos.length) { toast(t("error") + ": " + t("trade.none"), "bad"); return; }
      let left = qty;
      pos.forEach((p) => {
        if (left <= 0) return;
        const q = Math.min(left, p.qty);
        if (q >= p.qty) { const r = closePaper(p.id, price, "manual"); toast(`${t("trade.closed")} ${fmtUsd(r.pnl)}`, r.pnl >= 0 ? "ok" : "bad"); left -= q; }
        else {
          const part = p.qty - q;
          const r = closePaper(p.id, price, "manual-part");
          if (r.ok) openPaper(p.sym, price, part * price, 0, 0, p.src, 1);
          left -= q;
        }
      });
      paintTrade(); paintBotStats();
      return;
    }
  }

  const doIt = async () => {
    try {
      if (live) {
        const r = await livePlaceOrder(state.sym, side, qty, price, isLimit ? "LIMIT" : "MARKET");
        toast(t("trade.placed") + " · " + (r.orderId ? "#" + String(r.orderId).slice(0, 8) : t("ok")), "ok");
        notify(t("trade.placed"), `${side} ${fmtQty(qty)} ${state.sym}`, "ok");
        setTimeout(() => { paintBalances(); refreshLiveOrders(); }, 900);
      } else if (isLimit) {
        const p = paper();
        if (side === "SELL") {
          const held = p.positions.filter((x) => x.sym === state.sym && x.dir > 0).reduce((sum, x) => sum + x.qty, 0);
          if (!held) { toast(t("error") + ": " + t("trade.none"), "bad"); return; }
          p.orders.push({ id: uid(), sym: state.sym, side, qty: Math.min(qty, held), price, type: "LIMIT", closeLong: true, ts: now() });
        } else {
          p.orders.push({ id: uid(), sym: state.sym, side, qty, price, type: "LIMIT", ts: now(), tp, sl });
        }
        save(); paintOrders();
        toast(t("trade.placed") + " (limit)", "ok");
      } else {
        const r = openPaper(state.sym, price, qty * price, tp, sl, "manual", 1);
        if (r.error) { toast(t("trade.insufficient"), "bad"); return; }
        toast(t("trade.filled") + " · BUY " + fmtQty(qty) + " " + state.sym.replace("USDT", ""), "ok");
        haptic(40);
        paintTrade();
      }
      $("ordAmt").value = "";
      updateOrderEst();
    } catch (e) { toast(t("error") + ": " + (e.message || e), "bad"); }
  };

  if (live) {
    openOk(t("trade.confirmLive"),
      `<b>${side}</b> ${fmtQty(qty)} ${esc(state.sym.replace("USDT", "/USDT"))}<br>${isLimit ? "limit" : "market"} · ≈ ${fmtUsd(qty * price)}<br>
       <span class="dn">${t("trade.liveNote")}</span>`, doIt);
  } else {
    doIt();
  }
}

function checkPaperLimitOrders() {
  const p = paper();
  if (!p.orders.length) return;
  let changed = false;
  p.orders = p.orders.filter((o) => {
    const tk = state.tickers[o.sym];
    if (!tk) return true;
    const hit = o.side === "BUY" ? tk.last <= o.price : tk.last >= o.price;
    if (!hit) return true;
    if (o.closeLong) {
      let left = o.qty;
      paper().positions.filter((x) => x.sym === o.sym && x.dir > 0).forEach((pos) => {
        if (left <= 0) return;
        if (pos.qty <= left) { closePaper(pos.id, o.price, "limit-tp"); left -= pos.qty; }
      });
      notify(t("trade.filled"), `LIMIT SELL ${fmtQty(o.qty)} ${o.sym.replace("USDT", "/USDT")} @ ${fmtPrice(o.price)}`, "ok");
      changed = true;
      return false;
    }
    const r = openPaper(o.sym, o.price, o.qty * o.price, o.tp, o.sl, "limit", 1);
    if (r.error) { toast(t("trade.insufficient") + " (limit)", "bad"); return false; }
    notify(t("trade.filled"), `${o.side} ${fmtQty(o.qty)} ${o.sym.replace("USDT", "/USDT")} @ ${fmtPrice(o.price)}`, "ok");
    changed = true;
    return false;
  });
  if (changed) { save(); paintTrade(); }
}

/* ============================================================================
 * BOT ENGINE — strategies, risk limits, notifications
 * ========================================================================== */
function bot() {
  if (!state.bot) {
    state.bot = { running: false, log: [], stats: { signals: 0, trades: 0, wins: 0, losses: 0, pnl: 0 }, lastEntry: {}, loop: null, startedAt: 0, livePos: [] };
  }
  return state.bot;
}
function logLine(msg, cls) {
  const b = bot();
  b.log.push({ ts: now(), msg, cls: cls || "" });
  if (b.log.length > 150) b.log.shift();
  const box = $("botLog");
  if (box) {
    const n = el("div", cls || "");
    n.innerHTML = '<span class="t">' + fmtClock(now()) + "</span>" + esc(msg);
    box.appendChild(n);
    while (box.childNodes.length > 150) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }
}

function decide(rep, klines, strat, allowShort) {
  const m = rep.metrics;
  const need = allowShort ? 1 : 0;
  if (strat === "trend") {
    const up = m.ema20 != null && m.ema50 != null && m.ema20 > m.ema50 && (m.macdHist || 0) > 0;
    const dn = m.ema20 != null && m.ema50 != null && m.ema20 < m.ema50 && (m.macdHist || 0) < 0;
    return up ? 1 : dn ? (need ? -1 : 0) : 0;
  }
  if (strat === "revert") {
    if (m.rsi == null) return 0;
    if (m.rsi < 32) return 1;
    if (m.rsi > 68) return need ? -1 : 0;
    return 0;
  }
  if (strat === "breakout") {
    const n = klines.length;
    if (n < 22) return 0;
    let hi = -Infinity, lo = Infinity;
    for (let i = n - 21; i < n - 1; i++) { hi = Math.max(hi, klines[i].h); lo = Math.min(lo, klines[i].l); }
    const c = klines[n - 1].c;
    if (c > hi) return 1;
    if (c < lo) return need ? -1 : 0;
    return 0;
  }
  // default: blended AI signal
  if (rep.score >= 25) return 1;
  if (rep.score <= -25) return need ? -1 : 0;
  return 0;
}

async function botTick() {
  const b = bot(), cfg = botCfg();
  if (!b.running) return;
  const lossSinceStart = paper().dayPnl - (b.dayStartPnl || 0);
  if (lossSinceStart <= -Math.abs(cfg.dailyLoss)) {
    logLine(t("bot.dailyStop") + " (" + fmtUsd(lossSinceStart) + ")", "bad");
    notify(t("bot.title"), t("bot.dailyStop"), "bad");
    botStop();
    return;
  }
  for (const sym of cfg.symbols) {
    try { await botEvalSymbol(sym, cfg); } catch (e) { logLine(sym + ": " + (e.message || e), "bad"); }
  }
  paintBotStats(); if (state.tab === "trade") paintTrade();
}

async function botEvalSymbol(sym, cfg) {
  const b = bot();
  const key = sym + "|" + cfg.tf;
  let klines;
  const cache = state.klinesCache[key];
  if (cache && now() - cache.at < 55000) klines = cache.candles;
  else klines = await fetchKlinesSmart(sym, cfg.tf, 300);
  if (!klines || klines.length < 60) return;
  const rep = TA.analyze(klines);
  if (!rep.ok) return;
  b.stats.signals++;
  const bias = decide(rep, klines, cfg.strategy, cfg.allowShort);
  const price = (state.tickers[sym] && state.tickers[sym].last) || klines[klines.length - 1].c;
  const held = paper().positions.filter((x) => x.sym === sym && x.src === "bot");
  const liveHeld = (b.livePos || []).filter((x) => x.sym === sym);
  logLine(`${sym} ${cfg.tf} · ${rep.verdict} (${rep.score}, conf ${rep.confidence}%) → bias ${bias > 0 ? "LONG" : bias < 0 ? "SHORT" : "flat"}`, bias ? "ai" : "");

  // exits on a flip
  if (bias <= 0 && held.length && held[0].dir > 0) {
    const r = closePaper(held[0].id, price, "flip");
    notify(t("trade.closed"), `${sym.replace("USDT", "/USDT")} long closed · ${fmtUsd(r.pnl)}`, r.pnl >= 0 ? "ok" : "bad");
    return;
  }
  if (bias >= 0 && held.length && held[0].dir < 0) {
    const r = closePaper(held[0].id, price, "flip");
    notify(t("trade.closed"), `${sym.replace("USDT", "/USDT")} short closed · ${fmtUsd(r.pnl)}`, r.pnl >= 0 ? "ok" : "bad");
    return;
  }
  if (!bias) return;

  // entry guards
  const cool = (b.lastEntry[sym] || 0) + cfg.cooldown * 60000;
  if (now() < cool) return;
  const openCount = paper().positions.filter((x) => x.src === "bot").length;
  if (openCount >= cfg.maxPos) { logLine("max positions reached (" + cfg.maxPos + ")", "warn"); return; }

  if (state.settings.liveMode === "live" && canTradeLive()) {
    if (bias < 0) { logLine("spot live mode is long-only — short skipped", "warn"); return; }
    const qty = cfg.size / price;
    const res = await livePlaceOrder(sym, "BUY", qty, price, "MARKET");
    const f = await qtyFilter(sym);
    const q = roundQty(qty, f);
    (b.livePos = b.livePos || []).push({ sym, qty: q, entry: price, tp: price * (1 + cfg.tp / 100), sl: price * (1 - cfg.sl / 100), ts: now(), id: res.orderId || uid() });
    b.lastEntry[sym] = now();
    notify(t("trade.placed"), `LIVE BUY ${fmtQty(q)} ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(price)}`, "ok");
    logLine(`live buy ${fmtQty(q)} ${sym} @ ${fmtPrice(price)}`, "ok");
    return;
  }

  const dir = bias > 0 ? 1 : -1;
  const r = openPaper(sym, price, cfg.size, cfg.tp, cfg.sl, "bot", dir);
  if (r.error) { logLine(sym + ": " + (r.error === "insufficient" ? t("trade.insufficient") : r.error), "bad"); return; }
  b.lastEntry[sym] = now();
  notify(t("trade.placed"),
    `${dir > 0 ? "BUY" : "SHORT"} ${cfg.size} USDT ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(price)}\nTP ${fmtPrice(r.pos.tp)} · SL ${fmtPrice(r.pos.sl)}`,
    "ok");
  logLine(`open ${dir > 0 ? "long" : "short"} ${sym} @ ${fmtPrice(price)} tp ${fmtPrice(r.pos.tp)} sl ${fmtPrice(r.pos.sl)}`, "ok");
}

function botOnTick(sym, price) {
  const b = bot();
  if (!b.running || !b.livePos || !b.livePos.length) return;
  b.livePos.filter((x) => x.sym === sym).forEach(async (p) => {
    if (price >= p.tp || price <= p.sl) {
      try {
        await livePlaceOrder(sym, "SELL", p.qty, price, "MARKET");
        notify(price >= p.tp ? t("trade.tp") : t("trade.sl"), `LIVE SELL ${fmtQty(p.qty)} ${sym.replace("USDT", "/USDT")} @ ${fmtPrice(price)}`, price >= p.tp ? "ok" : "bad");
        logLine(`live close ${sym} @ ${fmtPrice(price)}`, price >= p.tp ? "ok" : "bad");
        b.livePos = b.livePos.filter((x) => x !== p);
      } catch (e) { logLine("live close failed: " + e.message, "bad"); }
    }
  });
}
function onPrice(sym, price) {
  checkPaperPositions(sym, price);
  checkPaperLimitOrders();
  if (state.bot && state.bot.running) botOnTick(sym, price);
}

function botStart() {
  const cfg = botCfg(), b = bot();
  if (!cfg.symbols.length) { toast(t("bot.noSymbol"), "bad"); return; }
  if (b.running) return;
  b.running = true; b.startedAt = now(); b.dayStartPnl = paper().dayPnl;
  if (cfg.keep || state.settings.keep) { bc("setKeepScreenOn", true); }
  bc("setAutoOn", true);
  bc("setTradingActive", true);
  bc("startBgService", "CryptoAI bot · " + cfg.symbols.length + " pairs · " + cfg.strategy);
  if (b.loop) clearInterval(b.loop);
  b.loop = setInterval(botTick, 20000);
  logLine("── bot started · " + cfg.strategy + " · " + cfg.tf + " · " + cfg.symbols.join(", ") + " ──", "ok");
  notify(t("bot.started"), cfg.strategy + " · " + cfg.symbols.length + " pairs", "ok");
  paintBot(); paintBotStats();
  setTimeout(botTick, 1200);
}
function botStop() {
  const b = bot(), cfg = botCfg();
  if (!b.running) return;
  b.running = false;
  if (b.loop) { clearInterval(b.loop); b.loop = null; }
  bc("stopBgService");
  bc("setTradingActive", false);
  bc("setKeepScreenOn", !!(state.settings.keep));
  logLine("── bot stopped ──", "warn");
  notify(t("bot.stopped"), "", "bad");
  paintBot(); paintBotStats();
}

function paintBotStats() {
  const b = bot();
  const win = b.stats.trades ? Math.round((b.stats.wins / b.stats.trades) * 100) : 0;
  const el2 = $("botStats");
  if (!el2) return;
  el2.innerHTML = [
    [t("bot.stat.signals"), b.stats.signals, ""],
    [t("bot.stat.trades"), b.stats.trades, ""],
    [t("bot.stat.win"), win + "%", win >= 50 ? "up" : ""],
    [t("bot.stat.pnl"), fmtUsd(b.stats.pnl), b.stats.pnl >= 0 ? "up" : "dn"],
  ].map(([k, v, c]) => `<div class="metric"><div class="k">${esc(k)}</div><div class="v ${c}">${v}</div></div>`).join("");
  const pnl = b.stats.pnl;
  $("botPnl").textContent = (pnl >= 0 ? "+" : "") + fmtUsd(pnl);
  $("botPnl").className = "bb pnl " + (pnl >= 0 ? "up" : "dn");
  $("botState").textContent = b.running ? t("bot.running") : t("bot.idle");
  $("botDot").className = "botdot" + (b.running ? " run" : "");
}

function paintBotSymbols() {
  const cfg = botCfg();
  const box = $("bSymbols");
  if (!box) return;
  const list = state.favs.concat(WATCHLIST.filter((s) => state.favs.indexOf(s) < 0)).slice(0, 14);
  box.innerHTML = list.map((s) => `<button class="chip ${cfg.symbols.indexOf(s) >= 0 ? "on" : ""}" data-bsym="${s}">${esc(s.replace("USDT", "/USDT"))}</button>`).join("");
  box.querySelectorAll("[data-bsym]").forEach((b) => b.onclick = () => {
    const s = b.dataset.bsym, i = cfg.symbols.indexOf(s);
    if (i >= 0) cfg.symbols.splice(i, 1); else cfg.symbols.push(s);
    save(); paintBotSymbols();
  });
}

function paintBot() {
  const cfg = botCfg(), b = bot();
  $("bStrat").value = cfg.strategy;
  $("bTf").value = cfg.tf;
  $("bSize").value = cfg.size;
  $("bTp").value = cfg.tp;
  $("bSl").value = cfg.sl;
  $("bMaxPos").value = cfg.maxPos;
  $("bCool").value = cfg.cooldown;
  $("bDaily").value = cfg.dailyLoss;
  $("bShort").classList.toggle("on", !!cfg.allowShort);
  $("bNotify").classList.toggle("on", !!cfg.notify);
  $("bKeep").classList.toggle("on", !!cfg.keep);
  $("bStratDesc").textContent = t("bot.desc." + cfg.strategy);
  $("bRiskNote").textContent = t("bot.riskNote");
  $("botStart").disabled = b.running;
  $("botStop").disabled = !b.running;
  paintBotSymbols();
  paintBotStats();
  const box = $("botLog");
  box.innerHTML = b.log.map((l) => `<div class="${l.cls}"><span class="t">${fmtClock(l.ts)}</span>${esc(l.msg)}</div>`).join("");
  box.scrollTop = box.scrollHeight;
}

/* ============================================================================
 * SHEETS / MODALS
 * ========================================================================== */
function openSheet(id) { $(id).classList.add("on"); }
function closeSheet(id) { $(id).classList.remove("on"); }
let okCb = null;
function openOk(title, body, onYes) { $("okTitle").textContent = title; $("okBody").innerHTML = body; okCb = onYes || null; openSheet("okModal"); }

function paintSymbolSheet(filter) {
  const box = $("symList");
  const q = (filter || "").toUpperCase().replace("/", "").replace("-", "");
  const all = WATCHLIST.concat(state.favs.filter((s) => WATCHLIST.indexOf(s) < 0));
  const list = q ? all.filter((s) => s.indexOf(q) >= 0) : all;
  box.innerHTML = list.map((s) => {
    const tk = state.tickers[s] || {};
    return `<div class="mrow" data-pick="${s}">
      <button class="star ${state.favs.indexOf(s) >= 0 ? "on" : ""}" data-fav2="${s}">★</button>
      <div class="sym"><b>${esc(s.replace("USDT", "/USDT"))}</b><span>${state.dataSource}</span></div>
      <div class="px mono">${fmtPrice(tk.last)}</div>
      <div class="chg ${(tk.chg || 0) < 0 ? "dn" : ""}">${fmtPct(tk.chg || 0)}</div></div>`;
  }).join("") || '<div class="empty">—</div>';
  box.querySelectorAll("[data-pick]").forEach((r) => r.onclick = () => {
    state.sym = r.dataset.pick; save(); closeSheet("symModal");
    loadChart(); paintChartHeader(); paintSignals(); paintTrade();
  });
  box.querySelectorAll("[data-fav2]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const s = b.dataset.fav2, i = state.favs.indexOf(s);
    if (i >= 0) state.favs.splice(i, 1); else state.favs.push(s);
    save(); paintSymbolSheet($("symSearch").value); paintMarkets();
  });
}

/* ============================================================================
 * SETTINGS
 * ========================================================================== */
const AI_MODELS = {
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  huggingface: "meta-llama/Llama-3.3-70B-Instruct",
  custom: "gpt-4o-mini",
};
function paintSettings() {
  const s = state.settings;
  $("setLang").value = s.lang;
  $("setEx").innerHTML = EX_IDS.map((e) => `<option value="${e}">${EX[e].label}</option>`).join("");
  $("setEx").value = s.exchange;
  $("setTestnet").classList.toggle("on", !!s.testnet);
  $("setSound").classList.toggle("on", !!s.sound);
  $("setHaptic").classList.toggle("on", !!s.haptic);
  $("setTts").classList.toggle("on", !!s.tts);
  $("setKeep").classList.toggle("on", !!s.keep);
  $("setAiProvider").value = s.aiProvider;
  $("setAiKey").value = s.aiKey || "";
  $("setAiModel").value = s.aiModel || "";
  $("setAiBase").value = s.aiBase || "";
  $("aiBaseWrap").style.display = s.aiProvider === "custom" ? "block" : "none";
  $("aiKeyWrap").style.display = s.aiProvider === "off" ? "none" : "block";
  $("setVersion").textContent = (B ? bc("version") : "web") || "web";
  $("setEngine").textContent = TA ? "ta.js v" + TA.version : "—";
  $("setRuntime").textContent = B ? "Android WebView" + (state.settings.testnet ? " · testnet" : "") : "Browser (paper only)";
  paintKeyStatus();
}
function paintKeyStatus() {
  const box = $("setKeyStatus");
  if (!canTradeLive()) { box.innerHTML = '<span class="mut">' + t("trade.browserNote") + "</span>"; return; }
  const raw = bc(liveEx() + "Status");
  if (!raw) { box.textContent = t("set.noKeys"); return; }
  try {
    const j = JSON.parse(raw);
    box.innerHTML = j.hasKeys
      ? `<span class="up">● ${t("set.keySaved")}</span> · ${esc(j.keyPreview || "")} · ${esc(j.base || "")}`
      : `<span class="dn">● ${t("set.noKeys")}</span>`;
  } catch (e) { box.textContent = t("set.noKeys"); }
}
async function testKeys() {
  const box = $("setKeyStatus");
  box.innerHTML = '<span class="spinner"></span> …';
  try {
    if (liveEx() === "bybit") await liveCall("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" });
    else await liveCall("GET", "/api/v3/account", {});
    box.innerHTML = '<span class="up">● ' + t("set.keyOk") + "</span>";
    toast(t("set.keyOk"), "ok");
    if (state.settings.liveMode === "live") paintBalances();
  } catch (e) {
    box.innerHTML = '<span class="dn">● ' + t("set.keyFail") + ": " + esc(e.message || "") + "</span>";
  }
}

/* ============================================================================
 * I18N APPLY + EVENT WIRING
 * ========================================================================== */
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((n) => {
    const k = n.dataset.i18n, s = t(k);
    if (s && s !== k) n.textContent = s;
  });
  document.querySelectorAll("[data-i18n-opt]").forEach((n) => { n.textContent = t(n.dataset.i18nOpt); });
  document.querySelectorAll("#mChips [data-sort]").forEach((b) => { b.textContent = t("sort." + b.dataset.sort); });
  $("mSearch").placeholder = "🔍 BTC, ETH, SOL…";
  $("buyBtn").firstChild.textContent = t("trade.buy") + " ";
  $("sellBtn").firstChild.textContent = t("trade.sell") + " ";
  $("langBtn").textContent = state.settings.lang === "si" ? "සිං" : "EN";
  const chips = { ema: "EMA 20/50", bb: "Bollinger", vol: "Volume", rsi: "RSI" };
  document.querySelectorAll("#indChips [data-ind]").forEach((b) => { b.textContent = chips[b.dataset.ind]; });
  const aio = $("setAiProvider");
  if (aio) { aio.options[0].textContent = t("ai.off"); aio.options[3].textContent = t("ai.custom"); }
  const tfSeg = document.querySelector("#typeSeg");
  tfSeg.querySelector('[data-t="market"]').textContent = t("trade.market");
  tfSeg.querySelector('[data-t="limit"]').textContent = t("trade.limit");
  document.querySelector('#modeSeg [data-mode="paper"]').textContent = t("trade.paper");
  document.querySelector('#modeSeg [data-mode="live"]').textContent = t("trade.live");
  paintBotSymbols();
}

function bindUI() {
  document.querySelectorAll("#nav button").forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
  document.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => closeSheet(b.dataset.close));
  document.querySelectorAll(".modal").forEach((m) => m.onclick = (e) => { if (e.target === m) m.classList.remove("on"); });
  $("okYes").onclick = () => { const cb = okCb; okCb = null; closeSheet("okModal"); if (cb) cb(); };

  $("setBtn").onclick = () => { paintSettings(); openSheet("setModal"); };
  $("langBtn").onclick = () => {
    state.settings.lang = state.settings.lang === "si" ? "en" : "si";
    save(); applyI18n(); renderAll(); updateOrderEst(); paintSettings();
  };

  // markets
  document.querySelectorAll("#mChips [data-sort]").forEach((b) => b.onclick = () => {
    state.sort = b.dataset.sort; save();
    document.querySelectorAll("#mChips [data-sort]").forEach((x) => x.classList.toggle("on", x === b));
    paintMarkets();
  });
  $("mSearch").oninput = (e) => { state.search = e.target.value.trim(); paintMarkets(); };
  $("mReload").onclick = async () => {
    toast("…", "", 900);
    const ok = await fetchTickersSmart();
    if (!ok) { demoInit(); state.dataMode = "demo"; state.dataSource = "demo"; startStream(); }
    else state.dataMode = "live";
    setConn(state.dataMode === "live" ? "live" : "demo");
    state.klines = await fetchKlinesSmart(state.sym, state.tf, 300);
    renderAll(); renderChart();
  };

  // chart
  document.querySelectorAll("#tfChips [data-tf]").forEach((b) => b.onclick = () => {
    state.tf = b.dataset.tf; save();
    document.querySelectorAll("#tfChips [data-tf]").forEach((x) => x.classList.toggle("on", x === b));
    loadChart();
  });
  document.querySelectorAll("#indChips [data-ind]").forEach((b) => b.onclick = () => {
    state.chartInd[b.dataset.ind] = !state.chartInd[b.dataset.ind];
    b.classList.toggle("on", state.chartInd[b.dataset.ind]);
    save(); renderChart();
  });
  $("symBtn").onclick = () => { paintSymbolSheet(""); openSheet("symModal"); };
  $("ordSymBtn").onclick = () => { paintSymbolSheet(""); openSheet("symModal"); };
  $("symSearch").oninput = (e) => paintSymbolSheet(e.target.value);
  $("sigBtn").onclick = () => { switchTab("signals"); };
  $("chartTradeBtn").onclick = () => switchTab("trade");
  $("alertBtn").onclick = () => {
    const tk = state.tickers[state.sym] || {};
    $("alertPrice").value = tk.last || "";
    paintAlerts(); openSheet("alertModal");
  };
  $("alertAdd").onclick = () => {
    const price = parseFloat($("alertPrice").value);
    if (!price) { toast(t("alert.needPrice"), "bad"); return; }
    state.alerts.push({ id: uid(), sym: state.sym, price, dir: $("alertWhen").value });
    save(); paintAlerts(); paintAlertBadge(); closeSheet("alertModal"); toast(t("saved"), "ok");
  };
  $("scanBtn").onclick = runScan;
  $("scanStop").onclick = () => { scanState().running = false; paintScan(); scanInfo(); };
  $("mtfBtn").onclick = () => paintMTF();
  ["calcAcct", "calcRisk", "calcStop"].forEach((id) => $(id).oninput = paintCalc);
  $("calcUse").onclick = () => {
    if (!calcQty) { toast(t("calc.badStop"), "bad"); return; }
    $("ordAmt").value = calcQty.toFixed(6);
    const isLimit = document.querySelector("#typeSeg button.on").dataset.t === "limit";
    if (isLimit) $("ordPrice").value = (state.tickers[state.sym] || {}).last || "";
    document.querySelector('#typeSeg [data-t="market"]').click();
    updateOrderEst();
    toast(t("calc.use") + " → " + fmtQty(calcQty), "ok");
    haptic(30);
    if ($("ordAmt").scrollIntoView) $("ordAmt").scrollIntoView({ behavior: "smooth", block: "center" });
  };
  $("aiBtn").onclick = aiExplain;
  $("btBtn").onclick = runBacktest;

  // trade
  document.querySelectorAll("#modeSeg [data-mode]").forEach((b) => b.onclick = () => {
    if (b.dataset.mode === "live" && !canTradeLive()) { toast(t("live.unsupported"), "bad"); return; }
    state.settings.liveMode = b.dataset.mode; save();
    if (b.dataset.mode === "live") refreshLiveOrders();
    paintTrade();
  });
  document.querySelectorAll("#typeSeg [data-t]").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#typeSeg [data-t]").forEach((x) => x.classList.toggle("on", x === b));
    $("priceWrap").style.display = b.dataset.t === "limit" ? "block" : "none";
    updateOrderEst();
  });
  document.querySelectorAll("[data-pct]").forEach((b) => b.onclick = () => {
    const tk = state.tickers[state.sym] || {};
    const pct = parseInt(b.dataset.pct, 10) / 100;
    if (!tk.last) return;
    if (state.settings.liveMode === "live") { $("ordAmt").value = ((paper().bal * pct) / tk.last).toFixed(6); }
    else {
      // buy: % of free USDT · sell: % of the open long
      const long = paper().positions.filter((x) => x.sym === state.sym && x.dir > 0).reduce((s, x) => s + x.qty, 0);
      const usdt = paper().bal * pct;
      const usingLong = document.querySelector("#typeSeg button.on") && $("ordAmt").dataset.side === "sell";
      $("ordAmt").value = (long > 0 && $("ordAmt").dataset.side === "sell" ? long * pct : usdt / tk.last).toFixed(6);
    }
    updateOrderEst();
  });
  ["ordAmt", "ordPrice"].forEach((id) => $(id).oninput = updateOrderEst);
  $("buyBtn").onclick = () => { $("ordAmt").dataset.side = "buy"; placeOrder("BUY"); };
  $("sellBtn").onclick = () => { $("ordAmt").dataset.side = "sell"; placeOrder("SELL"); };

  // bot
  $("bStrat").onchange = (e) => { botCfg().strategy = e.target.value; save(); paintBot(); };
  $("bTf").onchange = (e) => { botCfg().tf = e.target.value; save(); };
  [["bSize", "size"], ["bTp", "tp"], ["bSl", "sl"], ["bMaxPos", "maxPos"], ["bCool", "cooldown"], ["bDaily", "dailyLoss"]].forEach(([id, k]) => {
    $(id).onchange = (e) => { botCfg()[k] = parseFloat(e.target.value) || 0; save(); };
  });
  const sws = [["bShort", "allowShort"], ["bNotify", "notify"], ["bKeep", "keep"]];
  sws.forEach(([id, k]) => $(id).onclick = () => {
    const cfg = botCfg(); cfg[k] = !cfg[k];
    $(id).classList.toggle("on", cfg[k]); save();
    if (k === "keep") { bc("setKeepScreenOn", cfg[k] && bot().running); state.settings.keep = cfg[k]; paintSettings(); }
  });
  $("botStart").onclick = botStart;
  $("botStop").onclick = botStop;
  $("botClear").onclick = () => { bot().log = []; paintBot(); };

  // settings fields
  $("setLang").onchange = (e) => { state.settings.lang = e.target.value; save(); applyI18n(); renderAll(); paintSettings(); };
  $("setEx").onchange = async (e) => {
    state.settings.exchange = e.target.value; save();
    toast(t("saved"), "ok");
    closeStream();
    state.tickers = {};
    const ok = await fetchTickersSmart();
    if (!ok) { demoInit(); state.dataMode = "demo"; state.dataSource = "demo"; toast(t("demo.note"), "bad", 3600); }
    else state.dataMode = "live";
    state.klines = await fetchKlinesSmart(state.sym, state.tf, 300);
    startStream(); setConn(state.dataMode === "live" ? "live" : "demo"); renderAll(); renderChart();
  };
  const toggles = [["setSound", "sound"], ["setHaptic", "haptic"], ["setTts", "tts"], ["setKeep", "keep"]];
  toggles.forEach(([id, k]) => $(id).onclick = () => {
    state.settings[k] = !state.settings[k];
    $(id).classList.toggle("on", state.settings[k]); save();
    if (k === "keep") bc("setKeepScreenOn", state.settings[k]);
  });
  $("setTestnet").onclick = () => {
    state.settings.testnet = !state.settings.testnet;
    $("setTestnet").classList.toggle("on", state.settings.testnet);
    save(); paintKeyStatus();
  };
  $("setSaveKeys").onclick = () => {
    const k = $("setKey").value.trim(), s = $("setSecret").value.trim();
    if (!k || !s) { toast(t("set.noKeys"), "bad"); return; }
    const r = bc(liveEx() + "SaveKeys", k, s, state.settings.testnet);
    if (r == null) { toast(t("live.unsupported"), "bad"); return; }
    $("setKey").value = ""; $("setSecret").value = "";
    toast(t("set.keySaved"), "ok"); paintKeyStatus();
  };
  $("setTestKeys").onclick = testKeys;
  $("setClearKeys").onclick = () => {
    bc(liveEx() + "ClearKeys"); toast(t("saved"), "ok"); paintKeyStatus();
  };
  $("setAiProvider").onchange = (e) => {
    state.settings.aiProvider = e.target.value;
    if (!state.settings.aiModel || !state.settings.aiModel.trim()) state.settings.aiModel = AI_MODELS[e.target.value] || "";
    if (e.target.value !== "custom" && AI_MODELS[e.target.value]) state.settings.aiModel = AI_MODELS[e.target.value];
    save(); paintSettings();
  };
  $("setAiKey").onchange = (e) => { state.settings.aiKey = e.target.value.trim(); save(); };
  $("setAiModel").onchange = (e) => { state.settings.aiModel = e.target.value.trim(); save(); };
  $("setAiBase").onchange = (e) => { state.settings.aiBase = e.target.value.trim(); save(); };
  $("setResetPaper").onclick = () => {
    openOk(t("set.resetPaper"), "…", () => {
      state.paper = freshPaper(); state.bot = null; save(); renderAll(); paintSettings();
      toast(t("saved"), "ok");
    });
  };
  $("setWipe").onclick = () => {
    openOk(t("set.wipe"), "⚠ " + t("set.disclaimer"), () => {
      try { localStorage.removeItem(LSKEY); } catch (e) { }
      state.paper = freshPaper(); state.bot = null; state.alerts = []; state.favs = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
      save(); renderAll(); paintSettings(); toast(t("saved"), "ok");
    });
  };

  bindChartTouch();
  window.addEventListener("resize", () => { renderChart(); });
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) return;
    if (state.dataMode === "live") { await fetchTickersSmart(); }
    if (state.tab === "chart") renderChart();
    if (state.tab === "signals") paintSignals();
  });
}

/* ============================================================================
 * BOOT
 * ========================================================================== */
function init() {
  TA = (typeof window !== "undefined" && window.TA) || null;
  load();
  if (!state.paper) state.paper = freshPaper();
  if (!state.botCfg) botCfg();
  if (TA) { /* engine ready */ } else { console.warn("ta.js missing"); }
  applyI18n();
  bindUI();
  paintSettings();
  document.querySelectorAll("#mChips [data-sort]").forEach((x) => x.classList.toggle("on", x.dataset.sort === state.sort));
  document.querySelectorAll("#tfChips [data-tf]").forEach((x) => x.classList.toggle("on", x.dataset.tf === state.tf));
  document.querySelectorAll("#indChips [data-ind]").forEach((x) => x.classList.toggle("on", !!state.chartInd[x.dataset.ind]));
  $("bSymbols").innerHTML = "";
  paintBot();
  const TABS = ["markets", "chart", "signals", "trade", "bot"];
  const fromHash = () => (location.hash || "").replace(/^#/, "").split("?")[0];
  switchTab(TABS.indexOf(fromHash()) >= 0 ? fromHash() : (state.tab || "markets"));
  window.addEventListener("hashchange", () => { if (TABS.indexOf(fromHash()) >= 0) switchTab(fromHash()); });
  startData().catch((e) => { console.warn("startData", e); setConn("off"); });
  setInterval(paintTickerStrip, 4000);
  // surface nav badge for alerts when they exist
  paintAlertBadge();
  logLine("CryptoAI PRO ready" + (B ? " (Android)" : " (browser · paper only)"), "");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

/* ============================================================================
 * SIGNAL SCANNER — ranks every market by signal strength on one timeframe
 * ========================================================================== */
function scanState() { return state.scan || (state.scan = { rows: [], done: 0, total: 0, running: false, tf: "", at: 0 }); }

function scanInfo() {
  const s = scanState(), box = $("scanInfo");
  if (!box) return;
  if (s.running) { box.textContent = t("scan.running", { done: s.done, total: s.total }); return; }
  if (!s.rows.length) { box.textContent = ""; return; }
  const strong = s.rows.filter((r) => Math.abs(r.score) >= 45).length;
  box.textContent = t("scan.result", { n: s.rows.length, tf: s.tf, strong });
}

async function runScan() {
  const s = scanState();
  if (s.running || !TA) return;
  s.running = true; s.done = 0; s.rows = []; s.tf = state.tf;
  const list = WATCHLIST.slice();
  s.total = list.length;
  openSheet("scanModal");
  paintScan();
  for (const sym of list) {
    if (!s.running) break;
    try {
      const k = state.dataMode === "demo" ? demoCandles(sym, s.tf, 150) : await fetchKlinesSmart(sym, s.tf, 150);
      const rep = TA.analyze(k);
      if (rep.ok) s.rows.push({ sym, verdict: rep.verdict, score: rep.score, conf: rep.confidence, price: rep.price, conflict: !!rep.conflict });
    } catch (e) { /* skip symbol */ }
    s.done++;
    if (s.done % 4 === 0 || s.done === s.total) paintScan();
    if (state.dataMode !== "demo") await sleep(90);      // be kind to the exchange rate limits
  }
  s.running = false; s.at = now();
  paintScan(); scanInfo();
  const strong = s.rows.filter((r) => Math.abs(r.score) >= 45).length;
  if (strong) toast(t("scan.result", { n: s.rows.length, tf: s.tf, strong }), "ok", 3600);
  haptic(40);
}

function paintScan() {
  const s = scanState();
  const bar = $("scanBar"), sum = $("scanSummary"), stop = $("scanStop"), list = $("scanList");
  if (!bar) return;
  bar.style.width = (s.total ? (s.done / s.total) * 100 : 0) + "%";
  stop.disabled = !s.running;
  const rows = s.rows.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  sum.innerHTML = s.running
    ? '<span class="spinner"></span> ' + esc(t("scan.running", { done: s.done, total: s.total }))
    : rows.length
      ? esc(t("scan.result", { n: rows.length, tf: s.tf, strong: rows.filter((r) => Math.abs(r.score) >= 45).length }))
      : esc(t("scan.empty"));
  list.innerHTML = rows.map((r) => {
    const cls = r.verdict.indexOf("BUY") >= 0 ? "up" : r.verdict.indexOf("SELL") >= 0 ? "dn" : "mut";
    const w = clamp(Math.abs(r.score), 2, 100);
    return `<div class="mrow" data-scan="${esc(r.sym)}">
      <div class="sym"><b>${esc(r.sym.replace("USDT", "/USDT"))}</b><span class="mono">${fmtPrice(r.price)}</span></div>
      <div style="flex:1;min-width:60px">
        <div class="${cls} b small">${esc(vLabel(r.verdict))} ${r.conflict ? "⚠" : ""}</div>
        <div class="gauge" style="margin-top:5px"><i style="width:${w}%;background:${cls === "up" ? "var(--up)" : cls === "dn" ? "var(--dn)" : "var(--dim)"}"></i></div>
      </div>
      <div class="mono small ${cls}" style="width:64px;text-align:right">${r.score > 0 ? "+" : ""}${r.score}
        <div class="tiny dim">${r.conf}%</div></div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-scan]").forEach((n) => n.onclick = () => {
    state.sym = n.dataset.scan; save();
    closeSheet("scanModal");
    switchTab("chart"); loadChart(); paintChartHeader(); paintSignals(); paintTrade();
  });
}

/* ============================================================================
 * MULTI-TIMEFRAME CONSENSUS
 * ========================================================================== */
let mtfToken = 0;
async function paintMTF() {
  const box = $("mtfRows");
  if (!box || !TA) return;
  const tfs = ["5m", "15m", "1h", "4h"];
  const sym = state.sym;
  const token = ++mtfToken;
  box.innerHTML = tfs.map((tf) => `<div class="row between" data-mtf="${tf}" style="padding:8px 0;border-bottom:1px dashed rgba(31,42,66,.8)">
      <span class="b">${tf}</span>
      <span class="small mut" data-mtfv="${tf}"><span class="spinner"></span></span>
    </div>`).join("");
  box.querySelectorAll("[data-mtf]").forEach((r) => r.onclick = () => {
    state.tf = r.dataset.mtf; save();
    document.querySelectorAll("#tfChips [data-tf]").forEach((x) => x.classList.toggle("on", x.dataset.tf === state.tf));
    loadChart(); paintSignals(); paintMTF();
  });
  let buy = 0, sell = 0, done = 0;
  for (const tf of tfs) {
    if (token !== mtfToken || sym !== state.sym) return;     // symbol/timeframe changed mid-flight
    try {
      const k = state.dataMode === "demo" ? demoCandles(sym, tf, 200) : await fetchKlinesSmart(sym, tf, 200);
      const rep = TA.analyze(k);
      if (rep.verdict.indexOf("BUY") >= 0) buy++;
      else if (rep.verdict.indexOf("SELL") >= 0) sell++;
      const node = box.querySelector('[data-mtfv="' + tf + '"]');
      if (node) {
        const cls = rep.verdict.indexOf("BUY") >= 0 ? "up" : rep.verdict.indexOf("SELL") >= 0 ? "dn" : "mut";
        node.innerHTML = `<span class="${cls} b">${esc(vLabel(rep.verdict))}</span>
          <span class="dim">${rep.score > 0 ? "+" : ""}${rep.score} · ${rep.confidence}%</span>`;
      }
    } catch (e) {
      const node = box.querySelector('[data-mtfv="' + tf + '"]');
      if (node) node.textContent = "—";
    }
    done++;
  }
  const note = $("mtfNote");
  if (!note || token !== mtfToken) return;
  const cons = buy > sell ? t("VERDICT.BUY") : sell > buy ? t("VERDICT.SELL") : t("VERDICT.NEUTRAL");
  const cls = buy > sell ? "up" : sell > buy ? "dn" : "mut";
  note.innerHTML = `<span class="${cls} b">${esc(t("mtf.consensus"))}: ${esc(cons)} · ${Math.max(buy, sell)}/${done}</span><br>${esc(t("mtf.note"))}`;
}

/* ============================================================================
 * RISK-BASED POSITION SIZE + PAPER STATISTICS
 * ========================================================================== */
let calcQty = 0;
function paintCalc() {
  if (!TA) return;
  if (!lastReport && state.klines && state.klines.length > 30) lastReport = TA.analyze(state.klines);
  const tk = state.tickers[state.sym] || {};
  const entry = tk.last || (lastReport && lastReport.price) || 0;
  const acct = $("calcAcct");
  if (!acct.value) acct.value = Math.round((state.settings.liveMode === "live" ? paper().bal : paperEquity()) * 100) / 100;
  const stop = $("calcStop");
  if (!stop.value) {
    // signal plan if there is one, otherwise the same 1.3 × ATR stop the engine uses
    const auto = (lastReport && lastReport.levels && lastReport.levels.sl) ||
      (lastReport && lastReport.metrics && lastReport.metrics.atr ? lastReport.price - 1.3 * lastReport.metrics.atr : null);
    if (auto && auto > 0) stop.value = auto.toFixed(6);
  }
  const account = parseFloat(acct.value) || 0;
  const riskPct = parseFloat($("calcRisk").value) || 0;
  const stopPrice = parseFloat(stop.value) || 0;
  const riskUsd = (account * riskPct) / 100;
  const perUnit = Math.abs(entry - stopPrice);
  calcQty = perUnit > 0 && riskUsd > 0 ? riskUsd / perUnit : 0;
  $("calcSize").textContent = calcQty ? fmtQty(calcQty) : "—";
  $("calcNotional").textContent = calcQty ? fmtUsd(calcQty * entry) : "—";
  $("calcRiskAmt").textContent = riskUsd ? fmtUsd(riskUsd) : "—";
  $("calcNote").textContent = calcQty
    ? (state.settings.lang === "si"
      ? `මිල ${fmtPrice(entry)} ට ගත්තොත්, ${fmtPrice(stopPrice)} ට නැවතුම් වුණොත් ඔබේ පාඩුව ≈ ${fmtUsd(riskUsd)}.`
      : `If you enter at ${fmtPrice(entry)} and stop at ${fmtPrice(stopPrice)}, your loss is about ${fmtUsd(riskUsd)}.`)
    : (entry && stopPrice ? t("calc.badStop") : t("sig.none"));
}

function paintStats() {
  const p = paper();
  const closed = p.history.filter((h) => h.pnl != null);
  const wins = closed.filter((h) => h.pnl > 0);
  const losses = closed.filter((h) => h.pnl <= 0);
  const gp = wins.reduce((s, h) => s + h.pnl, 0);
  const gl = Math.abs(losses.reduce((s, h) => s + h.pnl, 0));
  const pf = gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0);
  const expectancy = closed.length ? closed.reduce((s, h) => s + h.pnl, 0) / closed.length : 0;
  const cells = [
    [t("stats.trades"), closed.length, ""],
    [t("stats.win"), closed.length ? Math.round((wins.length / closed.length) * 100) + "%" : "—", wins.length >= losses.length ? "up" : "dn"],
    [t("stats.expect"), closed.length ? fmtUsd(expectancy) : "—", expectancy >= 0 ? "up" : "dn"],
    [t("stats.pf"), closed.length ? (pf === Infinity ? "∞" : pf.toFixed(2)) : "—", pf >= 1 ? "up" : "dn"],
  ];
  $("statsBody").innerHTML = cells.map(([k, v, c]) =>
    `<div class="metric"><div class="k">${esc(k)}</div><div class="v ${c}">${v}</div></div>`).join("");
  $("statsNote").textContent = closed.length
    ? `${wins.length}W / ${losses.length}L · ${fmtUsd(p.dayPnl)} today`
    : t("stats.none");
  // equity curve
  const cv = $("eqChart");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 300;
  cv.width = w * dpr; cv.height = 70 * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, 70);
  const eq = (p.eq && p.eq.length ? p.eq : [{ t: now(), v: 10000 }]).slice(-120);
  if (eq.length < 2) {
    ctx.fillStyle = "#5b6a86"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t("stats.none"), w / 2, 36);
    return;
  }
  const mn = Math.min.apply(null, eq.map((x) => x.v)), mx = Math.max.apply(null, eq.map((x) => x.v));
  const rx = mx - mn || 1;
  const X = (i) => 6 + (i / (eq.length - 1)) * (w - 12);
  const Y = (v) => 60 - ((v - mn) / rx) * 50;
  ctx.beginPath();
  eq.forEach((x, i) => (i ? ctx.lineTo(X(i), Y(x.v)) : ctx.moveTo(X(i), Y(x.v))));
  const up = eq[eq.length - 1].v >= eq[0].v;
  ctx.strokeStyle = up ? "#0ecb81" : "#f6465d"; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(X(eq.length - 1), 70); ctx.lineTo(X(0), 70); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, 70);
  g.addColorStop(0, up ? "rgba(14,203,129,.3)" : "rgba(246,70,93,.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = "#5b6a86"; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
  ctx.fillText(t("stats.equity"), 8, 12);
  ctx.textAlign = "right";
  ctx.fillText(fmtUsd(eq[eq.length - 1].v), w - 8, 12);
}
