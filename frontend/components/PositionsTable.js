'use client';

import { fmtPrice, fmtQty, fmtMoney, cls } from '../lib/format';

export default function PositionsTable({ positions }) {
  if (!positions || positions.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Open Positions</div>
        <div className="py-8 text-center text-sm text-gray-400">No open positions</div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-title">Open Positions</div>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="pb-2">Symbol</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Avg Price</th>
              <th className="pb-2 text-right">Mark</th>
              <th className="pb-2 text-right">Value</th>
              <th className="pb-2 text-right">Unrealized P&L</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {positions.map((p) => {
              const up = p.unrealizedPnl >= 0;
              return (
                <tr key={p.symbol} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2 font-sans font-medium">{p.symbol}</td>
                  <td className="py-2 text-right">{fmtQty(p.qty)}</td>
                  <td className="py-2 text-right">{fmtPrice(p.avgPrice)}</td>
                  <td className="py-2 text-right">{fmtPrice(p.price)}</td>
                  <td className="py-2 text-right">{fmtMoney(p.value)}</td>
                  <td className={cls('py-2 text-right', up ? 'text-emerald-500' : 'text-red-500')}>
                    {fmtMoney(p.unrealizedPnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
