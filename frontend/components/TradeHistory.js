'use client';

import { fmtPrice, fmtQty, fmtMoney, timeAgo, cls } from '../lib/format';
import { getToken, getApiBase } from '../lib/api';

async function downloadCsv() {
  const token = getToken();
  const res = await fetch(`${getApiBase()}/api/trading/trades.csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trades.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function TradeHistory({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Trade History</div>
        <div className="py-8 text-center text-sm text-gray-400">No trades yet</div>
      </div>
    );
  }
  const rows = [...trades].reverse().slice(0, 30);
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="card-title mb-0">Trade History</div>
        <button onClick={downloadCsv} className="text-xs text-blue-500 hover:underline">
          Export CSV
        </button>
      </div>
      <div className="thin-scroll mt-2 max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-gray-900">
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="pb-2">Time</th>
              <th className="pb-2">Side</th>
              <th className="pb-2">Symbol</th>
              <th className="pb-2 text-right">Price</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Realized P&L</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="py-2 font-sans text-xs text-gray-500">{timeAgo(new Date(t.ts).getTime())}</td>
                <td className="py-2">
                  <span
                    className={cls(
                      'rounded px-1.5 py-0.5 text-xs font-semibold',
                      t.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
                    )}
                  >
                    {t.side}
                  </span>
                </td>
                <td className="py-2 font-sans font-medium">{t.symbol}</td>
                <td className="py-2 text-right">{fmtPrice(t.price)}</td>
                <td className="py-2 text-right">{fmtQty(t.quantity)}</td>
                <td className={cls('py-2 text-right', t.realizedPnl >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                  {t.realizedPnl != null ? fmtMoney(t.realizedPnl) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
