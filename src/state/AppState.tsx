/**
 * AppState.tsx — global provider.
 *
 * Owns: credentials lifecycle, connection status, portfolio balances,
 * top-10 live tickers, market sentiment, equity history for P&L periods,
 * biometric lock gate, and the subscription bridge to the trading engine.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { getAccount, getTickers24h, testConnection } from '../api/binance';
import { engine } from '../engine/engine';
import type { EngineState } from '../engine/engine';
import { sentimentFromTickers } from '../engine/signal';
import { BiometricAuth } from '../native/Bridge';
import {
  clearCredentials,
  hasCredentials,
  loadCredentials,
  saveCredentials,
  secureGetJSON,
  secureSetJSON,
} from '../security/vault';
import { TOP_SYMBOLS } from '../types';
import type {
  AccountBalances,
  EquityPoint,
  NetworkMode,
  PnlSummary,
  Sentiment,
  StoredCredentials,
  TickerItem,
} from '../types';
import { baseOf } from '../util/format';

const SETTINGS_KEY = 'aitb.settings.v1';
const EQUITY_KEY = 'aitb.equity.v1';
const SPARK_CAP = 40;
const EQUITY_CAP = 6000;

interface Settings {
  biometricsEnabled: boolean;
}

export type ConnState = 'unknown' | 'checking' | 'ok' | 'error';
export type Phase = 'loading' | 'setup' | 'locked' | 'ready';

interface AppStateValue {
  phase: Phase;
  credentials: StoredCredentials | null;
  mode: NetworkMode;
  connection: ConnState;
  connectionDetail: string;
  balances: AccountBalances | null;
  tickers: TickerItem[];
  sentiment: Sentiment;
  pnl: PnlSummary;
  bot: EngineState;
  biometricsAvailable: boolean;
  biometricsEnabled: boolean;
  actions: {
    saveAndConnect: (apiKey: string, secretKey: string, mode: NetworkMode) => Promise<{ ok: boolean; detail: string }>;
    testConnectionNow: (apiKey?: string, secretKey?: string, mode?: NetworkMode) => Promise<void>;
    clearAll: () => Promise<void>;
    unlock: () => Promise<boolean>;
    setBiometricsEnabled: (on: boolean) => Promise<void>;
    refresh: () => Promise<void>;
  };
}

const Ctx = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState outside provider');
  return v;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [credentials, setCredentials] = useState<StoredCredentials | null>(null);
  const [connection, setConnection] = useState<ConnState>('unknown');
  const [connectionDetail, setConnectionDetail] = useState('');
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [settings, setSettings] = useState<Settings>({ biometricsEnabled: false });
  const [equityHistory, setEquityHistory] = useState<EquityPoint[]>([]);
  const sparksRef = useRef<Record<string, number[]>>({});
  const credsRef = useRef<StoredCredentials | null>(null);
  const equityRef = useRef<EquityPoint[]>([]);

  const bot = useSyncExternalStore(
    useCallback((cb: () => void) => engine.subscribe(cb), []),
    () => engine.getState(),
  );

  const mode: NetworkMode = credentials?.mode ?? 'testnet';

  /* ------------------------------ boot sequence ---------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await engine.restore();
      const savedSettings = await secureGetJSON<Settings>(SETTINGS_KEY);
      const savedEquity = await secureGetJSON<EquityPoint[]>(EQUITY_KEY);
      if (cancelled) return;
      if (savedSettings) setSettings(savedSettings);
      if (savedEquity) {
        equityRef.current = savedEquity;
        setEquityHistory(savedEquity);
      }
      try {
        setBiometricsAvailable(await BiometricAuth.isAvailable());
      } catch {
        setBiometricsAvailable(false);
      }
      const hasCreds = await hasCredentials();
      if (cancelled) return;
      if (!hasCreds) {
        setPhase('setup');
      } else if (savedSettings?.biometricsEnabled) {
        setPhase('locked');
      } else {
        await completeUnlock();
      }
    })().catch(() => setPhase('setup'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load + decrypt credentials and go live. */
  const completeUnlock = useCallback(async () => {
    const creds = await loadCredentials();
    if (!creds) {
      setPhase('setup');
      return;
    }
    credsRef.current = creds;
    setCredentials(creds);
    engine.setCredentials(creds);
    setPhase('ready');
    void refreshAll(creds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------- pollers -------------------------------- */

  const refreshBalances = useCallback(async (creds: StoredCredentials) => {
    try {
      const account = await getAccount(creds.mode, creds.apiKey, creds.secretKey);
      const freeOf = (asset: string) => {
        const b = account.balances.find((x) => x.asset === asset);
        return b ? parseFloat(b.free) + parseFloat(b.locked) : 0;
      };
      const USDT = freeOf('USDT');
      const BTC = freeOf('BTC');
      const ETH = freeOf('ETH');
      let btcPrice = 0;
      let ethPrice = 0;
      try {
        const t = await getTickers24h(creds.mode, ['BTCUSDT', 'ETHUSDT']);
        btcPrice = parseFloat(t.find((x) => x.symbol === 'BTCUSDT')?.lastPrice ?? '0');
        ethPrice = parseFloat(t.find((x) => x.symbol === 'ETHUSDT')?.lastPrice ?? '0');
      } catch {
        /* price fetch is best-effort */
      }
      const next: AccountBalances = {
        USDT,
        BTC,
        ETH,
        totalUsd: USDT + BTC * btcPrice + ETH * ethPrice,
        prices: { BTC: btcPrice, ETH: ethPrice },
        ts: Date.now(),
      };
      setBalances(next);
      setConnection('ok');
      setConnectionDetail(`Connected to ${creds.mode === 'live' ? 'Binance LIVE' : 'Binance Testnet'}`);

      // Equity snapshot for P&L tracking (max 1/min)
      const hist = equityRef.current;
      if (hist.length === 0 || Date.now() - hist[hist.length - 1].ts > 60_000) {
        const point: EquityPoint = { ts: Date.now(), valueUsd: next.totalUsd };
        const updated = [...hist, point].slice(-EQUITY_CAP);
        equityRef.current = updated;
        setEquityHistory(updated);
        secureSetJSON(EQUITY_KEY, updated.slice(-EQUITY_CAP / 2)).catch(() => undefined);
      }
    } catch (e: any) {
      setConnection('error');
      setConnectionDetail(e?.message ?? 'Connection failed');
    }
  }, []);

  const refreshTickers = useCallback(async (m: NetworkMode) => {
    try {
      const raw = await getTickers24h(m, TOP_SYMBOLS);
      setTickers((prev) => {
        const map: Record<string, TickerItem> = {};
        for (const p of prev) map[p.symbol] = p;
        return raw.map((r) => {
          const price = parseFloat(r.lastPrice);
          const spark = sparksRef.current[r.symbol] ?? [];
          spark.push(price);
          if (spark.length > SPARK_CAP) spark.shift();
          sparksRef.current[r.symbol] = spark;
          return {
            symbol: r.symbol,
            base: baseOf(r.symbol),
            price,
            changePct: parseFloat(r.priceChangePercent),
            high: parseFloat(r.highPrice),
            low: parseFloat(r.lowPrice),
            quoteVolume: parseFloat(r.quoteVolume),
            spark: [...spark],
          };
        });
      });
    } catch {
      /* transient network errors are ignored; next poll retries */
    }
  }, []);

  const refreshAll = useCallback(
    async (creds?: StoredCredentials) => {
      const c = creds ?? credsRef.current;
      await Promise.all([
        c ? refreshBalances(c) : Promise.resolve(),
        refreshTickers(c?.mode ?? 'testnet'),
      ]);
    },
    [refreshBalances, refreshTickers],
  );

  useEffect(() => {
    if (phase !== 'ready') return;
    const id = setInterval(() => {
      void refreshAll();
    }, 15_000);
    const tickerId = setInterval(() => {
      void refreshTickers(credsRef.current?.mode ?? 'testnet');
    }, 6_000);
    return () => {
      clearInterval(id);
      clearInterval(tickerId);
    };
  }, [phase, refreshAll, refreshTickers]);

  /* -------------------------------- actions -------------------------------- */

  const testConnectionNow = useCallback(
    async (apiKey?: string, secretKey?: string, m?: NetworkMode) => {
      setConnection('checking');
      const useMode = m ?? credsRef.current?.mode ?? 'testnet';
      const res = await testConnection(
        useMode,
        apiKey ?? credsRef.current?.apiKey,
        secretKey ?? credsRef.current?.secretKey,
      );
      setConnection(res.ok ? 'ok' : 'error');
      setConnectionDetail(res.detail);
    },
    [],
  );

  const saveAndConnect = useCallback(
    async (apiKey: string, secretKey: string, m: NetworkMode) => {
      const res = await testConnection(m, apiKey, secretKey);
      if (!res.ok) {
        setConnection('error');
        setConnectionDetail(res.detail);
        return { ok: false, detail: res.detail };
      }
      await saveCredentials({ apiKey: apiKey.trim(), secretKey: secretKey.trim(), mode: m });
      const creds: StoredCredentials = {
        apiKey: apiKey.trim(),
        secretKey: secretKey.trim(),
        mode: m,
        savedAt: Date.now(),
      };
      credsRef.current = creds;
      setCredentials(creds);
      engine.setCredentials(creds);
      setConnection('ok');
      setConnectionDetail(res.detail);
      setPhase('ready');
      void refreshAll(creds);
      return { ok: true, detail: res.detail };
    },
    [refreshAll],
  );

  const clearAll = useCallback(async () => {
    await engine.emergencyStop(false);
    engine.setCredentials(null);
    await clearCredentials();
    credsRef.current = null;
    setCredentials(null);
    setBalances(null);
    setConnection('unknown');
    setConnectionDetail('');
    setPhase('setup');
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (settings.biometricsEnabled && biometricsAvailable) {
      let ok = false;
      try {
        ok = await BiometricAuth.authenticate(
          'AI Trading Bot',
          'Verify your identity to unlock trading',
        );
      } catch {
        ok = false;
      }
      if (!ok) return false;
    }
    await completeUnlock();
    return true;
  }, [settings.biometricsEnabled, biometricsAvailable, completeUnlock]);

  const setBiometricsEnabled = useCallback(async (on: boolean) => {
    const next = { biometricsEnabled: on };
    setSettings(next);
    await secureSetJSON(SETTINGS_KEY, next);
  }, []);

  /* -------------------------------- derived -------------------------------- */

  const sentiment: Sentiment = useMemo(
    () => sentimentFromTickers(tickers.map((t) => t.changePct)),
    [tickers],
  );

  const pnl: PnlSummary = useMemo(() => {
    if (balances === null || equityHistory.length === 0) {
      return { daily: null, weekly: null, monthly: null, allTime: null };
    }
    const current = balances.totalUsd;
    const pctSince = (ms: number): number | null => {
      const cutoff = Date.now() - ms;
      let base: EquityPoint | null = null;
      for (const p of equityHistory) {
        if (p.ts <= cutoff) base = p;
        else break;
      }
      if (!base || base.valueUsd <= 0) return null;
      return ((current - base.valueUsd) / base.valueUsd) * 100;
    };
    const first = equityHistory[0];
    return {
      daily: pctSince(24 * 3600 * 1000),
      weekly: pctSince(7 * 24 * 3600 * 1000),
      monthly: pctSince(30 * 24 * 3600 * 1000),
      allTime: first && first.valueUsd > 0 ? ((current - first.valueUsd) / first.valueUsd) * 100 : null,
    };
  }, [balances, equityHistory]);

  const value: AppStateValue = {
    phase,
    credentials,
    mode,
    connection,
    connectionDetail,
    balances,
    tickers,
    sentiment,
    pnl,
    bot,
    biometricsAvailable,
    biometricsEnabled: settings.biometricsEnabled,
    actions: {
      saveAndConnect,
      testConnectionNow,
      clearAll,
      unlock,
      setBiometricsEnabled,
      refresh: () => refreshAll(),
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
