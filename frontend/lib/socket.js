import { io } from 'socket.io-client';
import { getApiBase, isDemoMode } from './api';
import { demoSocket } from './demo';

/**
 * Socket.io singleton. Connects to the backend websocket server and subscribes
 * to the market/order streams for the active symbols.
 *
 * The server URL is resolved the same way as the REST API (runtime override →
 * build-time env → same origin), so a Capacitor APK can point at any backend.
 */
let socket = null;

function resolveUrl() {
  const base = getApiBase();
  return base || (typeof window !== 'undefined' ? window.location.origin : '');
}

export function getSocket() {
  if (typeof window === 'undefined') return null;
  // In demo mode the built-in engine drives a local EventEmitter that speaks
  // the same Socket.io event protocol the UI already listens to.
  if (isDemoMode()) return demoSocket;

  const url = resolveUrl();

  if (socket && socket.io?.uri !== url) {
    socket.close();
    socket = null;
  }

  if (socket) return socket;

  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    const topics = [
      'ticker:BTCUSDT', 'ticker:ETHUSDT', 'ticker:SOLUSDT', 'ticker:BNBUSDT',
      'kline:BTCUSDT', 'kline:ETHUSDT', 'kline:SOLUSDT', 'kline:BNBUSDT',
      'depth:BTCUSDT', 'depth:ETHUSDT', 'depth:SOLUSDT', 'depth:BNBUSDT',
    ];
    socket.emit('subscribe', topics);
  });

  return socket;
}

/** Force-reconnect after the backend URL is changed in settings. */
export function reconnectSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
  return getSocket();
}

export function subscribeToSymbols(symbols) {
  const s = getSocket();
  if (!s) return;
  const topics = [];
  for (const sym of symbols) {
    topics.push(`ticker:${sym}`, `kline:${sym}`, `depth:${sym}`);
  }
  s.emit('subscribe', topics);
}

export default getSocket;
