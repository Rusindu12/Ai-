/* v49: web 24/7 heartbeat — timers inside a Worker are NOT throttled when the
   tab is backgrounded (unlike page timers), so the bot keeps its 2s cadence. */
let t = null;
onmessage = (e) => {
  if (e.data === "start") { if (!t) t = setInterval(() => postMessage("tick"), 2000); }
  else if (e.data === "stop") { if (t) { clearInterval(t); t = null; } }
};
