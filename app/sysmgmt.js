/* ============================================================================
 * CryptoAI PRO — sysmgmt.js · REAL-TIME ACTIVITY ENGINE (මෙහෙයුම් එන්ජිම)
 * ---------------------------------------------------------------------------
 * System tab එකේ දැමෙන real-time OS-style management suite එක:
 *   1. Process Management  — engine scheduler එකේ real tasks (pause/kill/prio)
 *   2. Memory Management   — JS heap sampler + localStorage audit + cache ops
 *   3. Device Management   — battery/screen/cores/bridge + haptic + keep-awake
 *   4. File Management     — virtual FS (localStorage): exports/imports/delete
 *   5. Security Management — PIN lock (SHA-256), auto-lock, audit, panic, log
 *   6. Network Management  — live latency probes, fetch log, connection state
 *
 * සියල්ලම real — demo/fake data නෑ. Browser එකේම වැඩ කරනවා, Android WebView
 * එකේදී bridge එකෙන් (haptic, keep-screen-on, key status) extra දත්ත ගන්නවා.
 * ========================================================================== */
"use strict";

(function () {

/* ------------------------------------------------------------------ i18n -- */
Object.assign(STR.en, {
  "nav.sys": "System",
  "sys.tag": "Real-time activity engine",
  "sys.on": "RUNNING", "sys.paused": "PAUSED",
  "sys.uptime": "Uptime", "sys.ticks": "Ticks", "sys.load": "Load", "sys.procs2": "Processes",
  "sys.startall": "▶ Start all", "sys.pauseall": "⏸ Pause all", "sys.caches": "🧹 Clear caches",
  "sys.panic": "🔒 PANIC lock",
  "mod.proc": "🧩 Process Management", "mod.proc.d": "Real tasks in the engine scheduler — pause / resume / kill each one and change its priority.",
  "p.name": "Process", "p.state": "State", "p.every": "Every", "p.load": "Load", "p.ticks": "Ticks", "p.err": "Err", "p.prio": "Priority", "p.act": "Actions",
  "st.run": "running", "st.pause": "paused", "st.stop": "stopped",
  "pr.hi": "high", "pr.n": "normal", "pr.lo": "low",
  "mod.mem": "🧠 Memory Management", "mod.mem.d": "JS heap + localStorage usage — from a real-time sampler.",
  "mem.heap": "JS heap (used / limit)", "mem.stor": "localStorage", "mem.hist": "last 60 samples",
  "mem.clear": "🧹 Clear engine caches", "mem.trim": "📜 Trim logs & files",
  "mem.na": "this browser doesn't expose heap stats — storage audit still real",
  "mem.top": "Largest keys",
  "mod.dev": "📱 Device Management", "mod.dev.d": "Real device status — battery, screen, CPU cores, bridge.",
  "dev.bat": "Battery", "dev.screen": "Screen", "dev.cores": "CPU cores", "dev.ram": "Device RAM", "dev.nettype": "Network", "dev.env": "Environment",
  "dev.haptic": "📳 Haptic test", "dev.keep": "☀ Keep screen ON", "dev.keepoff": "☀ Keep screen OFF", "dev.report": "📋 Copy device report",
  "dev.charging": "charging", "dev.disch": "on battery",
  "mod.file": "🗂️ File Management", "mod.file.d": "Export / import real files from the app data — the virtual FS lives in localStorage.",
  "f.trades": "⬇ Trades CSV", "f.settings": "⬇ Settings backup", "f.log": "⬇ Activity log", "f.signal": "⬇ Signal report",
  "f.import": "⬆ Import settings", "f.none": "No files yet — create one with the export buttons above",
  "f.dl": "download", "f.del": "delete", "f.saved": "saved to virtual FS + downloaded",
  "f.imported": "Settings imported ✓", "f.bad": "invalid settings file",
  "mod.sec": "🛡️ Security Management", "mod.sec.d": "PIN lock, auto-lock, security audit + event log.",
  "sec.set": "Set PIN", "sec.change": "Change PIN", "sec.clear": "Remove PIN",
  "sec.lock": "🔒 Lock now", "sec.autolock": "Auto-lock after", "sec.never": "off",
  "sec.panic": "🚨 PANIC: lock + pause everything", "sec.audit": "Security audit", "sec.log": "Security event log",
  "sec.enter": "Enter your PIN", "sec.new": "New PIN (4–8 digits)", "sec.again": "Repeat the PIN", "sec.miss": "The PINs did not match — try again",
  "sec.wrong": "Wrong PIN", "sec.ok": "unlocked ✓", "sec.setok": "PIN set ✓",
  "a.pin": "PIN lock", "a.auto": "Auto-lock", "a.keys": "Trading keys", "a.mode": "Data mode", "a.store": "Key storage",
  "a.pin.ok": "on — the app locks", "a.pin.no": "off — set a PIN",
  "a.auto.ok": "on", "a.auto.no": "off",
  "a.keys.dev": "on-device (bridge) — the secret never reaches the web page", "a.keys.no": "no keys saved", "a.keys.web": "browser — live trading N/A",
  "a.mode.live": "live exchange data", "a.mode.demo": "simulated demo data",
  "a.store.dev": "on-device app storage", "a.store.web": "browser localStorage only",
  "mod.net": "📡 Network Management", "mod.net.d": "Exchange latency probes + request log — always real.",
  "net.conn": "Connection", "net.ws": "Stream", "net.src": "Data source", "net.reqs": "Requests",
  "net.ping": "⚡ Probe now", "net.host": "Exchange", "net.ms": "Latency", "net.last": "Last",
  "net.rlog": "Recent requests", "net.total": "total", "net.fail": "failed",
  "u.min": "min", "u.off": "off", "u.never": "—",
});

Object.assign(STR.si, {
  "nav.sys": "පද්ධතිය",
  "sys.tag": "තත්‍ය කාල මෙහෙයුම් එන්ජිම",
  "sys.on": "ධාවනය වෙමින්", "sys.paused": "විරාමයි",
  "sys.uptime": "ක්‍රියාත්මක කාලය", "sys.ticks": "ටික්", "sys.load": "භාරය", "sys.procs2": "ක්‍රියාවලි",
  "sys.startall": "▶ ඔක්කොම පටන් ගන්න", "sys.pauseall": "⏸ ඔක්කොම නවත්වන්න", "sys.caches": "🧹 හැඹිලි මකන්න",
  "sys.panic": "🔒 PANIC අගුලුව",
  "mod.proc": "🧩 ක්‍රියාවලි කළමනාකරණය", "mod.proc.d": "Engine scheduler එකේ සැබෑ tasks — pause/resume/kill, ප්‍රමුඛතා වෙනස් කිරීම.",
  "p.name": "ක්‍රියාවලිය", "p.state": "තත්‍වය", "p.every": "වාර", "p.load": "භාරය", "p.ticks": "ටික්", "p.err": "දෝෂ", "p.prio": "ප්‍රමුඛතාව", "p.act": "ක්‍රියා",
  "st.run": "ධාවනය", "st.pause": "විරාම", "st.stop": "නැවතුණු",
  "pr.hi": "ඉහළ", "pr.n": "සාමාන්‍ය", "pr.lo": "අඩු",
  "mod.mem": "🧠 මතක කළමනාකරණය", "mod.mem.d": "JS heap + localStorage භාවිතය — real-time sampler.",
  "mem.heap": "JS heap (භාවිත / සීමාව)", "mem.stor": "localStorage", "mem.hist": "අවසන් නියැදි 60",
  "mem.clear": "🧹 Engine හැඹිලි මකන්න", "mem.trim": "📜 ලොග්/ගොනු අඩු කරන්න",
  "mem.na": "මේ browser එක heap stats දෙන්නේ නෑ — storage audit එක කෙසේවත් real",
  "mem.top": "විශාලතම keys",
  "mod.dev": "📱 උපාංග කළමනාකරණය", "mod.dev.d": "උපාංගයේ සැබෑ තත්‍වය — battery, screen, CPU cores, bridge.",
  "dev.bat": "බැටරිය", "dev.screen": "තිරය", "dev.cores": "CPU cores", "dev.ram": "Device RAM", "dev.nettype": "ජාලය", "dev.env": "පරිසරය",
  "dev.haptic": "📳 වයිබ්‍රේෂන් පරීක්ෂාව", "dev.keep": "☀ තිරය ON ම තියන්න", "dev.keepoff": "☀ තිරය සාමාන්‍ය විදිහට", "dev.report": "📋 වාර්තාව copy",
  "dev.charging": "charge වෙමින්", "dev.disch": "බැටරියෙන්",
  "mod.file": "🗂️ ගොනු කළමනාකරණය", "mod.file.d": "App data එකෙන් සැබෑ ගොනු export/import — virtual FS localStorage එකේ.",
  "f.trades": "⬇ Trades CSV", "f.settings": "⬇ සැකසුම් backup", "f.log": "⬇ Activity log", "f.signal": "⬇ Signal report",
  "f.import": "⬆ සැකසුම් import", "f.none": "ගොනු නෑ — ඉහළ buttons වලින් හදන්න",
  "f.dl": "බාගන්න", "f.del": "මකන්න", "f.saved": "virtual FS එකට save වුණා + download වුණා",
  "f.imported": "සැකසුම් import වුණා ✓", "f.bad": "වැරදි settings file එකක්",
  "mod.sec": "🛡️ ආරක්ෂක කළමනාකරණය", "mod.sec.d": "PIN අගුල, auto-lock, ආරක්ෂක audit + event log.",
  "sec.set": "PIN සාදන්න", "sec.change": "PIN වෙනස් කරන්න", "sec.clear": "PIN ඉවත් කරන්න",
  "sec.lock": "🔒 දැන්ම අගුලු දමන්න", "sec.autolock": "ස්වයං-අගුලුව", "sec.never": "නෑ",
  "sec.panic": "🚨 PANIC: අගුලු දලා ඔක්කොම නවත්වන්න", "sec.audit": "ආරක්ෂක පරීක්ෂාව", "sec.log": "ආරක්ෂක සිදුවීම්",
  "sec.enter": "PIN එක දාන්න", "sec.new": "අලුත් PIN එක (4–8)", "sec.again": "නැවත PIN එක", "sec.miss": "PIN match වුණේ නෑ — ආයේ",
  "sec.wrong": "වැරදි PIN", "sec.ok": "අගුලු හැරුණා ✓", "sec.setok": "PIN set වුණා ✓",
  "a.pin": "PIN අගුල", "a.auto": "Auto-lock", "a.keys": "Trading keys", "a.mode": "Data mode", "a.store": "Key storage",
  "a.pin.ok": "ON — app එක අගුලු වෙනවා", "a.pin.no": "OFF — PIN එකක් දාන්න",
  "a.auto.ok": "ON", "a.auto.no": "OFF",
  "a.keys.dev": "device එකේ (bridge) — secret web page එකට යන්නේ නෑ", "a.keys.no": "keys save වෙලා නෑ", "a.keys.web": "browser — live trading N/A",
  "a.mode.live": "live exchange data", "a.mode.demo": "සිමියුලේටඩ් demo data",
  "a.store.dev": "device එකේ app storage", "a.store.web": "browser localStorage විතරයි",
  "mod.net": "📡 ජාල කළමනාකරණය", "mod.net.d": "Exchange latency probes + request log — හැම එකක්ම real.",
  "net.conn": "සම්බන්ධතාව", "net.ws": "Stream", "net.src": "Data source", "net.reqs": "Requests",
  "net.ping": "⚡ දැන්ම පරීක්ෂා", "net.host": "Exchange", "net.ms": "ප්‍රමාදය", "net.last": "අවසන්",
  "net.rlog": "මෑත requests", "net.total": "මුළු", "net.fail": "අසාර්ථක",
  "u.min": "විනාඩි", "u.off": "නෑ", "u.never": "—",
});

/* ---------------------------------------------------------------- helpers - */
const $id = (i) => document.getElementById(i);
const h = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtB = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(2) + " MB";
const hhmmss = (ms) => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":"); };
const fmtT = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const nowMs = () => Date.now();

/* app.js globals (same classic-script scope) — guarded access */
const app = {
  get state() { return (typeof state !== "undefined") ? state : null; },
  get t() { return (typeof t === "function") ? t : (k) => k; },
  save: () => { try { if (typeof save === "function") save(); } catch (e) {} },
  toast: (m) => { try { if (typeof toast === "function") toast(m, "", 1400); else if (typeof bc === "function") bc("toast", m); } catch (e) {} },
};
const T = (k, v) => app.t(k, v);

/* --------------------------------------------------------------- storage -- */
const P = "sysai.";
const loadJSON = (k, d) => { try { const r = localStorage.getItem(P + k); return r ? JSON.parse(r) : d; } catch (e) { return d; } };
const storeJSON = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} };

/* ============================================================ 1. ENGINE === */
const Engine = {
  upSince: nowMs(), ticks: 0, lastDur: 0, loadAvg: 0, pausedAll: false,
  procs: [],
  reg(name, icon, everyMs, fn, opts) {
    const p = { pid: 1000 + Math.floor(Math.random() * 9000), name, icon, everyMs, fn,
      state: "run", ticks: 0, errs: 0, lastMs: 0, avgMs: 0, lastRun: nowMs(), prio: 1, cpu: 0, desc: (opts && opts.desc) || "" };
    this.procs.push(p); return p;
  },
  factor(p) { return p.prio === 0 ? 2 : p.prio === 2 ? 0.5 : 1; },
  tick() {
    if (this.pausedAll) return;
    const t0 = performance.now();
    this.ticks++;
    for (const p of this.procs) {
      if (p.state !== "run") continue;
      const due = nowMs() - p.lastRun >= p.everyMs * this.factor(p);
      if (!due) continue;
      const s0 = performance.now();
      try { p.fn(p); p.ticks++; }
      catch (e) { p.errs++; try { console.warn("[sys]", p.name, e); } catch (_) {} }
      p.lastMs = performance.now() - s0;
      p.avgMs = p.avgMs ? p.avgMs * 0.8 + p.lastMs * 0.2 : p.lastMs;
      p.lastRun = nowMs();
      p.cpu = Math.round(clamp2(p.avgMs / (p.everyMs * this.factor(p))) * 100);
    }
    this.lastDur = performance.now() - t0;
    this.loadAvg = this.loadAvg * 0.9 + this.lastDur * 0.1;
  },
  byName(n) { return this.procs.find((p) => p.name === n); },
  setState(n, st) { const p = this.byName(n); if (p) { p.state = st; p.lastRun = nowMs(); } },
  setPrio(n, v) { const p = this.byName(n); if (p) p.prio = v; },
};
function clamp2(x) { return Math.min(1, Math.max(0, isFinite(x) ? x : 0)); }

/* ------------------------------------------------------------- model ------ */
const S = {
  mem: { hist: [], storTotal: 0, storTop: [], heapUsed: 0, heapLimit: 0, heapCap: 0 },
  dev: { bat: null, charging: null, netType: "—" },
  sec: Object.assign({ pin: null, salt: "", autolock: 5 }, loadJSON("sec", {})),
  log: loadJSON("log", []),
  events: [],
  net: {
    hosts: [
      { key: "binance", label: "Binance", url: "https://api.binance.com/api/v3/ping", ms: null, ok: null, hist: [] },
      { key: "bybit", label: "Bybit", url: "https://api.bybit.com/v5/market/time", ms: null, ok: null, hist: [] },
      { key: "okx", label: "OKX", url: "https://www.okx.com/api/v5/public/time", ms: null, ok: null, hist: [] },
    ],
    reqs: [], total: 0, fail: 0, online: navigator.onLine,
    probeIdx: 0,
  },
  idle: { last: nowMs() },
  files: loadJSON("fs", []),
  keepOn: false,
  signalCache: null,
};

function slog(ev, detail) {
  S.events.unshift({ ts: nowMs(), ev, detail: detail || "" });
  if (S.events.length > 120) S.events.length = 120;
  storeJSON("log", S.events);
}

/* --------------------------------------------------- 2. MEMORY MANAGEMENT - */
function storAudit() {
  let total = 0; const rows = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const bytes = (localStorage.getItem(k) || "").length * 2 + k.length * 2;
      total += bytes; rows.push([k, bytes]);
    }
  } catch (e) { /* private mode */ }
  rows.sort((a, b) => b[1] - a[1]);
  S.mem.storTotal = total;
  S.mem.storTop = rows.slice(0, 5);
}
function memSample() {
  const pm = performance.memory;
  if (pm) {
    S.mem.heapUsed = pm.usedJSHeapSize; S.mem.heapCap = pm.jsHeapSizeLimit;
    S.mem.hist.push(pm.usedJSHeapSize);
    if (S.mem.hist.length > 60) S.mem.hist.shift();
  }
}
function clearCaches() {
  S.mem.hist.length = 0;
  S.net.hosts.forEach((x) => { x.hist = []; });
  S.net.reqs = [];
  slog("cache-clear", ""); app.toast("🧹 " + T("sys.caches"));
  paintIfVisible();
}
function trimAll() {
  S.log = loadJSON("log", []); S.log.length = Math.min(S.log.length, 40); storeJSON("log", S.log);
  if (S.files.length > 20) S.files.length = 20; storeJSON("fs", S.files);
  slog("trim", ""); app.toast("📜 " + T("mem.trim")); paintIfVisible();
}

/* ---------------------------------------------------- 3. DEVICE MANAGEMENT */
async function devPoll() {
  try {
    if (navigator.getBattery && !S.dev.batPromise) {
      S.dev.batPromise = navigator.getBattery().then((b) => {
        S.dev.bat = b; const up = () => paintIfVisible();
        b.addEventListener("levelchange", up); b.addEventListener("chargingchange", up);
        return b;
      }).catch(() => null);
    }
    if (S.dev.bat) { S.dev.batLevel = S.dev.bat.level; S.dev.charging = S.dev.bat.charging; }
  } catch (e) {}
  try {
    const c = navigator.connection || navigator.mozConnection;
    if (c && c.effectiveType) S.dev.netType = c.effectiveType + (c.downlink ? " · " + c.downlink + "Mb" : "");
  } catch (e) {}
}

/* --------------------------------------------------- 4. SECURITY MANAGEMENT */
async function sha256(txt) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch (e) { /* subtle unavailable (insecure ctx) — FNV fallback */
    let hv = 0x811c9dc5;
    for (let i = 0; i < txt.length; i++) { hv ^= txt.charCodeAt(i); hv = (hv * 0x01000193) >>> 0; }
    return "f" + hv.toString(16);
  }
}
async function setPinFlow() {
  const a = await askPin(T("sec.new")); if (a == null) return;
  const b = await askPin(T("sec.again")); if (b == null) return;
  if (a !== b) { app.toast("❌ " + T("sec.miss")); return; }
  S.sec.salt = Math.random().toString(36).slice(2, 10);
  S.sec.pin = await sha256(S.sec.salt + a);
  storeJSON("sec", S.sec); slog("pin-set", "");
  app.toast("🔑 " + T("sec.setok")); paintSec();
}
async function clearPin() {
  if (!S.sec.pin) return;
  const a = await askPin(T("sec.enter")); if (a == null) return;
  if ((await sha256(S.sec.salt + a)) !== S.sec.pin) { app.toast("❌ " + T("sec.wrong")); return; }
  S.sec.pin = null; storeJSON("sec", S.sec); slog("pin-clear", ""); paintSec();
}
function locked() { return !!S.sec.pin && S.lockOn; }
S.lockOn = false;

/* ---- lock overlay + numpad ---- */
let pinBuf = "", pinResolve = null, unlockMode = false;
function ensureLockUI() {
  if ($id("smLock")) return;
  const ov = h("div"); ov.id = "smLock"; ov.className = "sm-lock";
  ov.innerHTML =
    '<div class="sm-lockcard"><div style="font-size:34px">🔒</div><div class="sm-lockt" id="smLockT"></div>' +
    '<div class="sm-pindots" id="smPinDots"></div><div class="sm-pad" id="smPad"></div>' +
    '<div class="hint" id="smLockHint" style="margin-top:10px">CryptoAI PRO · ' + esc2("SHA-256") + '</div></div>';
  document.body.appendChild(ov);
  const pad = $id("smPad");
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "✓"].forEach((k) => {
    const b = h("button", "sm-key", k);
    b.onclick = () => padKey(k);
    pad.appendChild(b);
  });
  drawDots();
}
function drawDots() {
  const d = $id("smPinDots"); if (!d) return;
  d.innerHTML = Array.from({ length: Math.max(4, pinBuf.length) }, (_, i) =>
    '<i class="' + (i < pinBuf.length ? "on" : "") + '"></i>').join("");
}
function padKey(k) {
  if (k === "C") { pinBuf = ""; drawDots(); return; }
  if (k === "✓") { submitPin(); return; }
  if (pinBuf.length < 8) { pinBuf += k; drawDots(); haptic(12); }
  if (pinBuf.length >= 4 && pinBuf.length % 1 === 0) { /* submit manually with ✓ */ }
}
async function submitPin() {
  const val = pinBuf; pinBuf = ""; drawDots();
  if (val.length < 4) return;
  if (pinResolve) { const r = pinResolve; pinResolve = null; $id("smLock").classList.remove("on"); r(val); return; }
  if ((await sha256(S.sec.salt + val)) === S.sec.pin) {
    S.lockOn = false; $id("smLock").classList.remove("on"); S.idle.last = nowMs();
    slog("unlock-ok", ""); app.toast("🔓 " + T("sec.ok")); haptic(30); paintSec();
  } else {
    slog("unlock-fail", ""); app.toast("❌ " + T("sec.wrong")); haptic([60, 40, 60]);
    $id("smLockT").textContent = "❌ " + T("sec.wrong");
    setTimeout(() => { const n = $id("smLockT"); if (n && !S.lockOn) n.textContent = ""; }, 1200);
  }
}
function askPin(title) {
  return new Promise((res) => {
    ensureLockUI();
    pinResolve = res; pinBuf = ""; drawDots();
    $id("smLockT").textContent = title;
    $id("smLock").classList.add("on");
  });
}
function lockNow() {
  if (!S.sec.pin) { app.toast("🔑 " + T("a.pin.no")); return; }
  ensureLockUI(); unlockMode = true; pinBuf = ""; drawDots();
  $id("smLockT").textContent = T("sec.enter");
  $id("smLock").classList.add("on");
  slog("lock", ""); haptic(25); paintSec();
}
function panic() {
  Engine.procs.forEach((p) => { if (p.state === "run" && p.name !== "heartbeat") p.state = "pause"; });
  Engine.pausedAll = false;
  slog("panic", "");
  /* v50: PANIC stops the trading bot too — it used to pause only these monitor tasks
     while the bot kept opening trades. Open bot trades go to the watchdog (profit exits only). */
  try { if (typeof state !== "undefined" && state.bot && state.bot.running && typeof botStop === "function") botStop(); } catch (e) {}
  try { if (typeof bc === "function" && bc("isAutoOn") === true) bc("setAutoOn", false); } catch (e) {}
  lockNow();
  paintIfVisible();
}
function haptic(ms) {
  try { if (typeof bc === "function" && bc("haptic", ms)) return; } catch (e) {}
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
}
["pointerdown", "keydown", "touchstart"].forEach((ev) =>
  window.addEventListener(ev, () => { S.idle.last = nowMs(); }, { passive: true }));
function secWatch() {
  if (S.sec.pin && S.sec.autolock > 0 && !S.lockOn) {
    if (nowMs() - S.idle.last > S.sec.autolock * 60000) lockNow();
  }
}
function auditRows() {
  const st = app.state;
  const keysDev = (typeof bc === "function") && (bc("binanceHasKeys") || bc("bybitHasKeys")) ? true : false;
  const isAndroid = (typeof hasBridge === "function") && hasBridge();
  return [
    [T("a.pin"), S.sec.pin ? [1, T("a.pin.ok")] : [0, T("a.pin.no")]],
    [T("a.auto"), S.sec.autolock > 0 ? [1, T("a.auto.ok") + " · " + S.sec.autolock + " " + T("u.min")] : [0, T("a.auto.no")]],
    [T("a.keys"), keysDev ? [1, T("a.keys.dev")] : isAndroid ? [1, T("a.keys.no")] : [2, T("a.keys.web")]],
    [T("a.mode"), st && st.dataMode === "live" ? [1, T("a.mode.live")] : [2, T("a.mode.demo")]],
    [T("a.store"), isAndroid ? [1, T("a.store.dev")] : [2, T("a.store.web")]],
  ];
}

/* ----------------------------------------------------- 5. FILE MANAGEMENT - */
function download(name, content, mime) {
  try {
    const blob = new Blob([content], { type: mime || "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  } catch (e) {}
}
function fsAdd(folder, name, content) {
  const f = { id: Math.random().toString(36).slice(2, 9), folder, name, ts: nowMs(), bytes: content.length * 2, content };
  S.files.unshift(f); if (S.files.length > 24) S.files.length = 24;
  storeJSON("fs", S.files); slog("file-export", name); paintFiles();
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

function expTrades() {
  const st = app.state; if (!st || !st.paper) return;
  const rows = [["#", "time", "symbol", "side", "qty", "price", "pnl", "reason"]];
  (st.paper.history || []).forEach((x, i) => {
    rows.push([i + 1, new Date(x.t || x.ts || nowMs()).toISOString(), x.sym || x.symbol || "", x.side || "", x.qty != null ? x.qty : "", x.price != null ? x.price : "", x.pnl != null ? x.pnl : "", x.reason || x.why || ""]);
  });
  const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const name = "trades-" + stamp() + ".csv";
  fsAdd("/trades", name, csv); download(name, csv, "text/csv");
  app.toast("📄 " + T("f.saved"));
}
function expSettings() {
  const st = app.state; if (!st) return;
  const snap = { settings: st.settings, favs: st.favs, sym: st.sym, tf: st.tf, sort: st.sort, paper: st.paper, bot: typeof botCfg === "function" ? botCfg() : null, alerts: st.alerts, chartInd: st.chartInd, _by: "CryptoAI PRO sysmgmt", _ts: nowMs() };
  const j = JSON.stringify(snap, null, 1);
  const name = "settings-" + stamp() + ".json";
  fsAdd("/settings", name, j); download(name, j, "application/json");
  app.toast("📄 " + T("f.saved"));
}
function expLog() {
  const lines = loadJSON("log", []).map((e) => fmtT(e.ts) + "  " + e.ev + (e.detail ? "  " + e.detail : ""));
  const name = "activity-" + stamp() + ".txt";
  fsAdd("/logs", name, lines.join("\n")); download(name, lines.join("\n"), "text/plain");
  app.toast("📄 " + T("f.saved"));
}
function expSignal() {
  const st = app.state; if (!st) return;
  let rep = "CryptoAI PRO — signal report " + new Date().toISOString() + "\n" +
    "symbol: " + st.sym + "  tf: " + st.tf + "  mode: " + (st.dataMode || "?") + "\n";
  try {
    if (typeof lastReport !== "undefined" && lastReport) {
      rep += "verdict: " + (lastReport.verdict || "?") + "  conf: " + (lastReport.conf != null ? Math.round(lastReport.conf) + "%" : "?") + "\n";
      (lastReport.reasons || []).slice(0, 10).forEach((r) => { rep += " • " + r + "\n"; });
    } else { rep += "(open a chart first — then generate the report from the Signal tab)\n"; }
  } catch (e) {}
  const name = "signal-" + (st.sym || "x") + "-" + stamp() + ".txt";
  fsAdd("/reports", name, rep); download(name, rep, "text/plain");
  app.toast("📄 " + T("f.saved"));
}
function importSettings(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const s = JSON.parse(rd.result); const st = app.state; if (!st) throw 0;
      if (s.settings) Object.assign(st.settings, s.settings);
      if (s.favs) st.favs = s.favs;
      if (s.sym) st.sym = s.sym;
      if (s.tf) st.tf = s.tf;
      if (s.paper) st.paper = s.paper;
      if (s.alerts) st.alerts = s.alerts;
      if (s.bot) st.botCfg = s.bot;
      app.save();
      try { if (typeof renderAll === "function") renderAll(); } catch (e) {}
      slog("import", file.name); app.toast("✅ " + T("f.imported"));
    } catch (e) { app.toast("❌ " + T("f.bad")); }
  };
  rd.readAsText(file);
}

/* ---------------------------------------------------- 6. NETWORK MANAGEMENT */
function wrapFetch() {
  if (window.__smFetchWrapped) return;
  if (typeof window.fetch !== "function") return; /* very old WebView — skip */
  window.__smFetchWrapped = true;
  const of = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const t0 = performance.now();
    let url = ""; try { url = (typeof input === "string") ? input : (input && input.url) || ""; } catch (e) {}
    let rec;
    try {
      const r = await of(input, init);
      rec = { t: nowMs(), m: (init && init.method) || "GET", u: url, ms: Math.round(performance.now() - t0), s: r.status };
      if (r.ok) S.net.total++; else { S.net.total++; S.net.fail++; }
      pushReq(rec); return r;
    } catch (e) {
      rec = { t: nowMs(), m: (init && init.method) || "GET", u: url, ms: Math.round(performance.now() - t0), s: 0 };
      S.net.total++; S.net.fail++; pushReq(rec); throw e;
    }
  };
}
function pushReq(r) { S.net.reqs.unshift(r); if (S.net.reqs.length > 14) S.net.reqs.length = 14; }
window.addEventListener("online", () => { S.net.online = true; slog("net-online", ""); paintIfVisible(); });
window.addEventListener("offline", () => { S.net.online = false; slog("net-offline", ""); paintIfVisible(); });

async function probe(host) {
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 4000);
    await fetch(host.url, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(to);
    host.ms = Math.round(performance.now() - t0); host.ok = true;
  } catch (e) { host.ms = null; host.ok = false; }
  host.hist.push(host.ms == null ? -1 : host.ms);
  if (host.hist.length > 20) host.hist.shift();
}
function probeAll() { S.net.hosts.forEach((x) => probe(x)); }
function probeNext() { const x = S.net.hosts[S.net.probeIdx % S.net.hosts.length]; S.net.probeIdx++; probe(x); }

/* ------------------------------------------------- real engine processes -- */
function signalRefresh() {
  const st = app.state; if (!st) return;
  const k = st.klines;
  if (!k || !k.length || typeof TA === "undefined" || !TA) { S.signalCache = null; return; }
  try {
    const closes = k.map((c) => c.c);
    const ema20 = TA.ema(closes, 20), ema50 = TA.ema(closes, 50);
    const rsi = TA.rsi(closes, 14);
    const e20 = ema20[ema20.length - 1], e50 = ema50[ema50.length - 1];
    S.signalCache = {
      sym: st.sym, tf: st.tf,
      trend: e20 > e50 ? "▲" : "▼",
      rsi: rsi && rsi.length ? rsi[rsi.length - 1] : null,
      px: closes[closes.length - 1], at: nowMs(),
    };
  } catch (e) { S.signalCache = null; }
}
function botWatch() {
  const st = app.state; if (!st) return;
  const n = st.paper && st.paper.positions ? st.paper.positions.length : 0;
  const auto = (typeof bc === "function") ? bc("isAutoOn") : null;
  const sig2 = (n + "|" + (auto ? 1 : 0));
  if (S._botSig !== sig2) {
    if (S._botSig !== undefined) slog("bot-change", sig2);
    S._botSig = sig2;
  }
}
function marketGuard() {
  const st = app.state; if (!st) return;
  const sig2 = (st.dataMode || "?") + "|" + (st.dataSource || "?");
  if (S._mktSig !== sig2) { if (S._mktSig !== undefined) slog("data", sig2); S._mktSig = sig2; }
}

/* ================================================================= UI ===== */
let built = false;

function buildDOM() {
  if (built) return; built = true;
  const sec = $id("t-sys"); if (!sec) return;

  /* engine header */
  const head = h("div", "card sm-head");
  head.innerHTML =
    '<div class="row between"><div><h3 style="margin:0">⚙️ ' + esc2("CryptoAI PRO") + ' <span class="sm-chip sm-live" id="smState">' + T("sys.on") + '</span></h3>' +
    '<div class="small mut">' + T("sys.tag") + '</div></div>' +
    '<div class="row" style="gap:6px"><button class="btn ghost sm" id="smStartAll">' + T("sys.startall") + '</button>' +
    '<button class="btn ghost sm" id="smPauseAll">' + T("sys.pauseall") + '</button>' +
    '<button class="btn ghost sm" id="smPanicT">' + T("sys.panic") + '</button></div></div>' +
    '<div class="grid3 sm-stats mt" id="smStats"></div>';
  sec.appendChild(head);

  /* process management */
  const pc = h("div", "card sm-procs-card");      /* v50: class — spans the desktop columns */
  pc.innerHTML = '<h3>' + T("mod.proc") + '</h3><div class="hint">' + T("mod.proc.d") + '</div><div id="smProcs" class="mt"></div>';
  sec.appendChild(pc);

  /* memory */
  const mc = h("div", "card");
  mc.innerHTML =
    '<h3>' + T("mod.mem") + '</h3><div class="hint">' + T("mod.mem.d") + '</div>' +
    '<div class="grid3 sm-stats mt" id="smMemStats"></div>' +
    '<div class="mt"><div class="small mut">' + T("mem.hist") + '</div><canvas id="smSpark" width="600" height="90" class="sm-spark"></canvas></div>' +
    '<div class="mt"><div class="small mut">' + T("mem.top") + '</div><div id="smStorTop" class="mt"></div></div>' +
    '<div class="row mt" style="gap:6px"><button class="btn ghost sm" id="smClearC">' + T("mem.clear") + '</button>' +
    '<button class="btn ghost sm" id="smTrim">' + T("mem.trim") + '</button></div>' +
    '<div class="hint mt" id="smMemNote" style="display:none">' + T("mem.na") + '</div>';
  sec.appendChild(mc);

  /* device */
  const dc = h("div", "card");
  dc.innerHTML =
    '<h3>' + T("mod.dev") + '</h3><div class="hint">' + T("mod.dev.d") + '</div>' +
    '<div class="grid3 sm-stats mt" id="smDev"></div>' +
    '<div class="row mt" style="gap:6px"><button class="btn ghost sm" id="smHaptic">' + T("dev.haptic") + '</button>' +
    '<button class="btn ghost sm" id="smKeep">' + T("dev.keep") + '</button>' +
    '<button class="btn ghost sm" id="smReport">' + T("dev.report") + '</button></div>';
  sec.appendChild(dc);

  /* files */
  const fc = h("div", "card");
  fc.innerHTML =
    '<h3>' + T("mod.file") + '</h3><div class="hint">' + T("mod.file.d") + '</div>' +
    '<div class="row mt" style="gap:6px;flex-wrap:wrap">' +
    '<button class="btn ghost sm" id="smFT">' + T("f.trades") + '</button>' +
    '<button class="btn ghost sm" id="smFS">' + T("f.settings") + '</button>' +
    '<button class="btn ghost sm" id="smFL">' + T("f.log") + '</button>' +
    '<button class="btn ghost sm" id="smFR">' + T("f.signal") + '</button>' +
    '<label class="btn ghost sm" style="cursor:pointer">' + T("f.import") +
    '<input type="file" id="smImp" accept="application/json,.json" style="display:none"></label></div>' +
    '<div id="smFiles" class="mt"></div>';
  sec.appendChild(fc);

  /* security */
  const sc = h("div", "card");
  sc.innerHTML =
    '<h3>' + T("mod.sec") + '</h3><div class="hint">' + T("mod.sec.d") + '</div>' +
    '<div class="row mt" style="gap:6px;flex-wrap:wrap">' +
    '<button class="btn ghost sm" id="smPinSet">' + T("sec.set") + '</button>' +
    '<button class="btn ghost sm" id="smPinClr">' + T("sec.clear") + '</button>' +
    '<button class="btn ghost sm" id="smLockBtn">' + T("sec.lock") + '</button>' +
    '<button class="btn ghost sm" id="smPanic2">' + T("sec.panic") + '</button></div>' +
    '<div class="row mt between"><span class="small mut">' + T("sec.autolock") + '</span>' +
    '<select id="smAuto" class="sm-sel"><option value="0">' + T("sec.never") + '</option><option value="1">1 ' + T("u.min") + '</option><option value="5">5 ' + T("u.min") + '</option><option value="15">15 ' + T("u.min") + '</option></select></div>' +
    '<div class="mt"><div class="small mut">' + T("sec.audit") + '</div><div id="smAudit" class="mt"></div></div>' +
    '<div class="mt"><div class="small mut">' + T("sec.log") + '</div><div id="smSecLog" class="mt sm-log"></div></div>';
  sec.appendChild(sc);

  /* network */
  const nc = h("div", "card");
  nc.innerHTML =
    '<h3>' + T("mod.net") + '</h3><div class="hint">' + T("mod.net.d") + '</div>' +
    '<div class="grid3 sm-stats mt" id="smNetStats"></div>' +
    '<div class="row mt between"><span class="small mut">' + T("net.ping") + '</span>' +
    '<button class="btn ghost sm" id="smProbe">' + T("net.ping") + '</button></div>' +
    '<div id="smProbes" class="mt"></div>' +
    '<div class="mt"><div class="small mut">' + T("net.rlog") + ' — <span id="smReqTot"></span></div><div id="smReqLog" class="mt"></div></div>';
  sec.appendChild(nc);

  /* wire buttons */
  $id("smStartAll").onclick = () => { Engine.pausedAll = false; Engine.procs.forEach((p) => { if (p.state !== "run") { p.state = "run"; p.lastRun = nowMs(); } }); slog("start-all", ""); paintIfVisible(); };
  $id("smPauseAll").onclick = () => { Engine.procs.forEach((p) => { if (p.state === "run") p.state = "pause"; }); slog("pause-all", ""); paintIfVisible(); };
  $id("smPanicT").onclick = panic;
  $id("smPanic2").onclick = panic;
  $id("smClearC").onclick = clearCaches;
  $id("smTrim").onclick = trimAll;
  $id("smHaptic").onclick = () => haptic([80, 40, 80]);
  $id("smKeep").onclick = () => {
    S.keepOn = !S.keepOn;
    try { if (typeof bc === "function") bc("setKeepScreenOn", S.keepOn); } catch (e) {}
    try { if (navigator.wakeLock && S.keepOn) navigator.wakeLock.request("screen").then((l) => { S._wl = l; }).catch(() => {}); else if (S._wl) { S._wl.release(); S._wl = null; } } catch (e) {}
    $id("smKeep").textContent = S.keepOn ? T("dev.keepoff") : T("dev.keep");
    slog("keep-on", S.keepOn ? "1" : "0");
  };
  $id("smReport").onclick = copyReport;
  $id("smFT").onclick = expTrades;
  $id("smFS").onclick = expSettings;
  $id("smFL").onclick = expLog;
  $id("smFR").onclick = expSignal;
  $id("smImp").onchange = (e) => { if (e.target.files && e.target.files[0]) importSettings(e.target.files[0]); e.target.value = ""; };
  $id("smPinSet").onclick = setPinFlow;
  $id("smPinClr").onclick = clearPin;
  $id("smLockBtn").onclick = lockNow;
  $id("smAuto").value = String(S.sec.autolock);
  $id("smAuto").onchange = (e) => { S.sec.autolock = +e.target.value; storeJSON("sec", S.sec); slog("autolock", e.target.value); paintSec(); };
  $id("smProbe").onclick = () => { probeAll(); paintNet(); };

  paintAll();
}

async function copyReport() {
  const d = [];
  d.push("CryptoAI PRO — device report " + new Date().toISOString());
  d.push("env: " + ((typeof hasBridge === "function" && hasBridge()) ? "Android WebView (bridge " + (bc("version") || "?") + ")" : "browser"));
  d.push("ua: " + navigator.userAgent);
  d.push("screen: " + screen.width + "x" + screen.height + " @" + (window.devicePixelRatio || 1));
  d.push("cores: " + (navigator.hardwareConcurrency || "?") + "  ram: " + (navigator.deviceMemory || "?") + "GB");
  d.push("lang/tz: " + navigator.language + " / " + (Intl.DateTimeFormat().resolvedOptions().timeZone || "?"));
  if (S.dev.batLevel != null) d.push("battery: " + Math.round(S.dev.batLevel * 100) + "% " + (S.dev.charging ? "charging" : ""));
  d.push("net: " + S.net.online + " " + S.dev.netType);
  S.net.hosts.forEach((x) => d.push("ping " + x.label + ": " + (x.ms == null ? "fail" : x.ms + "ms")));
  d.push("storage: " + fmtB(S.mem.storTotal) + "  heap: " + (S.mem.heapUsed ? fmtB(S.mem.heapUsed) : "n/a"));
  const txt = d.join("\n");
  try { await navigator.clipboard.writeText(txt); app.toast("📋 ✓"); }
  catch (e) { download("device-report.txt", txt); app.toast("📄 " + T("f.saved")); }
}

/* -------------------------------------------------------------- painters -- */
function paintIfVisible() {
  const on = $id("t-sys") && $id("t-sys").classList.contains("on");
  if (on) paintAll();
}
let lastPaint = 0;
function paintAll(force) {
  if (!built) return;
  const tNow = nowMs();
  if (!force && tNow - lastPaint < 900) return;
  lastPaint = tNow;
  paintHead(); paintProcs(); paintMem(); paintDev(); paintFiles(); paintSec(); paintNet();
}

function paintHead() {
  const stEl = $id("smState"); if (!stEl) return;
  const running = Engine.procs.filter((p) => p.state === "run").length;
  stEl.textContent = Engine.pausedAll || !running ? T("sys.paused") : T("sys.on");
  stEl.className = "sm-chip " + (Engine.pausedAll || !running ? "sm-warn" : "sm-live");
  const load = Math.round(clamp2(Engine.loadAvg / 8) * 100);
  const stats = [
    [T("sys.uptime"), hhmmss(nowMs() - Engine.upSince)],
    [T("sys.ticks"), String(Engine.ticks)],
    [T("sys.load"), load + "%"],
    [T("sys.procs2"), running + "/" + Engine.procs.length],
  ];
  $id("smStats").innerHTML = stats.map((s) => '<div class="sm-stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>').join("");
}

function paintProcs() {
  const box = $id("smProcs"); if (!box) return;
  box.innerHTML = Engine.procs.map((p) => {
    const stCls = p.state === "run" ? "sm-live" : p.state === "pause" ? "sm-warn" : "sm-off";
    return '<div class="sm-prow">' +
      '<div class="sm-pname"><i>' + p.icon + '</i><div><b>' + esc2(p.name) + '</b>' +
      '<span class="small mut">#' + p.pid + ' · ' + Math.round(p.everyMs / 1000) + 's' + (p.errs ? ' · <span style="color:var(--down)">' + p.errs + ' err</span>' : '') + '</span></div></div>' +
      '<span class="sm-chip ' + stCls + '">' + T("st." + (p.state === "run" ? "run" : p.state === "pause" ? "pause" : "stop")) + '</span>' +
      '<div class="sm-gauge"><i style="width:' + clamp2(p.cpu / 100) * 100 + '%"></i></div><span class="small mut sm-cpu">' + p.cpu + '%</span>' +
      '<span class="small mut">' + p.ticks + '</span>' +
      '<select class="sm-sel" data-pr="' + p.name + '">' +
        [0, 1, 2].map((v) => '<option value="' + v + '"' + (p.prio === v ? " selected" : "") + '>' + T(v === 0 ? "pr.lo" : v === 1 ? "pr.n" : "pr.hi") + '</option>').join("") +
      '</select>' +
      '<div class="sm-act">' +
        '<button data-run="' + esc2(p.name) + '" title="run">' + (p.state === "run" ? "⏸" : "▶") + '</button>' +
        '<button data-kill="' + esc2(p.name) + '" title="kill">✕</button>' +
        '<button data-res="' + esc2(p.name) + '" title="restart">⟳</button>' +
      '</div></div>';
  }).join("");
  box.querySelectorAll("[data-run]").forEach((b) => { b.onclick = () => { const p = Engine.byName(b.dataset.run); if (!p) return; p.state = p.state === "run" ? "pause" : "run"; p.lastRun = nowMs(); paintProcs(); paintHead(); }; });
  box.querySelectorAll("[data-kill]").forEach((b) => { b.onclick = () => { const p = Engine.byName(b.dataset.kill); if (!p) return; p.state = "stop"; slog("kill", p.name); paintProcs(); paintHead(); }; });
  box.querySelectorAll("[data-res]").forEach((b) => { b.onclick = () => { const p = Engine.byName(b.dataset.res); if (!p) return; p.state = "run"; p.errs = 0; p.ticks = 0; p.lastRun = nowMs(); paintProcs(); paintHead(); }; });
  box.querySelectorAll("[data-pr]").forEach((s2) => { s2.onchange = () => Engine.setPrio(s2.dataset.pr, +s2.value); });
}

function paintMem() {
  const box = $id("smMemStats"); if (!box) return;
  const pmOK = !!performance.memory;
  $id("smMemNote").style.display = pmOK ? "none" : "block";
  const rows = [
    [T("mem.heap"), pmOK ? fmtB(S.mem.heapUsed) + " / " + fmtB(S.mem.heapCap) : "n/a"],
    [T("mem.stor"), fmtB(S.mem.storTotal)],
    [T("mem.hist"), S.mem.hist.length + " · " + (pmOK && S.mem.hist.length ? fmtB(Math.max.apply(null, S.mem.hist)) : "—")],
  ];
  box.innerHTML = rows.map((s) => '<div class="sm-stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>').join("");
  $id("smStorTop").innerHTML = S.mem.storTop.map((r) =>
    '<div class="sm-kv"><span>' + esc2(r[0].length > 26 ? r[0].slice(0, 24) + "…" : r[0]) + '</span><b>' + fmtB(r[1]) + '</b></div>').join("");
  /* sparkline */
  const cv = $id("smSpark"); if (cv && pmOK && S.mem.hist.length > 1) {
    const ctx = cv.getContext("2d"), w = cv.width, ht = cv.height;
    ctx.clearRect(0, 0, w, ht);
    const mx = Math.max.apply(null, S.mem.hist) * 1.15 || 1;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--up") || "#22c55e";
    ctx.lineWidth = 2; ctx.beginPath();
    S.mem.hist.forEach((v, i) => {
      const x = (i / (S.mem.hist.length - 1)) * (w - 8) + 4;
      const y = ht - 6 - (v / mx) * (ht - 14);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  } else if (cv) {
    const ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
  }
}

function paintDev() {
  const box = $id("smDev"); if (!box) return;
  const isAndroid = (typeof hasBridge === "function") && hasBridge();
  const bat = S.dev.batLevel != null ? Math.round(S.dev.batLevel * 100) + "% · " + (S.dev.charging ? T("dev.charging") : T("dev.disch")) : "—";
  const rows = [
    [T("dev.bat"), bat],
    [T("dev.screen"), screen.width + "×" + screen.height + " @" + (window.devicePixelRatio || 1)],
    [T("dev.cores"), String(navigator.hardwareConcurrency || "—")],
    [T("dev.ram"), navigator.deviceMemory ? navigator.deviceMemory + " GB" : "—"],
    [T("dev.nettype"), S.dev.netType],
    [T("dev.env"), isAndroid ? "Android · bridge " + (bc("version") || "") : "Browser"],
  ];
  box.innerHTML = rows.map((s) => '<div class="sm-stat"><b>' + esc2(s[1]) + '</b><span>' + s[0] + '</span></div>').join("");
}

function paintFiles() {
  const box = $id("smFiles"); if (!box) return;
  if (!S.files.length) { box.innerHTML = '<div class="hint">' + T("f.none") + '</div>'; return; }
  box.innerHTML = S.files.map((f) =>
    '<div class="sm-kv" data-fid="' + f.id + '"><span>📄 ' + esc2(f.name) +
    ' <span class="mut small">' + f.folder + ' · ' + fmtB(f.bytes) + ' · ' + fmtT(f.ts) + '</span></span>' +
    '<span class="sm-act"><button data-dl="' + f.id + '">⬇</button><button data-rm="' + f.id + '">🗑</button></span></div>').join("");
  box.querySelectorAll("[data-dl]").forEach((b) => { b.onclick = () => {
    const f = S.files.find((x) => x.id === b.dataset.dl); if (!f) return;
    download(f.name, f.content); slog("file-dl", f.name);
  }; });
  box.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = () => {
    S.files = S.files.filter((x) => x.id !== b.dataset.rm); storeJSON("fs", S.files); paintFiles();
  }; });
}

function paintSec() {
  const box = $id("smAudit"); if (!box) return;
  box.innerHTML = auditRows().map((r) => {
    const v = r[1], cls = v[0] === 1 ? "sm-ok" : v[0] === 0 ? "sm-bad" : "sm-mid";
    return '<div class="sm-kv"><span>' + r[0] + '</span><b class="' + cls + '">' + v[0] + " · " + esc2(v[1]) + '</b></div>';
  }).join("");
  $id("smSecLog").innerHTML = S.events.slice(0, 8).map((e) =>
    '<div class="sm-kv"><span class="mut small">' + fmtT(e.ts) + ' · ' + esc2(e.ev) + (e.detail ? " · " + esc2(e.detail) : "") + '</span></div>').join("") ||
    '<div class="hint">—</div>';
  const ps = $id("smPinSet"); if (ps) ps.textContent = S.sec.pin ? T("sec.change") : T("sec.set");
}

function paintNet() {
  const box = $id("smNetStats"); if (!box) return;
  const st = app.state;
  const rows = [
    [T("net.conn"), (S.net.online ? "🟢 online" : "🔴 offline") + " · " + S.dev.netType],
    [T("net.src"), st ? String(st.dataSource || st.dataMode || "—") : "—"],
    [T("net.reqs"), S.net.total + " · " + S.net.fail + " " + T("net.fail")],
  ];
  box.innerHTML = rows.map((s) => '<div class="sm-stat"><b>' + esc2(s[1]) + '</b><span>' + s[0] + '</span></div>').join("");
  $id("smProbes").innerHTML = S.net.hosts.map((x) => {
    const cls = x.ok === true ? "sm-ok" : x.ok === false ? "sm-bad" : "sm-mid";
    const hist = x.hist.length ? x.hist.slice(-10).map((v) => '<i style="height:' + (v < 0 ? 4 : Math.min(26, v / 4)) + 'px" class="' + (v < 0 ? "bad" : "") + '"></i>').join("") : "";
    return '<div class="sm-kv"><span><b class="' + cls + '">●</b> ' + x.label + '</span>' +
      '<span class="sm-hist">' + hist + '</span><b>' + (x.ms == null ? (x.ok === false ? "✕" : "—") : x.ms + " ms") + '</b></div>';
  }).join("");
  $id("smReqTot").textContent = S.net.total + " " + T("net.total");
  $id("smReqLog").innerHTML = S.net.reqs.slice(0, 8).map((r) => {
    const u = r.u.replace(/^https?:\/\//, "");
    const cls = r.s >= 200 && r.s < 400 ? "sm-ok" : r.s === 0 ? "sm-bad" : "sm-mid";
    return '<div class="sm-kv"><span class="small">' + esc2(u.length > 42 ? u.slice(0, 40) + "…" : u) + '</span>' +
      '<b class="' + cls + ' small">' + (r.s || "✕") + ' · ' + r.ms + 'ms</b></div>';
  }).join("") || '<div class="hint">—</div>';
}

/* --------------------------------------------------------------- re-i18n -- */
function repaintLang() { paintAll(true); }
document.addEventListener("click", (e) => {
  if (e.target && e.target.id === "langBtn") setTimeout(repaintLang, 30);
}, true);

/* --------------------------------------------------------- engine procs -- */
function registerProcs() {
  Engine.reg("heartbeat", "🔥", 2000, () => { /* supervisor housekeeping */ }, { desc: "supervisor" });
  Engine.reg("mem-sampler", "🧠", 2000, () => { memSample(); if (Engine.ticks % 5 === 0) storAudit(); }, { desc: "heap+storage" });
  Engine.reg("net-probe", "📡", 8000, () => { probeNext(); }, { desc: "latency" });
  Engine.reg("device-poll", "📱", 15000, () => { devPoll(); }, { desc: "battery/net" });
  Engine.reg("security-watch", "🛡️", 10000, () => { secWatch(); }, { desc: "autolock" });
  Engine.reg("log-keeper", "📜", 45000, () => { if (S.events.length > 120) { S.events.length = 100; storeJSON("log", S.events); } }, { desc: "rotate" });
  Engine.reg("market-guard", "📊", 5000, () => { marketGuard(); }, { desc: "data source" });
  Engine.reg("signal-refresh", "🎯", 25000, () => { signalRefresh(); }, { desc: "TA on klines" });
  Engine.reg("bot-watcher", "🤖", 15000, () => { botWatch(); }, { desc: "bot state" });
}

/* ------------------------------------------------------------------ boot -- */
function boot() {
  try { memSample(); } catch (e) {}
  storAudit(); devPoll(); wrapFetch();
  registerProcs();
  buildDOM();
  slog("engine-boot", (typeof hasBridge === "function" && hasBridge()) ? "android" : "browser");

  /* supervisor — 1 Hz real-time tick */
  setInterval(() => {
    Engine.tick();
    const vis = $id("t-sys") && $id("t-sys").classList.contains("on");
    if (vis && nowMs() - lastPaint > 2000) paintAll();
  }, 1000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 0));
else setTimeout(boot, 0);

/* switchTab hook — app.js calls window.SysMgmt.onShow("sys") */
window.SysMgmt = {
  onShow() { if (!built) boot(); paintAll(true); },
};

})();
