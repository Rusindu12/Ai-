/**
 * Shared domain types for the AI Trading Bot.
 */

export type NetworkMode = 'testnet' | 'live';

export type SignalType = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export type Sentiment = 'Bullish' | 'Bearish' | 'Neutral';

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
}

export interface FibonacciLevel {
  ratio: number;
  price: number;
}

export interface VolumeProfileResult {
  binCount: number;
  binSize: number;
  poc: number; // Point of Control (price with highest traded volume)
  hvn: number[]; // High volume node prices (top 3 bins)
  bins: { low: number; high: number; volume: number }[];
}

export interface IchimokuSnapshot {
  conversion: number; // Tenkan-sen (9)
  baseLine: number; // Kijun-sen (26)
  spanA: number; // Senkou Span A at current bar (leading span, displaced)
  spanB: number; // Senkou Span B at current bar
  cloudTop: number;
  cloudBottom: number;
  priceAboveCloud: boolean;
  priceInCloud: boolean;
}

export interface IndicatorSnapshot {
  price: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  bbPercentB: number; // 0 = at lower band, 1 = at upper band
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  stochK: number;
  stochD: number;
  atr: number;
  atrPct: number; // ATR as % of price
  vwap: number;
  avgVolume: number;
  lastVolume: number;
  volumeRatio: number; // lastVolume / avgVolume
  ichimoku: IchimokuSnapshot;
  fibonacci: FibonacciLevel[];
  volumeProfile: VolumeProfileResult;
  ts: number;
}

export interface SignalBreakdownItem {
  name: string;
  score: number;
  detail: string;
}

export interface MtfInput {
  timeframe: string;
  candles: Candle[];
}

export interface SignalResult {
  signal: SignalType;
  score: number;
  confidence: number; // 0..100
  breakdown: SignalBreakdownItem[];
  snapshot: IndicatorSnapshot;
  symbol: string;
  timeframe: string;
  ts: number;
}

export type PositionReason =
  | 'SIGNAL'
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'MANUAL'
  | 'EMERGENCY';

export interface Position {
  id: string;
  symbol: string;
  side: 'LONG';
  qty: number;
  entryPrice: number;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  costUsd: number;
  paper: boolean;
  status: 'OPEN' | 'CLOSED';
  exitPrice?: number;
  exitTime?: number;
  pnlUsd?: number;
  pnlPct?: number;
  reason?: PositionReason;
  signalScore?: number;
}

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'trade';
  message: string;
}

export interface EquityPoint {
  ts: number;
  valueUsd: number;
}

export interface BotConfig {
  symbol: string;
  timeframe: string;
  pollIntervalSec: number;
  riskPct: number; // % of portfolio used per trade
  slAtr: number; // stop-loss distance in ATR multiples
  tpAtr: number; // take-profit distance in ATR multiples
  liveOrdersEnabled: boolean; // allow the engine to place REAL orders
  startVirtualUsd: number; // paper-trading bankroll
}

export interface TickerItem {
  symbol: string;
  base: string; // e.g. BTC
  price: number;
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number;
  spark: number[]; // recent poll history for sparkline
}

export interface StoredCredentials {
  apiKey: string;
  secretKey: string;
  mode: NetworkMode;
  savedAt: number;
}

export interface AccountBalances {
  USDT: number;
  BTC: number;
  ETH: number;
  totalUsd: number;
  prices: { BTC: number; ETH: number };
  ts: number;
}

export interface PnlSummary {
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  allTime: number | null;
}

export const DEFAULT_CONFIG: BotConfig = {
  symbol: 'BTCUSDT',
  timeframe: '15m',
  pollIntervalSec: 30,
  riskPct: 5,
  slAtr: 1.5,
  tpAtr: 2.5,
  liveOrdersEnabled: false,
  startVirtualUsd: 10000,
};

export const TOP_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'DOTUSDT',
];

export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

export const MTF_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];
