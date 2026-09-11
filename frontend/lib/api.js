/**
 * Small fetch wrapper for the backend API.
 *
 * All requests go to the same origin (`/api/...`), which Next.js rewrites to
 * the backend (see next.config.mjs). This keeps the browser on one origin so
 * the app works inside the preview environment without CORS surprises.
 */

const TOKEN_KEY = 'trading_token';
const BACKEND_KEY = 'backend_url';

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
 * Create/log into a local demo account so the dashboard has a JWT session on
 * first visit (paper trading works immediately). Real deployments can remove
 * this and rely on explicit registration/login.
 */
export async function ensureSession() {
  if (getToken()) return true;
  const creds = { email: 'demo@arena.ai', password: 'demo-password-123' };
  try {
    const res = await apiFetch('/auth/login', { method: 'POST', body: creds, auth: false });
    setToken(res.token);
  } catch {
    const res = await apiFetch('/auth/register', { method: 'POST', body: creds, auth: false });
    setToken(res.token);
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
