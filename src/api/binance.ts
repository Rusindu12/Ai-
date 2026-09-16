/**
 * binance.ts — minimal Binance Spot REST client.
 *
 * Supports both Live (api.binance.com) and Spot Testnet
 * (testnet.binance.vision). Signed endpoints use HMAC-SHA256 over the query
 * string with the account's secret key, plus timestamp/recvWindow handling
 * with a server-time offset to tolerate device clock drift.
 */
import { hmacSha256Hex } from '../security/vault';
import type { Candle, NetworkMode } from '../types';

export const REST_BASE: Record<NetworkMode, string> = {
  live: 'https://api.binance.com',
  testnet: 'https://testnet.binance.vision',
};

export function baseFor(mode: NetworkMode): string {
  return REST_BASE[mode];
}

let serverTimeOffsetMs = 0;
export function nowTs(): number {
  return Date.now() + serverTimeOffsetMs;
}

export class BinanceError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}

interface RequestOptions {
  mode: NetworkMode;
  method?: 'GET' | 'POST' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  apiKey?: string;
  secretKey?: string;
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOptions): Promise<T> {
  const { mode, method = 'GET', query = {}, apiKey, secretKey, timeoutMs = 12000 } = opts;

  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) pairs.push([k, String(v)]);
  }

  const signed = Boolean(apiKey && secretKey);
  if (signed) {
    pairs.push(['timestamp', String(nowTs())]);
    pairs.push(['recvWindow', '5000']);
  }

  let qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  if (signed) {
    qs += `${qs ? '&' : ''}signature=${hmacSha256Hex(qs, secretKey as string)}`;
  }

  const url = `${REST_BASE[mode]}${path}${qs ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal as any,
      headers: apiKey ? { 'X-MBX-APIKEY': apiKey } : {},
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg: string = json && json.msg ? json.msg : `HTTP ${res.status}`;
      const code: number | undefined = json && json.code !== undefined ? json.code : res.status;
      throw new BinanceError(`Binance ${path}: ${msg}`, code);
    }
    return json as T;
  } catch (e: any) {
    if (e instanceof BinanceError) throw e;
    if (e?.name === 'AbortError') {
      throw new BinanceError(`Binance ${path}: request timed out`);
    }
    throw new BinanceError(`Binance ${path}: network error (${e?.message ?? 'unknown'})`);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- endpoints ------------------------------- */

export function ping(mode: NetworkMode): Promise<{}> {
  return request('/api/v3/ping', { mode });
}

/** Sync local clock against the exchange; returns server time (ms). */
export async function syncServerTime(mode: NetworkMode): Promise<number> {
  const before = Date.now();
  const res = await request<{ serverTime: number }>('/api/v3/time', { mode });
  const after = Date.now();
  const latency = Math.max(0, Math.round((after - before) / 2));
  serverTimeOffsetMs = res.serverTime - before - latency;
  return res.serverTime;
}

export function klinesToCandles(raw: any[]): Candle[] {
  return raw.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
    quoteVolume: parseFloat(k[7]),
    trades: k[8],
  }));
}

export function getKlines(
  mode: NetworkMode,
  symbol: string,
  interval: string,
  limit = 500,
): Promise<Candle[]> {
  return request<any[]>('/api/v3/klines', {
    mode,
    query: { symbol, interval, limit },
  }).then(klinesToCandles);
}

export interface RawTicker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
}

/** Batched 24h ticker for a list of symbols (single request). */
export function getTickers24h(mode: NetworkMode, symbols: string[]): Promise<RawTicker24h[]> {
  return request<RawTicker24h[]>('/api/v3/ticker/24hr', {
    mode,
    query: { symbols: JSON.stringify(symbols) },
  });
}

export interface AccountBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface AccountResponse {
  balances: AccountBalance[];
  [k: string]: any;
}

export function getAccount(
  mode: NetworkMode,
  apiKey: string,
  secretKey: string,
): Promise<AccountResponse> {
  return request<AccountResponse>('/api/v3/account', { mode, apiKey, secretKey });
}

export interface OrderParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string; // 'MARKET'
  quantity?: string; // base asset qty (SELL / base BUY)
  quoteOrderQty?: string; // USDT amount (MARKET BUY)
  newOrderRespType?: 'ACK' | 'RESULT' | 'FULL';
}

export function placeOrder(
  mode: NetworkMode,
  apiKey: string,
  secretKey: string,
  params: OrderParams,
): Promise<any> {
  const query: Record<string, string | number | boolean | undefined> = { ...params };
  return request<any>('/api/v3/order', {
    mode,
    method: 'POST',
    apiKey,
    secretKey,
    query,
  });
}

export function getOpenOrders(
  mode: NetworkMode,
  apiKey: string,
  secretKey: string,
): Promise<any[]> {
  return request<any[]>('/api/v3/openOrders', { mode, apiKey, secretKey });
}

/**
 * Full connectivity + credential check.
 * Returns a human-readable status.
 */
export async function testConnection(
  mode: NetworkMode,
  apiKey?: string,
  secretKey?: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    await syncServerTime(mode);
    if (!apiKey || !secretKey) {
      return { ok: true, detail: 'Public API reachable (no keys provided)' };
    }
    const account = await getAccount(mode, apiKey, secretKey);
    const assets = account.balances.filter((b) => parseFloat(b.free) > 0).length;
    return {
      ok: true,
      detail: `Authenticated ✓ — ${assets} funded asset${assets === 1 ? '' : 's'} on ${mode === 'live' ? 'LIVE' : 'TESTNET'}`,
    };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? 'Unknown error' };
  }
}

/** Round an order quantity to the exchange's typical step precision. */
export function roundQty(qty: number, decimals = 6): number {
  if (!isFinite(qty) || qty <= 0) return 0;
  const factor = Math.pow(10, decimals);
  return Math.floor(qty * factor) / factor;
}
