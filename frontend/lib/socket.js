import { io } from 'socket.io-client';

/**
 * Socket.io singleton. Connects to the backend websocket server and
 * subscribes to the market/order streams for the active symbols.
 */
let socket = null;

export function getSocket() {
  if (typeof window === 'undefined') return null;
  if (socket) return socket;

  const url = process.env.NEXT_PUBLIC_WS_URL || window.location.origin;
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    const topics = ['ticker:BTCUSDT', 'ticker:ETHUSDT', 'ticker:SOLUSDT', 'ticker:BNBUSDT',
      'kline:BTCUSDT', 'kline:ETHUSDT', 'kline:SOLUSDT', 'kline:BNBUSDT',
      'depth:BTCUSDT', 'depth:ETHUSDT', 'depth:SOLUSDT', 'depth:BNBUSDT'];
    socket.emit('subscribe', topics);
  });

  return socket;
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
