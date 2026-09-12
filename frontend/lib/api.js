/**
 * Small fetch wrapper for the backend API.
 *
 * All requests go to the same origin (`/api/...`), which Next.js rewrites to
 * the backend (see next.config.mjs). This keeps the browser on one origin so
 * the app works inside the preview environment without CORS surprises.
 *
 * When no backend is reachable (e.g. a fresh APK with no server configured),
 * requests are answered by a built-in demo engine so the app still works
 * standalone with simulated data. See lib/demo.js.
 */

import { demoApi } from './demo.js';

const TOKEN_KEY = 'trading_token';
const BACKEND_KEY = 'backend_url';
const MODE_KEY = 'mode_cache';

// 'demo' (default) until a live backend is detected.
let mode = 'demo';
const modeListeners = [];

export function isDemoMode() {
  return mode === 'demo';
}
export function getMode() {
  return mode;
}
export function onModeChange(fn) {
  modeListeners.push(fn);
  return () => {
    const i = modeListeners.indexOf(fn);
    if (i >= 0) modeListeners.splice(i, 1);
  };
}
function setMode(m) {
  if (mode === m) return;
  mode = m;
  modeListeners.forEach((fn) => {
    try {
      fn(m);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Resolve the backend base URL:
 *   1. runtime override from localStorage (set in Settings → "Server URL"),
 *   2. build-time NEXT_PUBLIC_API_URL (Capacitor APK / standalone PWA),
 *   3. empty string => same-origin (proxied by Next.js in the web deploy).
 */
export function getApiBase() {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(BACKEND_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '');
}

export function setBackendUrl(url) {
  if (typeof window === 'undefined') return;
  if (url) localStorage.setItem(BACKEND_KEY, url);
  else localStorage.removeItem(BACKEND_KEY);
}

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, { method = 'GET', body, auth = true } = {}) {
  // Built-in demo engine answers everything when no backend is available.
  if (isDemoMode()) {
    return demoApi(path, { method, body });
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${getApiBase()}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Probe the backend health endpoint with a short timeout. A backend counts as
 * "live" only if it answers with a JSON body whose `ok` field is true — so a
 * static host (or Capacitor's local server) serving index.html for unknown
 * paths can never be mistaken for a live backend.
 */
async function probeBackend() {
  const base = getApiBase();
  const url = base ? `${base}/api/health` : '/api/health';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data && typeof data === 'object' && data.ok === true);
  } catch {
    return false;
  }
}

function persistMode(base) {
  try {
    localStorage.setItem(MODE_KEY, JSON.stringify({ base, mode }));
  } catch {
    /* ignore */
  }
}

/**
 * Detect whether a live backend is reachable and set the app mode.
 * Caches the result per backend URL so the app starts instantly on relaunch.
 */
export async function detectMode() {
  const base = getApiBase();
  try {
    const cached = JSON.parse(localStorage.getItem(MODE_KEY) || '{}');
    if (cached.base === base && cached.mode) {
      setMode(cached.mode);
      if (cached.mode === 'live') {
        // Re-verify in the background; downgrade if it went away.
        probeBackend().then((ok) => {
          if (!ok) {
            setMode('demo');
            persistMode(base);
          }
        });
      }
      return mode;
    }
  } catch {
    /* ignore */
  }
  const ok = await probeBackend();
  setMode(ok ? 'live' : 'demo');
  persistMode(base);
  return mode;
}

/**
 * Create/log into a local demo account so the dashboard has a JWT session on
 * first visit (paper trading works immediately). Real deployments can remove
 * this and rely on explicit registration/login.
 */
export async function ensureSession() {
  // The built-in demo engine needs no server-side session.
  if (isDemoMode()) return true;
  if (getToken()) return true;
  const creds = { email: 'demo@arena.ai', password: 'demo-password-123' };
  try {
    const res = await apiFetch('/auth/login', { method: 'POST', body: creds, auth: false });
    setToken(res.token);
  } catch {
    try {
      const res = await apiFetch('/auth/register', { method: 'POST', body: creds, auth: false });
      setToken(res.token);
    } catch {
      return false;
    }
  }
  return Boolean(getToken());
}

export const api = {
  // auth
  register: (payload) => apiFetch('/auth/register', { method: 'POST', body: payload, auth: false }),
  login: (payload) => apiFetch('/auth/login', { method: 'POST', body: payload, auth: false }),
  me: () => apiFetch('/auth/me'),
  saveBinanceKeys: (payload) => apiFetch('/auth/binance', { method: 'POST', body: payload }),

  // market
  klines: (symbol, interval, limit = 200) =>
    apiFetch(`/market/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { auth: false }),
  tickers: () => apiFetch('/market/tickers', { auth: false }),
  orderbook: (symbol) => apiFetch(`/market/orderbook?symbol=${symbol}`, { auth: false }),

  // trading
  portfolio: () => apiFetch('/trading/portfolio'),
  performance: () => apiFetch('/trading/performance'),
  trades: () => apiFetch('/trading/trades'),
  signal: (symbol) => apiFetch(`/trading/signal?symbol=${symbol}`),
  order: (payload) => apiFetch('/trading/order', { method: 'POST', body: payload }),
  autotrading: (payload) => apiFetch('/trading/autotrading', { method: 'POST', body: payload }),
  kill: () => apiFetch('/trading/kill', { method: 'POST', body: {} }),
  killReset: () => apiFetch('/trading/kill/reset', { method: 'POST', body: {} }),
  dca: (payload) => apiFetch('/trading/dca', { method: 'POST', body: payload }),
  risk: () => apiFetch('/trading/risk'),
};

export default api;
