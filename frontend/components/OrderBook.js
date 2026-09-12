'use client';

import { useEffect, useState } from 'react';
import api from '../lib/api';
import { fmtPrice, fmtQty, cls } from '../lib/format';

export default function OrderBook({ symbol, depthEvent, mode }) {
  const [book, setBook] = useState({ bids: [], asks: [] });

  useEffect(() => {
    let cancelled = false;
    api
      .orderbook(symbol)
      .then((b) => !cancelled && setBook({ bids: b.bids.slice(0, 10), asks: b.asks.slice(0, 10) }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, mode]);

  useEffect(() => {
    if (!depthEvent || depthEvent.symbol !== symbol) return;
    setBook({ bids: depthEvent.bids.slice(0, 10), asks: depthEvent.asks.slice(0, 10) });
  }, [depthEvent, symbol]);

  const maxQty = Math.max(
    1e-9,
    ...[...book.bids, ...book.asks].map(([, q]) => q)
  );

  const rows = (levels, side) => {
    const sorted = side === 'asks' ? [...levels].reverse() : levels;
    return sorted.map(([price, qty], i) => (
      <div key={`${side}-${i}`} className="relative grid grid-cols-3 items-center py-0.5 text-xs font-mono">
        <div
          className={cls(
            'absolute inset-y-0 right-0 opacity-15',
            side === 'asks' ? 'bg-red-500' : 'bg-emerald-500'
          )}
          style={{ width: `${(qty / maxQty) * 100}%` }}
        />
        <span className={cls('relative', side === 'asks' ? 'text-red-500' : 'text-emerald-500')}>
          {fmtPrice(price)}
        </span>
        <span className="relative text-right text-gray-500 dark:text-gray-400">{fmtQty(qty)}</span>
        <span className="relative text-right text-gray-400">{fmtPrice(price * qty)}</span>
      </div>
    ));
  };

  return (
    <div className="card">
      <div className="card-title">Order Book</div>
      <div className="grid grid-cols-3 pb-1 text-[10px] uppercase text-gray-400">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>
      <div className="thin-scroll max-h-56 overflow-y-auto">
        {rows(book.asks, 'asks')}
        {book.bids.length > 0 && book.asks.length > 0 && (
          <div className="my-1 border-t border-gray-200 dark:border-gray-800" />
        )}
        {rows(book.bids, 'bids')}
      </div>
    </div>
  );
}
