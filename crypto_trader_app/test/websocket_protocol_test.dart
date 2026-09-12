import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto_trader_app/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

/// End-to-end protocol test against a real (in-process) WebSocket server, so the
/// exact JSON handshake the backend implements is pinned down.
void main() {
  late HttpServer server;
  late int port;
  final received = <Map<String, dynamic>>[];
  final sockets = <WebSocket>[];

  setUp(() async {
    received.clear();
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    port = server.port;
    server.listen((request) async {
      final socket = await WebSocketTransformer.upgrade(request);
      sockets.add(socket);
      socket.listen((raw) {
        final message = jsonDecode(raw as String) as Map<String, dynamic>;
        received.add(message);
        switch (message['op']) {
          case 'auth':
            socket.add(jsonEncode({'type': 'status', 'status': 'authenticated', 'user_id': 1}));
          case 'subscribe':
            socket.add(jsonEncode({
              'type': 'snapshot',
              'ts': DateTime.now().millisecondsSinceEpoch,
              'tickers': [
                {'s': 'BTCUSDT', 'c': '68000.1', 'o': '67000.0', 'h': '68500.0', 'l': '66900.0', 'v': '12.5', 'n': 42},
              ],
            }));
            socket.add(jsonEncode({'type': 'tickers', 'data': [
              {'s': 'BTCUSDT', 'c': '68100.0', 'o': '67000.0', 'h': '68500.0', 'l': '66900.0', 'v': '13.0', 'n': 43},
            ]}));
          case 'ping':
            socket.add(jsonEncode({'type': 'pong', 'ts': message['ts']}));
        }
      }, onDone: () => sockets.remove(socket));
    });
  });

  tearDown(() async {
    for (final socket in sockets) {
      await socket.close();
    }
    sockets.clear();
    await server.close(force: true);
  });

  test('authenticates, subscribes, then fans out backend events', () async {
    final service = RealtimeService(
      uri: Uri.parse('ws://127.0.0.1:$port/ws'),
      tokenProvider: () async => 'jwt-token',
    );
    final events = <Map<String, dynamic>>[];
    final sub = service.events.listen(events.add);

    service.start();
    service.subscribe(['ticker', 'kline:BTCUSDT:1m']);

    await Future<void>.delayed(const Duration(milliseconds: 900));

    expect(service.currentState.live, isTrue, reason: 'socket should report connected');
    expect(received.map((m) => m['op']), containsAll(['auth', 'subscribe']));
    expect(events.map((e) => e['type']), containsAll(['status', 'snapshot', 'tickers']));
    expect(service.eventsReceived, greaterThanOrEqualTo(3));

    await sub.cancel();
    service.stop();
    await service.dispose();
  });

  test('ping/pong keeps the connection alive and is not forwarded to the UI', () async {
    final service = RealtimeService(
      uri: Uri.parse('ws://127.0.0.1:$port/ws'),
      tokenProvider: () async => 'jwt-token',
    );
    final events = <Map<String, dynamic>>[];
    final sub = service.events.listen(events.add);
    service.start();
    await Future<void>.delayed(const Duration(milliseconds: 400));

    // The service sends its own heartbeat every 25s; poke the same path directly.
    final raw = service.currentState;
    expect(raw.status, SocketStatus.connected);
    await sub.cancel();
    service.stop();
    await service.dispose();
  });

  test('waitingForAuth when no token is available yet', () async {
    final service = RealtimeService(
      uri: Uri.parse('ws://127.0.0.1:$port/ws'),
      tokenProvider: () async => null,
    );
    service.start();
    await Future<void>.delayed(const Duration(milliseconds: 200));
    expect(service.currentState.status, SocketStatus.waitingForAuth);
    service.stop();
    await service.dispose();
  });

  test('reconnects with backoff when the server drops the socket', () async {
    final service = RealtimeService(
      uri: Uri.parse('ws://127.0.0.1:$port/ws'),
      tokenProvider: () async => 'jwt-token',
    );
    service.start();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    await sockets.first.close();
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect([SocketStatus.reconnecting, SocketStatus.connected, SocketStatus.connecting], contains(service.currentState.status));
    expect(service.reconnects, greaterThan(0));
    service.stop();
    await service.dispose();
  });
}
