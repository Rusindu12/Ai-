'use client';

import { useEffect, useState } from 'react';
import api, { getToken, setToken, getApiBase, setBackendUrl, detectMode } from '../lib/api';
import { reconnectSocket } from '../lib/socket';

export default function SettingsPanel({ open, onClose, onToggleTheme, theme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [binanceKey, setBinanceKey] = useState('');
  const [binanceSecret, setBinanceSecret] = useState('');
  const [me, setMe] = useState(null);
  const [risk, setRisk] = useState(null);
  const [dcaSymbol, setDcaSymbol] = useState('BTCUSDT');
  const [dcaAmount, setDcaAmount] = useState('25');
  const [dcaInterval, setDcaInterval] = useState('3600000');
  const [backendUrl, setBackendUrlState] = useState('');
  const [message, setMessage] = useState(null);

  const flash = (ok, text) => setMessage({ ok, text });

  useEffect(() => {
    setBackendUrlState(getApiBase());
  }, [open]);

  const saveBackendUrl = async () => {
    setBackendUrl(backendUrl.trim() || null);
    reconnectSocket();
    await detectMode();
    flash(true, 'Server URL saved — reconnecting…');
  };

  const refresh = async () => {
    if (!getToken()) return;
    try {
      const [meData, riskData] = await Promise.all([api.me(), api.risk()]);
      setMe(meData);
      setRisk(riskData);
    } catch {
      setMe(null);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  const login = async () => {
    try {
      const res = await api.login({ email, password, totpCode: totpCode || undefined });
      setToken(res.token);
      flash(true, 'Logged in');
      refresh();
    } catch (e) {
      flash(false, e.message);
    }
  };

  const register = async () => {
    try {
      const res = await api.register({ email, password });
      setToken(res.token);
      flash(true, 'Account created & logged in');
      refresh();
    } catch (e) {
      flash(false, e.message);
    }
  };

  const saveKeys = async () => {
    try {
      await api.saveBinanceKeys({ apiKey: binanceKey, apiSecret: binanceSecret });
      flash(true, 'API keys saved (AES-256 encrypted)');
      setBinanceKey('');
      setBinanceSecret('');
    } catch (e) {
      flash(false, e.message);
    }
  };

  const startDca = async () => {
    try {
      await api.dca({ symbol: dcaSymbol, amount: Number(dcaAmount), intervalMs: Number(dcaInterval) });
      flash(true, `DCA started for ${dcaSymbol}`);
    } catch (e) {
      flash(false, e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div
        className="card my-8 w-full max-w-lg space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="btn-ghost px-2">✕</button>
        </div>

        {message && (
          <div className={'rounded-lg px-3 py-2 text-sm ' + (message.ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400')}>
            {message.text}
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Server</h3>
          <p className="text-xs text-gray-400">
            Backend URL for this app. Leave empty to use the built-in default.
            Required when running the APK against your own deployed backend.
          </p>
          <input
            className="input"
            placeholder="https://your-backend.example.com"
            value={backendUrl}
            onChange={(e) => setBackendUrlState(e.target.value)}
          />
          <button className="btn-ghost w-full" onClick={saveBackendUrl}>Save server URL</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Account {me ? `— ${me.email}` : ''}</h3>
          <input className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className="input" placeholder="2FA code (if enabled)" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={login}>Login</button>
            <button className="btn-ghost flex-1" onClick={register}>Register</button>
            {getToken() && (
              <button className="btn-ghost" onClick={() => { setToken(null); setMe(null); flash(true, 'Logged out'); }}>Logout</button>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Binance API Keys (encrypted at rest)</h3>
          <input className="input" placeholder="API key" value={binanceKey} onChange={(e) => setBinanceKey(e.target.value)} />
          <input className="input" type="password" placeholder="API secret" value={binanceSecret} onChange={(e) => setBinanceSecret(e.target.value)} />
          <button className="btn-primary w-full" onClick={saveKeys}>Save keys</button>
          {me && (
            <p className="text-xs text-gray-400">
              {me.hasBinanceCredentials ? '✅ Credentials stored (AES-256-GCM)' : 'No credentials stored yet'}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Dollar-Cost Averaging</h3>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Symbol" value={dcaSymbol} onChange={(e) => setDcaSymbol(e.target.value.toUpperCase())} />
            <input className="input flex-1" type="number" placeholder="Amount ($)" value={dcaAmount} onChange={(e) => setDcaAmount(e.target.value)} />
          </div>
          <select className="input" value={dcaInterval} onChange={(e) => setDcaInterval(e.target.value)}>
            <option value="900000">Every 15 min</option>
            <option value="3600000">Every hour</option>
            <option value="14400000">Every 4 hours</option>
            <option value="86400000">Every day</option>
          </select>
          <button className="btn-green w-full" onClick={startDca}>Start DCA bot</button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Risk Parameters</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
              <div className="text-gray-400">Max position</div>
              <div className="font-medium">{(risk?.maxPositionPct * 100).toFixed(1)}% of equity</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
              <div className="text-gray-400">Daily loss limit</div>
              <div className="font-medium">{(risk?.dailyLoss?.limitPct * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
              <div className="text-gray-400">Max open positions</div>
              <div className="font-medium">{risk?.maxOpenPositions}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
              <div className="text-gray-400">Kill switch</div>
              <div className={'font-medium ' + (risk?.killSwitch?.triggered ? 'text-red-500' : 'text-emerald-500')}>
                {risk?.killSwitch?.triggered ? 'ARMED' : 'disarmed'}
              </div>
            </div>
          </div>
          {risk?.killSwitch?.triggered && (
            <button className="btn-ghost w-full" onClick={async () => { await api.killReset(); refresh(); }}>Reset kill switch</button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Appearance</h3>
          <button className="btn-ghost w-full" onClick={onToggleTheme}>
            Switch to {theme === 'dark' ? 'light' : 'dark'} theme
          </button>
        </section>
      </div>
    </div>
  );
}
