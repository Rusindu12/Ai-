/**
 * engine.ts — the live AI trading engine.
 *
 * Responsibilities:
 *   • Periodically fetch klines (primary + multi-timeframe) from Binance.
 *   • Score the market with the composite AI model (see signal.ts).
 *   • Open / close LONG positions with ATR-based stop-loss & take-profit.
 *   • Paper-trade by default; REAL orders only when the user has saved
 *     credentials, enabled live order placement and explicitly confirmed.
 *   • Persist all positions, history, logs and the virtual bankroll in the
 *     AES-256 encrypted secure store.
 */
import {
  getAccount,
  getKlines,
  placeOrder,
  roundQty,
} from '../api/binance';
import { generateSignal } from './signal';
import { secureGetJSON, secureSetJSON } from '../security/vault';
import {
  DEFAULT_CONFIG,
  MTF_TIMEFRAMES,
} from '../types';
import type {
  BotConfig,
  Candle,
  LogEntry,
  MtfInput,
  Position,
  PositionReason,
  SignalResult,
  StoredCredentials,
} from '../types';

const STORE_KEY = 'aitb.engine.v1';
const HISTORY_CAP = 400;
const LOG_CAP = 250;
const MIN_NOTIONAL_USD = 5; // Binance minimum order value guard

export interface EngineState {
  running: boolean;
  busy: boolean;
  config: BotConfig;
  liveConfirmed: boolean;
  lastSignal: SignalResult | null;
  positions: Position[];
  history: Position[];
  logs: LogEntry[];
  virtualUsd: number;
  virtualEquity: number;
  tickCount: number;
  lastTickTs: number;
  lastError: string | null;
  hasCredentials: boolean;
}

interface PersistedEngine {
  config: BotConfig;
  positions: Position[];
  history: Position[];
  logs: LogEntry[];
  virtualUsd: number;
}

type Listener = () => void;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class TradingEngine {
  private state: EngineState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private creds: StoredCredentials | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.state = {
      running: false,
      busy: false,
      config: { ...DEFAULT_CONFIG },
      liveConfirmed: false,
      lastSignal: null,
      positions: [],
      history: [],
      logs: [],
      virtualUsd: DEFAULT_CONFIG.startVirtualUsd,
      virtualEquity: DEFAULT_CONFIG.startVirtualUsd,
      tickCount: 0,
      lastTickTs: 0,
      lastError: null,
      hasCredentials: false,
    };
  }

  /* ------------------------------ subscriptions --------------------------- */

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): EngineState {
    return this.state;
  }

  private commit(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private log(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, message };
    this.commit({ logs: [entry, ...this.state.logs].slice(0, LOG_CAP) });
  }

  /* ------------------------------ credentials ----------------------------- */

  setCredentials(creds: StoredCredentials | null): void {
    this.creds = creds;
    this.commit({ hasCredentials: !!creds });
    if (!creds && this.state.config.liveOrdersEnabled) {
      this.commit({
        config: { ...this.state.config, liveOrdersEnabled: false },
        liveConfirmed: false,
      });
    }
  }

  setLiveConfirmed(confirmed: boolean): void {
    this.commit({ liveConfirmed: confirmed });
  }

  get mode() {
    return this.creds?.mode ?? 'testnet';
  }

  /** True only when every safety gate for REAL order placement is open. */
  get liveTradingArmed(): boolean {
    return (
      !!this.creds &&
      this.state.config.liveOrdersEnabled &&
      this.state.liveConfirmed
    );
  }

  /* ------------------------------- lifecycle ------------------------------ */

  async restore(): Promise<void> {
    const saved = await secureGetJSON<PersistedEngine>(STORE_KEY);
    if (!saved) return;
    this.commit({
      config: { ...DEFAULT_CONFIG, ...(saved.config ?? {}) },
      positions: saved.positions ?? [],
      history: (saved.history ?? []).slice(0, HISTORY_CAP),
      logs: (saved.logs ?? []).slice(0, LOG_CAP),
      virtualUsd:
        typeof saved.virtualUsd === 'number'
          ? saved.virtualUsd
          : DEFAULT_CONFIG.startVirtualUsd,
    });
    this.recalcEquity();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const { config, positions, history, logs, virtualUsd } = this.state;
      secureSetJSON<PersistedEngine>(STORE_KEY, {
        config,
        positions,
        history,
        logs: logs.slice(0, 100),
        virtualUsd,
      }).catch(() => undefined);
    }, 1500);
  }

  updateConfig(patch: Partial<BotConfig>): void {
    const config = { ...this.state.config, ...patch };
    if (!this.creds) config.liveOrdersEnabled = false;
    this.commit({ config });
    if (patch.startVirtualUsd && this.state.history.length === 0 && this.state.positions.length === 0) {
      this.commit({ virtualUsd: config.startVirtualUsd, virtualEquity: config.startVirtualUsd });
    }
    if (this.state.running) this.restartTimer();
    this.schedulePersist();
  }

  async start(): Promise<void> {
    if (this.state.running) return;
    this.commit({ running: true, lastError: null });
    this.log('info', `Bot started — ${this.state.config.symbol} @ ${this.state.config.timeframe}, every ${this.state.config.pollIntervalSec}s (${this.liveTradingArmed ? 'LIVE ORDERS' : 'paper trading'})`);
    this.restartTimer();
    await this.tick();
  }

  async stop(reason: string = 'stopped by user'): Promise<void> {
    if (!this.state.running) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.commit({ running: false, busy: false });
    this.log('warn', `Bot ${reason}`);
    this.schedulePersist();
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const interval = Math.max(10, this.state.config.pollIntervalSec) * 1000;
    this.timer = setInterval(() => {
      this.tick().catch(() => undefined);
    }, interval);
  }

  /** Emergency stop — halts immediately; optionally flattens open positions. */
  async emergencyStop(flatten: boolean): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.commit({ running: false, busy: false });
    this.log('error', `EMERGENCY STOP triggered (flatten=${flatten ? 'yes' : 'no'})`);
    if (flatten && this.state.positions.length > 0) {
      const price = await this.quickPrice(this.state.config.symbol);
      const positions = [...this.state.positions];
      for (const p of positions) {
        await this.closePositionInternal(p, 'EMERGENCY', price ?? p.entryPrice);
      }
    }
    this.schedulePersist();
  }

  private async quickPrice(symbol: string): Promise<number | null> {
    try {
      const k = await getKlines(this.mode, symbol, '1m', 2);
      return k.length > 0 ? k[k.length - 1].close : null;
    } catch {
      return null;
    }
  }

  /* --------------------------------- tick ---------------------------------- */

  async tick(): Promise<void> {
    if (!this.state.running || this.state.busy) return;
    this.commit({ busy: true });
    const { symbol, timeframe } = this.state.config;
    try {
      // 1. Primary candles (500 bars → enough for EMA200).
      const candles = await getKlines(this.mode, symbol, timeframe, 500);
      if (candles.length < 60) {
        throw new Error('insufficient candle history from exchange');
      }

      // 2. Multi-timeframe candles for confluence scoring.
      const secondary = MTF_TIMEFRAMES.filter((tf) => tf !== timeframe);
      const mtfResults = await Promise.allSettled(
        secondary.map((tf) => getKlines(this.mode, symbol, tf, 120)),
      );
      const mtf: MtfInput[] = [];
      mtfResults.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value.length >= 30) {
          mtf.push({ timeframe: secondary[idx], candles: r.value });
        }
      });

      // 3. Score the market.
      const signal = generateSignal(candles, { symbol, timeframe, mtf });
      if (!signal) throw new Error('could not compute indicators');
      this.commit({ lastSignal: signal, lastError: null });

      // 4. Risk management: stop-loss / take-profit on the open position.
      const price = signal.snapshot.price;
      const open = this.state.positions[0];
      if (open) {
        if (price <= open.stopLoss) {
          await this.closePositionInternal(open, 'STOP_LOSS', price);
        } else if (price >= open.takeProfit) {
          await this.closePositionInternal(open, 'TAKE_PROFIT', price);
        } else if (
          (signal.signal === 'SELL' || signal.signal === 'STRONG_SELL') &&
          signal.score <= -30
        ) {
          await this.closePositionInternal(open, 'SIGNAL', price);
        }
      } else if (signal.signal === 'BUY' || signal.signal === 'STRONG_BUY') {
        await this.openPosition(signal, candles);
      }

      this.recalcEquity();
      this.commit({ tickCount: this.state.tickCount + 1, lastTickTs: Date.now() });
      this.schedulePersist();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.commit({ lastError: msg });
      this.log('error', `Tick failed: ${msg}`);
    } finally {
      this.commit({ busy: false });
    }
  }

  /* ------------------------------ position ops ---------------------------- */

  private async openPosition(signal: SignalResult, candles: Candle[]): Promise<void> {
    const cfg = this.state.config;
    const price = signal.snapshot.price;
    const atr = signal.snapshot.atr;

    // --- sizing -------------------------------------------------------------
    let spendUsd = 0;
    if (this.liveTradingArmed && this.creds) {
      // Use a fraction of the real USDT balance.
      try {
        const account = await getAccount(this.mode, this.creds.apiKey, this.creds.secretKey);
        const usdt = account.balances.find((b) => b.asset === 'USDT');
        const free = usdt ? parseFloat(usdt.free) : 0;
        spendUsd = free * (cfg.riskPct / 100);
      } catch (e: any) {
        this.log('error', `Balance check failed: ${e?.message}`);
        return;
      }
    } else {
      spendUsd = this.state.virtualUsd * (cfg.riskPct / 100);
    }

    if (spendUsd < MIN_NOTIONAL_USD) {
      this.log('warn', `Not enough USDT for a ${cfg.riskPct}% position (≈$${spendUsd.toFixed(2)} < $${MIN_NOTIONAL_USD} min). Skipping entry.`);
      return;
    }

    let qty = roundQty(spendUsd / price, 5);
    if (qty <= 0) return;

    const paper = !this.liveTradingArmed;
    let entryPrice = price;

    if (!paper && this.creds) {
      try {
        spendUsd = qty * price; // align spend with rounded qty
        const resp = await placeOrder(this.mode, this.creds.apiKey, this.creds.secretKey, {
          symbol: cfg.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: spendUsd.toFixed(2),
          newOrderRespType: 'RESULT',
        });
        const executedQty = parseFloat(resp.executedQty ?? '0');
        const cumQuote = parseFloat(resp.cummulativeQuoteQty ?? '0');
        if (executedQty > 0 && cumQuote > 0) {
          entryPrice = cumQuote / executedQty;
          qty = roundQty(executedQty, 5);
        }
        this.log('trade', `LIVE BUY filled: ${qty} ${cfg.symbol} @ ${entryPrice.toFixed(2)} ($${spendUsd.toFixed(2)}) [${resp.status ?? 'FILLED'}]`);
      } catch (e: any) {
        this.log('error', `LIVE order rejected: ${e?.message} — trade skipped`);
        return;
      }
    } else {
      this.log('trade', `PAPER BUY: ${qty} ${cfg.symbol} @ ${entryPrice.toFixed(2)} ($${(qty * entryPrice).toFixed(2)}) — score ${signal.score}`);
    }

    const position: Position = {
      id: uid(),
      symbol: cfg.symbol,
      side: 'LONG',
      qty,
      entryPrice,
      entryTime: Date.now(),
      stopLoss: entryPrice - atr * cfg.slAtr,
      takeProfit: entryPrice + atr * cfg.tpAtr,
      costUsd: qty * entryPrice,
      paper,
      status: 'OPEN',
      signalScore: signal.score,
    };

    if (paper) {
      this.commit({ virtualUsd: this.state.virtualUsd - position.costUsd });
    }
    this.commit({ positions: [...this.state.positions, position] });
    this.log('info', `SL ${position.stopLoss.toFixed(2)} (−${cfg.slAtr}×ATR) · TP ${position.takeProfit.toFixed(2)} (+${cfg.tpAtr}×ATR)`);
  }

  async closePosition(id: string, reason: PositionReason): Promise<void> {
    const pos = this.state.positions.find((p) => p.id === id);
    if (!pos) return;
    const price = (await this.quickPrice(pos.symbol)) ?? pos.entryPrice;
    await this.closePositionInternal(pos, reason, price);
    this.schedulePersist();
  }

  private async closePositionInternal(
    pos: Position,
    reason: PositionReason,
    price: number,
  ): Promise<void> {
    let exitPrice = price;

    if (!pos.paper && this.creds) {
      try {
        const resp = await placeOrder(this.mode, this.creds.apiKey, this.creds.secretKey, {
          symbol: pos.symbol,
          side: 'SELL',
          type: 'MARKET',
          quantity: String(pos.qty),
          newOrderRespType: 'RESULT',
        });
        const executedQty = parseFloat(resp.executedQty ?? '0');
        const cumQuote = parseFloat(resp.cummulativeQuoteQty ?? '0');
        if (executedQty > 0 && cumQuote > 0) exitPrice = cumQuote / executedQty;
        this.log('trade', `LIVE SELL filled: ${pos.qty} ${pos.symbol} @ ${exitPrice.toFixed(2)} (${reason})`);
      } catch (e: any) {
        this.log('error', `LIVE sell failed: ${e?.message} — recording paper exit instead`);
      }
    } else {
      this.log('trade', `PAPER SELL: ${pos.qty} ${pos.symbol} @ ${exitPrice.toFixed(2)} (${reason})`);
    }

    const proceeds = pos.qty * exitPrice;
    const pnlUsd = proceeds - pos.costUsd;
    const pnlPct = (pnlUsd / pos.costUsd) * 100;

    const closed: Position = {
      ...pos,
      status: 'CLOSED',
      exitPrice,
      exitTime: Date.now(),
      pnlUsd,
      pnlPct,
      reason,
    };

    if (pos.paper) {
      this.commit({ virtualUsd: this.state.virtualUsd + proceeds });
    }
    this.commit({
      positions: this.state.positions.filter((p) => p.id !== pos.id),
      history: [closed, ...this.state.history].slice(0, HISTORY_CAP),
    });
    this.log(
      pnlUsd >= 0 ? 'info' : 'warn',
      `Closed ${pos.symbol} ${reason}: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
    );
    this.recalcEquity();
  }

  /* --------------------------------- stats --------------------------------- */

  private recalcEquity(): void {
    const price = this.state.lastSignal?.snapshot.price ?? null;
    let equity = this.state.virtualUsd;
    for (const p of this.state.positions) {
      equity += p.qty * (price ?? p.entryPrice);
    }
    this.commit({ virtualEquity: equity });
  }

  stats(): {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnlUsd: number;
    bestTradeUsd: number;
    worstTradeUsd: number;
  } {
    const closed = this.state.history;
    const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).length;
    const losses = closed.filter((t) => (t.pnlUsd ?? 0) <= 0).length;
    const totalPnlUsd = closed.reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const pnls = closed.map((t) => t.pnlUsd ?? 0);
    return {
      trades: closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
      totalPnlUsd,
      bestTradeUsd: pnls.length ? Math.max(...pnls) : 0,
      worstTradeUsd: pnls.length ? Math.min(...pnls) : 0,
    };
  }
}

export const engine = new TradingEngine();
