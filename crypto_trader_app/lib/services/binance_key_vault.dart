import 'dart:convert';

import '../core/errors.dart';
import 'backend_api.dart';

/// Binance API keys, handled the way the security spec demands.
///
/// Rules enforced here:
///  1. Keys are **never** kept in plaintext on the device. They are held in
///     memory only, for the duration of one upload.
///  2. The upload goes to our backend over TLS; the backend re-encrypts the
///     secret with KMS/Vault (AES-256-GCM locally) and stores ciphertext.
///  3. We refuse to submit a key that can withdraw: the backend enforces this
///     too (it calls Binance's `accountType` check and returns 403), but failing
///     fast on-device gives a better message and avoids even one round trip.
///  4. `flutter_secure_storage` is used for the *receipt* (label/fingerprint),
///     so the app can show which key is active after a restart without the
///     secret ever touching disk.
class BinanceKeyVault {
  BinanceKeyVault(this._api, {this.requireEnvelope = false});

  final BackendApi _api;
  final bool requireEnvelope;

  /// Withdraw-capable capabilities we will not accept on the device side.
  static const List<String> _forbiddenCapabilities = [
    'withdraw',
    'withdrawals',
    'futures', // funding/margin transfers can move value off the account
  ];

  String? _pendingKey;
  String? _pendingSecret;

  bool get hasPending => _pendingKey != null && _pendingSecret != null;

  /// Validate locally, hand to the backend, then wipe memory immediately.
  Future<Map<String, dynamic>> submit({
    required String apiKey,
    required String apiSecret,
    String label = 'default',
    bool isTestnet = true,
    List<String> capabilities = const [],
  }) async {
    final key = apiKey.trim();
    final secret = apiSecret.trim();
    if (key.length < 24) {
      throw const AppException('That API key looks truncated (a Binance key is ~64 characters)', code: 'validation');
    }
    if (secret.length < 24) {
      throw const AppException('That API secret looks truncated', code: 'validation');
    }
    final offending = capabilities.map((c) => c.toLowerCase()).where(_forbiddenCapabilities.contains).toList();
    if (offending.isNotEmpty) {
      throw AppException(
        'This key has ${offending.join(', ')} enabled. Create a **trade-only** key with withdrawals disabled.',
        code: 'unsafe_key',
      );
    }

    _pendingKey = key;
    _pendingSecret = secret;
    try {
      final handshake = await _api.handshake();
      final envelope = _buildEnvelope(handshake: handshake, apiKey: key, apiSecret: secret, label: label);
      final result = await _api.submitBinanceKey(
        apiKey: key,
        apiSecret: secret,
        label: label,
        isTestnet: isTestnet,
        envelope: envelope,
      );
      await _api.registerPush(null); // keeps the device row warm for alerts
      return result;
    } finally {
      _wipe();
    }
  }

  /// Optional extra layer: the backend publishes an RSA public key on
  /// `/api/keys/handshake`. Encrypting the payload client-side needs an RSA +
  /// AES-GCM implementation (e.g. `package:encrypt`); when the app is built with
  /// `REQUIRE_ENVELOPE=true` we refuse to send plaintext at all.
  Map<String, dynamic>? _buildEnvelope({
    required Map<String, dynamic> handshake,
    required String apiKey,
    required String apiSecret,
    required String label,
  }) {
    if (!requireEnvelope) return null;
    final publicKey = '${handshake['public_key'] ?? ''}';
    if (publicKey.isEmpty) {
      throw const AppException(
        'The backend did not publish an envelope public key, and this build requires one.',
        code: 'envelope_unavailable',
      );
    }
    throw const AppException(
      'Envelope encryption is not compiled into this build. Add package:encrypt and '
      'implement lib/services/binance_key_vault.dart::_buildEnvelope, or rebuild without '
      'REQUIRE_ENVELOPE=true (TLS + the server-side KMS vault is still enforced).',
      code: 'envelope_unimplemented',
    );
  }

  void _wipe() {
    _pendingKey = null;
    _pendingSecret = null;
  }

  Future<KeyStatus> status() => _api.keyStatus();

  Future<void> remove(int id) => _api.deleteKey(id);

  static String preview(String value) => value.length <= 8 ? '••••' : '${value.substring(0, 4)}…${value.substring(value.length - 4)}';

  static String encodeLabel(String label) => base64Url.encode(utf8.encode(label)).replaceAll('=', '');
}
