'use client';

import { cls } from '../lib/format';

export default function Header({
  theme,
  toggleTheme,
  connected,
  autoTrading,
  onToggleAuto,
  onKill,
  killTriggered,
  onOpenSettings,
  latestPrices,
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">
            AI
          </span>
          <div className="leading-tight">
            <div className="font-semibold">AI Crypto Trading</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Binance · Paper</div>
          </div>
        </div>

        {/* live tickers */}
        <div className="ml-2 hidden items-center gap-4 text-sm md:flex">
          {Object.entries(latestPrices || {}).slice(0, 4).map(([sym, px]) => (
            <div key={sym} className="flex items-center gap-1 font-mono">
              <span className="text-gray-500 dark:text-gray-400">{sym.replace('USDT', '')}</span>
              <span>${Number(px).toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={cls(
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:flex',
              connected ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
            )}
          >
            <span className={cls('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-red-500')} />
            {connected ? 'Live' : 'Offline'}
          </span>

          <button
            onClick={onToggleAuto}
            className={cls(
              'btn text-xs',
              autoTrading ? 'btn-green' : 'btn-ghost'
            )}
            title="Toggle AI auto-trading"
          >
            {autoTrading ? 'AI Auto-trading: ON' : 'AI Auto-trading: OFF'}
          </button>

          <button
            onClick={onKill}
            className={cls('btn text-xs', killTriggered ? 'btn-red' : 'btn-ghost border border-red-300 text-red-600 dark:border-red-900')}
            title="Emergency kill switch — close all positions"
          >
            ⏻ Kill
          </button>

          <button onClick={onOpenSettings} className="btn-ghost text-xs" title="Settings">
            ⚙ Settings
          </button>

          <button onClick={toggleTheme} className="btn-ghost px-2" title="Toggle theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </header>
  );
}
