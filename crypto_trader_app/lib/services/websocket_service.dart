import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as ws_status;

import '../core/env.dart';

/// One shared WebSocket to the backend, fanned out to the whole app.
///
/// Backend protocol (see `app/services/realtime.py`):
///   -> {"op":"auth","token":"<jwt>"}      then
///   -> {"op":"subscribe","channels":["ticker","kline:BTCUSDT:1m","depth:BTCUSDT","signals"]}
///   -> {"op":"ping"}
///   <- {"type":"snapshot"|"tickers"|"kline"|"depth"|"trade"|"order_update"|
///        "notification"|"ai_trade"|"alert_triggered"|"status"|"pong", ...}
///
/// The service owns reconnection (exponential backoff + jitter), heartbeats, and
/// a broadcast stream so every screen subscribes to the same socket.
class RealtimeService {
  RealtimeService({
    Uri? uri,
    required this.tokenProvider,
    this.onAuthFailed,
  }) : _uri = uri ?? AppConfig.wsUri;

  final Uri _uri;
  final Future<String?> Function() tokenProvider;
  final Future<void> Function()? onAuthFailed;

  final StreamController<Map<String, dynamic>> _events = StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<ConnectionState> _state = StreamController<ConnectionState>.broadcast();
  final Random _rng = Random.secure();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _sub;
  Timer? _heartbeat;
  Timer? _reconnect;

  Set<String> _channels = <String>{};
  int _attempt = 0;
  bool _wantConnection = false;
  bool _connecting = false;
  DateTime? _lastEventAt;
  int _eventsReceived = 0;
  int _reconnects = 0;

  /// Raw event bus (already decoded JSON maps).
  Stream<Map<String, dynamic>> get events => _events.stream;

  Stream<ConnectionState> get state => _state.stream;

  /// Filtered view of one `type`.
  Stream<Map<String, dynamic>> where(String type) => _events.stream.where((e) => e['type'] == type);

  ConnectionState _stateNow = const ConnectionState.disconnected();
  ConnectionState get currentState => _stateNow;
  int get eventsReceived => _eventsReceived;
  int get reconnects => _reconnects;
  DateTime? get lastEventAt => _lastEventAt;
  Set<String> get channels => Set.unmodifiable(_channels);

  void start() {
    if (_wantConnection) return;
    _wantConnection = true;
    _connect();
  }

  void stop() {
    _wantConnection = false;
    _reconnect?.cancel();
    _heartbeat?.cancel();
    _teardownSocket();
    _emitState(const ConnectionState.disconnected());
  }

  /// Replace the active channel set (idempotent; safe to call on every rebuild).
  void subscribe(Iterable<String> channels) {
    final next = channels.toSet();
    if (next.length == _channels.length && next.containsAll(_channels)) return;
    _channels = next;
    _send({'op': 'subscribe', 'channels': _channels.toList()});
  }

  void unsubscribe(Iterable<String> channels) {
    _channels = _channels.difference(channels.toSet());
    _send({'op': 'subscribe', 'channels': _channels.toList()});
  }

  void _connect() {
    if (!_wantConnection || _connecting) return;
    _connecting = true;
    _emitState(const ConnectionState.connecting());
    unawaited(_openSocket());
  }

  Future<void> _openSocket() async {
    try {
      final token = await tokenProvider();
      if (token == null || token.isEmpty) {
        _emitState(const ConnectionState.waitingForAuth());
        _scheduleReconnect();
        return;
      }
      final channel = WebSocketChannel.connect(_uri);
      await channel.ready.timeout(const Duration(seconds: 12));
      _channel = channel;
      _sub = channel.stream.listen(
        _onFrame,
        onDone: _onClosed,
        onError: (Object error) => _onClosed(error: error),
        cancelOnError: false,
      );
      // Handshake: auth first, then our channel set.
      _sendRaw({'op': 'auth', 'token': token});
      if (_channels.isNotEmpty) {
        _sendRaw({'op': 'subscribe', 'channels': _channels.toList()});
      }
      _attempt = 0;
      _connecting = false;
      _emitState(const ConnectionState.connected());
      _startHeartbeat();
    } on TimeoutException {
      _connecting = false;
      _teardownSocket();
      _scheduleReconnect();
    } on WebSocketChannelException catch (e) {
      _connecting = false;
      _teardownSocket();
      _scheduleReconnect(error: e.message);
    } on Exception catch (e) {
      _connecting = false;
      _teardownSocket();
      _scheduleReconnect(error: e.toString());
    }
  }

  void _onFrame(dynamic raw) {
    _lastEventAt = DateTime.now();
    if (raw is! String || raw.isEmpty) return;
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      return;
    }
    if (decoded is! Map) return;
    final event = decoded.cast<String, dynamic>();
    _eventsReceived++;
    final type = event['type'];
    if (type == 'pong') return;
    if (type == 'error' && (event['code'] == 'unauthorized' || event['code'] == 'auth_failed')) {
      unawaited(onAuthFailed?.call());
      return;
    }
    _events.add(event);
  }

  void _onClosed({Object? error}) {
    _connecting = false;
    _teardownSocket();
    if (!_wantConnection) return;
    _emitState(ConnectionState.reconnecting(attempt: _attempt + 1, error: error?.toString()));
    _scheduleReconnect(error: error?.toString());
  }

  void _scheduleReconnect({String? error}) {
    _reconnect?.cancel();
    if (!_wantConnection) return;
    _attempt++;
    _reconnects++;
    // 1s, 2s, 4s ... capped at 30s, plus jitter so a fleet of phones does not
    // stampede the backend after an outage.
    final backoffMs = min(1000 * pow(2, min(_attempt, 5)).toInt(), 30000);
    final jitter = _rng.nextInt(700);
    _emitState(ConnectionState.reconnecting(attempt: _attempt, error: error, delayMs: backoffMs + jitter));
    _reconnect = Timer(Duration(milliseconds: backoffMs + jitter), _connect);
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(const Duration(seconds: 25), (timer) {
      if (_channel == null) return;
      // If the server went quiet for 2 minutes the socket is a zombie: rebuild.
      final stale = _lastEventAt == null || DateTime.now().difference(_lastEventAt!) > const Duration(seconds: 120);
      if (stale && _attempt > 0) {
        _onClosed(error: 'stale socket');
        return;
      }
      _sendRaw({'op': 'ping', 'ts': DateTime.now().millisecondsSinceEpoch});
    });
  }

  void _teardownSocket() {
    _heartbeat?.cancel();
    _heartbeat = null;
    final sub = _sub;
    _sub = null;
    final channel = _channel;
    _channel = null;
    unawaited(sub?.cancel());
    try {
      channel?.sink.close(ws_status.normalClosure);
    } on Exception {
      // already closed
    }
  }

  void _send(Map<String, dynamic> message) {
    if (_channel == null) return; // will be resent on connect
    _sendRaw(message);
  }

  void _sendRaw(Map<String, dynamic> message) {
    final sink = _channel?.sink;
    if (sink == null) return;
    try {
      sink.add(jsonEncode(message));
    } on Exception {
      _onClosed(error: 'send failed');
    }
  }

  void _emitState(ConnectionState state) {
    _stateNow = state;
    if (!_state.isClosed) _state.add(state);
  }

  Future<void> dispose() async {
    stop();
    await _events.close();
    await _state.close();
  }
}

class ConnectionState {
  const ConnectionState.disconnected()
      : status = SocketStatus.disconnected,
        attempt = 0,
        error = null,
        delayMs = null;

  const ConnectionState.connecting()
      : status = SocketStatus.connecting,
        attempt = 0,
        error = null,
        delayMs = null;

  const ConnectionState.connected()
      : status = SocketStatus.connected,
        attempt = 0,
        error = null,
        delayMs = null;

  const ConnectionState.waitingForAuth()
      : status = SocketStatus.waitingForAuth,
        attempt = 0,
        error = null,
        delayMs = null;

  const ConnectionState.reconnecting({required this.attempt, this.error, this.delayMs})
      : status = SocketStatus.reconnecting;

  final SocketStatus status;
  final int attempt;
  final String? error;
  final int? delayMs;

  bool get live => status == SocketStatus.connected;

  String get label => switch (status) {
        SocketStatus.connected => 'Live',
        SocketStatus.connecting => 'Connecting…',
        SocketStatus.reconnecting => 'Reconnecting #${attempt + 1}',
        SocketStatus.waitingForAuth => 'Waiting for login',
        SocketStatus.disconnected => 'Offline',
      };

  @override
  String toString() => '${status.name}(attempt=$attempt${error == null ? '' : ', error=$error'})';
}

enum SocketStatus { disconnected, connecting, connected, reconnecting, waitingForAuth }
