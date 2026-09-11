'use client';

import { useState } from 'react';
import api from '../lib/api';
import { fmtPrice } from '../lib/format';

export default function TradeForm({ symbol, latestPrice }) {
  const [side, setSide] = useState('BUY');
  const [quantity, setQuantity] = useState('0.001');
  const [type, setType] = useState('MARKET');
  const [limitPrice, setLimitPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = { symbol, side, type, quantity: Number(quantity) };
      if (type === 'LIMIT') payload.price = Number(limitPrice);
      const res = await api.order(payload);
      setMessage({ ok: true, text: `${side} order placed${res.orderId ? ` #${res.orderId}` : ''}` });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">Trade</div>
      <div className="mb-3 flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {['BUY', 'SELL'].map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={
              'flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ' +
              (side === s
                ? s === 'BUY'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-red-500 text-white'
                : 'text-gray-500')
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Market price</span>
          <span className="font-mono">${fmtPrice(latestPrice)}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setType('MARKET')}
            className={
              'flex-1 rounded-md border py-1 text-xs font-medium ' +
              (type === 'MARKET' ? 'border-blue-500 text-blue-500' : 'border-gray-300 text-gray-500 dark:border-gray-700')
            }
          >
            Market
          </button>
          <button
            onClick={() => setType('LIMIT')}
            className={
              'flex-1 rounded-md border py-1 text-xs font-medium ' +
              (type === 'LIMIT' ? 'border-blue-500 text-blue-500' : 'border-gray-300 text-gray-500 dark:border-gray-700')
            }
          >
            Limit
          </button>
        </div>

        {type === 'LIMIT' && (
          <input
            className="input"
            type="number"
            step="any"
            placeholder="Limit price"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
          />
        )}
        <input
          className="input"
          type="number"
          step="any"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />

        <button
          onClick={submit}
          disabled={busy}
          className={side === 'BUY' ? 'btn-green w-full' : 'btn-red w-full'}
        >
          {busy ? 'Submitting…' : `${side} ${symbol}`}
        </button>

        {message && (
          <div className={'text-xs ' + (message.ok ? 'text-emerald-500' : 'text-red-500')}>{message.text}</div>
        )}
      </div>
    </div>
  );
}
