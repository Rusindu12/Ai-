'use client';

import { useEffect, useState } from 'react';
import api from '../lib/api';
import { cls } from '../lib/format';

const SIGNAL_STYLES = {
  BUY: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  SELL: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  HOLD: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
};

export default function SignalPanel({ symbol, signalEvent }) {
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .signal(symbol)
      .then((data) => {
        const combined = data.combined || data;
        setSignal({
          signal: combined.signal,
          confidence: combined.confidence ?? 0,
          ai: data.ai,
          votes: data.votes,
          score: combined.score,
        });
      })
      .catch(() => setSignal(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [symbol]);

  useEffect(() => {
    if (signalEvent && signalEvent.symbol === symbol) {
      setSignal({
        signal: signalEvent.signal,
        confidence: signalEvent.confidence ?? 0,
        ai: signalEvent.ai,
        votes: signalEvent.votes,
      });
    }
  }, [signalEvent, symbol]);

  return (
    <div className="card">
      <div className="card-title">AI Signal</div>
      {loading && !signal ? (
        <div className="py-8 text-center text-sm text-gray-400">Analyzing…</div>
      ) : signal ? (
        <div className="space-y-3">
          <div
            className={cls(
              'flex items-center justify-between rounded-lg border px-3 py-3',
              SIGNAL_STYLES[signal.signal] || SIGNAL_STYLES.HOLD
            )}
          >
            <span className="text-2xl font-bold">{signal.signal}</span>
            <div className="text-right">
              <div className="text-xl font-semibold">{(signal.confidence * 100).toFixed(0)}%</div>
              <div className="text-[10px] uppercase opacity-70">confidence</div>
            </div>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className={cls(
                'h-full rounded-full transition-all',
                signal.signal === 'BUY' ? 'bg-emerald-500' : signal.signal === 'SELL' ? 'bg-red-500' : 'bg-gray-400'
              )}
              style={{ width: `${Math.max(4, signal.confidence * 100)}%` }}
            />
          </div>

          {signal.ai && (
            <div className="rounded-lg bg-blue-500/10 px-3 py-2 text-xs">
              <div className="font-medium text-blue-600 dark:text-blue-400">LSTM/ensemble prediction</div>
              <div className="mt-0.5 text-gray-500 dark:text-gray-400">
                predicted price:{' '}
                <span className="font-mono">
                  {signal.ai.predictedPrice ? `$${Number(signal.ai.predictedPrice).toLocaleString()}` : '—'}
                </span>
              </div>
            </div>
          )}

          {signal.votes && signal.votes.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase text-gray-400">Strategy votes</div>
              {signal.votes.map((v) => (
                <div key={v.strategy} className="flex justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">{v.strategy}</span>
                  <span className="font-mono">
                    <span className={v.signal === 'BUY' ? 'text-emerald-500' : v.signal === 'SELL' ? 'text-red-500' : 'text-gray-400'}>
                      {v.signal}
                    </span>
                    <span className="ml-2 text-gray-400">{(v.confidence * 100).toFixed(0)}%</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-gray-400">No signal yet</div>
      )}
    </div>
  );
}
