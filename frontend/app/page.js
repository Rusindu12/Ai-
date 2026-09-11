'use client';

import { useEffect, useState, useCallback } from 'react';
import Header from '../components/Header';
import PriceChart from '../components/PriceChart';
import OrderBook from '../components/OrderBook';
import SignalPanel from '../components/SignalPanel';
import PortfolioSummary from '../components/PortfolioSummary';
import PositionsTable from '../components/PositionsTable';
import TradeHistory from '../components/TradeHistory';
import TradeForm from '../components/TradeForm';
import SettingsPanel from '../components/SettingsPanel';
import api, { ensureSession } from '../lib/api';
import { getSocket } from '../lib/socket';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

export default function Dashboard() {
  const [theme, setTheme] = useState('dark');
  const [connected, setConnected] = useState(false);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1m');
  const [portfolio, setPortfolio] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [trades, setTrades] = useState([]);
  const [autoTrading, setAutoTrading] = useState(false);
  const [killTriggered, setKillTriggered] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latestPrices, setLatestPrices] = useState({});
  const [tickerEvent, setTickerEvent] = useState(null);
  const [klineEvent, setKlineEvent] = useState(null);
  const [depthEvent, setDepthEvent] = useState(null);
  const [signalEvent, setSignalEvent] = useState(null);
  const [tradeEvent, setTradeEvent] = useState(null);
  const [notifGranted, setNotifGranted] = useState(false);

  // ---- theme ----
  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark';
    setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  // ---- notification permission ----
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      setNotifGranted(true);
    }
  }, []);

  const notify = useCallback(
    (title, body) => {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, { body });
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  // ---- websocket ----
  useEffect(() => {
    const socket = getSocket();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('ticker', (t) => {
      setTickerEvent(t);
      setLatestPrices((prev) => ({ ...prev, [t.symbol]: t.lastPrice }));
    });
    socket.on('kline', (k) => setKlineEvent(k));
    socket.on('depth', (d) => setDepthEvent(d));
    socket.on('signal', (s) => setSignalEvent(s));
    socket.on('trade', (t) => {
      setTradeEvent(t);
      notify('Trade executed', `${t.side} ${t.quantity} ${t.symbol} @ ${t.price}`);
      setTrades((prev) => [...prev, { ...t, ts: t.ts || new Date().toISOString(), id: t.id || `t_${Date.now()}` }]);
    });
    socket.on('bracket', (b) => notify(`${b.symbol} ${b.trigger}`, `@ ${b.price}`));
    socket.on('orderRejected', (r) => notify('Order rejected', r.reason));

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('ticker');
      socket.off('kline');
      socket.off('depth');
      socket.off('signal');
      socket.off('trade');
      socket.off('bracket');
      socket.off('orderRejected');
    };
  }, [notify]);

  // ---- REST data ----
  const refreshPortfolio = useCallback(() => {
    api.portfolio().then(setPortfolio).catch(() => {});
    api.performance().then(setPerformance).catch(() => {});
    api.trades().then(setTrades).catch(() => {});
  }, []);

  useEffect(() => {
    ensureSession().then(refreshPortfolio).catch(() => {});
    const t = setInterval(refreshPortfolio, 5000);
    return () => clearInterval(t);
  }, [refreshPortfolio]);

  useEffect(() => {
    if (tradeEvent) refreshPortfolio();
  }, [tradeEvent, refreshPortfolio]);

  const toggleAuto = async () => {
    try {
      const res = await api.autotrading({ enabled: !autoTrading });
      setAutoTrading(res.enabled);
    } catch {
      setAutoTrading((v) => !v);
    }
  };

  const kill = async () => {
    if (!killTriggered && !window.confirm('Engage emergency kill switch? All positions will be closed.')) return;
    try {
      await api.kill();
      setKillTriggered(true);
      refreshPortfolio();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        theme={theme}
        toggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        connected={connected}
        autoTrading={autoTrading}
        onToggleAuto={toggleAuto}
        onKill={kill}
        killTriggered={killTriggered}
        onOpenSettings={() => setSettingsOpen(true)}
        latestPrices={latestPrices}
      />

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {/* symbol selector */}
        <div className="flex flex-wrap gap-2">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ' +
                (symbol === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800')
              }
            >
              {s.replace('USDT', '/USDT')}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400">
            {notifGranted ? '🔔 push notifications on' : '🔕 enable notifications for trade alerts'}
          </span>
        </div>

        <PortfolioSummary portfolio={portfolio} performance={performance} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <PriceChart
              symbol={symbol}
              interval={interval}
              onChangeInterval={setInterval}
              theme={theme}
              klineEvent={klineEvent}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PositionsTable positions={portfolio?.positions || []} />
              <TradeHistory trades={trades} />
            </div>
          </div>

          <div className="space-y-4">
            <SignalPanel symbol={symbol} signalEvent={signalEvent} />
            <TradeForm symbol={symbol} latestPrice={latestPrices[symbol]} />
            <OrderBook symbol={symbol} depthEvent={depthEvent} />
          </div>
        </div>
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        theme={theme}
      />
    </div>
  );
}
