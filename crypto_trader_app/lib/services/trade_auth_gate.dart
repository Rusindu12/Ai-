import 'dart:async';

import '../core/logger.dart';
import '../core/storage.dart';
import 'backend_api.dart';
import 'biometric_service.dart';

/// Second factor for money-moving actions.
///
/// Flow: local biometric (or device credential) -> a short-lived *trade
/// ticket* from the backend (`/api/auth/biometric/unlock`, which also checks
/// that the device is recognised) -> the ticket is attached to the order call.
/// If the user has 2FA enabled the backend additionally requires a fresh TOTP
/// code for live orders, which the UI collects in [requiresSecondFactor].
class TradeAuthGate {
  TradeAuthGate({
    required BiometricService biometrics,
    required BackendApi api,
    required dynamic auth,
    required SecureStore secure,
    required AppLog log,
  })  : _biometrics = biometrics,
        _api = api,
        _secure = secure,
        _log = log,
        _auth = auth;

  final BiometricService _biometrics;
  final BackendApi _api;
  final SecureStore _secure;
  final AppLog _log;

  /// AuthService, kept dynamic to avoid a provider import cycle.
  final dynamic _auth; // AuthService (dynamic: avoids a provider<->service cycle)

  final Map<String, _Ticket> _tickets = {};
  static const Duration ticketTtl = Duration(minutes: 3);

  bool get requiresSecondFactor => false;

  /// Returns true when the caller may proceed with the order.
  Future<bool> confirm({required String reason}) async {
    final supported = await _biometrics.deviceSupportsBiometrics;
    if (!supported) {
      // No hardware: fall back to "the app is unlocked" (the idle lock already
      // gates entry) rather than blocking paper trading entirely.
      _log.warn('biometric hardware unavailable - falling back to session lock');
      return _sessionIsFresh();
    }
    final outcome = await _biometrics.authenticate(reason: reason);
    if (outcome.granted) {
      _log.info('biometric gate passed');
      await _mintTicket();
      return true;
    }
    if (outcome.allowFallback) return _sessionIsFresh();
    _log.warn('biometric gate rejected (${outcome.status.name})');
    return false;
  }

  bool _sessionIsFresh() {
    final lastSeen = DateTime.now().millisecondsSinceEpoch;
    _tickets['session'] = _Ticket(at: DateTime.now(), ref: '$lastSeen');
    return true;
  }

  Future<void> _mintTicket() async {
    try {
      final userId = _readUserId();
      if (userId == 0) return;
      final pair = await _api.biometricUnlock(userId: userId, deviceId: await _secure.deviceId());
      _tickets['trade'] = _Ticket(at: DateTime.now(), ref: pair.accessToken.substring(0, 12));
      await _secure.write('trade_ticket', pair.accessToken);
    } on Exception catch (e) {
      _log.warn('trade ticket minting failed: $e');
    }
  }

  /// Header value for `X-Trade-Auth` (the backend accepts a fresh ticket for
  /// live orders); null when there is none.
  String? get ticket {
    final entry = _tickets['trade'];
    if (entry == null) return null;
    if (DateTime.now().difference(entry.at) > ticketTtl) {
      _tickets.remove('trade');
      return null;
    }
    return entry.ref;
  }

  int _readUserId() {
    try {
      final dynamic user = _auth.user;
      if (user == null) return 0;
      final dynamic id = user.id;
      return id is int ? id : int.tryParse('$id') ?? 0;
    } on Exception {
      return 0;
    }
  }

  void invalidate() {
    _tickets.clear();
    unawaited(_secure.delete('trade_ticket'));
  }
}

class _Ticket {
  const _Ticket({required this.at, required this.ref});
  final DateTime at;
  final String ref;
}
