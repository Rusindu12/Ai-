/**
 * Formatting helpers.
 */

export function fmtUsd(v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  if (compact && Math.abs(v) >= 1_000_000) {
    return `$${(v / 1_000_000).toFixed(2)}M`;
  }
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function fmtPct(v: number | null | undefined, signed = true): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const sign = signed && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function fmtQty(v: number): string {
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.001) return v.toFixed(5);
  return v.toFixed(7);
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

export function baseOf(symbol: string): string {
  return symbol.replace(/USDT$/, '');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
