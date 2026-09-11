'use client';

import { fmtMoney, fmtPct, cls } from '../lib/format';

function Stat({ label, value, sub, tone }) {
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={cls('mt-1 text-xl font-semibold', tone)}>{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

export default function PortfolioSummary({ portfolio, performance }) {
  const pnl = portfolio?.pnl ?? 0;
  const pnlTone = pnl >= 0 ? 'text-emerald-500' : 'text-red-500';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Portfolio Value" value={`$${fmtMoney(portfolio?.equity)}`} sub={`cash $${fmtMoney(portfolio?.cash)}`} />
      <Stat label="Total P&L" value={`$${fmtMoney(pnl)}`} sub={fmtPct(portfolio?.pnlPct ?? 0)} tone={pnlTone} />
      <Stat label="Win Rate" value={fmtPct(performance?.winRate ?? 0, 1, false)} sub={`${performance?.trades ?? 0} closed trades`} />
      <Stat label="Sharpe Ratio" value={fmtMoney(performance?.sharpeRatio, 2)} sub={`max DD ${fmtPct(performance?.maxDrawdown ?? 0, 1, false)}`} />
    </div>
  );
}
