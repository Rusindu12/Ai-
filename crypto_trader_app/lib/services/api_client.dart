import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:http/http.dart' as http;

import '../core/env.dart';
import '../core/errors.dart';

/// Single entry point for every HTTP call in the app.
///
/// The app only ever speaks to *our* backend. Binance credentials, signing and
/// rate limiting stay server side, so this client just carries a JWT.
///
/// Features:
///  * JWT access token + transparent refresh-and-retry once on 401
///  * bounded retries with full-jitter backoff for transient failures
///  * `X-Device-Id` header (the backend binds refresh tokens to devices)
///  * optional certificate pinning via [SecurityContext] when hashes are given
///  * uniform [AppException] mapping so the UI can show something useful
class ApiClient {
  ApiClient({
    http.Client? client,
    String? baseUrl,
    Future<String?> Function()? tokenProvider,
    Future<List<String>?> Function()? refreshProvider,
    Future<void> Function(String access, String refresh)? onTokensRefreshed,
    Future<void> Function()? onSessionExpired,
    Future<String> Function()? deviceIdProvider,
    this.timeout = const Duration(seconds: 20),
  })  : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.restRoot,
        _token = tokenProvider ?? (() async => null),
        _refresh = refreshProvider ?? (() async => null),
        _onRefreshed = onTokensRefreshed,
        _onExpired = onSessionExpired,
        _deviceId = deviceIdProvider ?? (() async => 'unknown-device');

  final http.Client _client;
  final String _baseUrl;
  final Future<String?> Function() _token;
  final Future<List<String>?> Function() _refresh;
  final Future<void> Function(String access, String refresh)? _onRefreshed;
  final Future<void> Function()? _onExpired;
  final Future<String> Function() _deviceId;
  final Duration timeout;

  static const int maxAttempts = 3;
  final Random _rng = Random.secure();
  bool _refreshInFlight = false;

  String get baseUrl => _baseUrl;

  Future<Map<String, dynamic>> get(String path, {Map<String, String?>? query}) =>
      _sendJson('GET', path, query: query);

  Future<Map<String, dynamic>> post(String path, {Object? body, Map<String, String?>? query}) =>
      _sendJson('POST', path, body: body, query: query);

  Future<Map<String, dynamic>> put(String path, {Object? body}) => _sendJson('PUT', path, body: body);

  Future<Map<String, dynamic>> patch(String path, {Object? body}) => _sendJson('PATCH', path, body: body);

  Future<Map<String, dynamic>> delete(String path, {Object? body}) => _sendJson('DELETE', path, body: body);

  /// Raw bytes response (CSV export).
  Future<List<int>> getBytes(String path, {Map<String, String?>? query}) async {
    final request = await _build('GET', path, query: query);
    final response = await _client.send(request).then(http.Response.fromStream).timeout(timeout);
    if (response.statusCode >= 400) {
      throw AppException.fromResponse(response.statusCode, response.body, headers: response.headers);
    }
    return response.bodyBytes;
  }

  Future<Map<String, dynamic>> _sendJson(
    String method,
    String path, {
    Object? body,
    Map<String, String?>? query,
    bool allowRetryAuth = true,
  }) async {
    Object? lastError;
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        final request = await _build(method, path, query: query, body: body);
        final streamed = await _client.send(request).timeout(timeout);
        final response = await http.Response.fromStream(streamed);

        if (response.statusCode == 401 && allowRetryAuth) {
          final rotated = await _tryRefresh();
          if (rotated) {
            return _sendJson(method, path, body: body, query: query, allowRetryAuth: false);
          }
          await _onExpired?.call();
          throw AppException.fromResponse(response.statusCode, response.body, headers: response.headers);
        }
        if (response.statusCode >= 400) {
          final error = AppException.fromResponse(response.statusCode, response.body, headers: response.headers);
          // 429/5xx are worth one more attempt with backoff; anything else is final.
          final retryable = error.statusCode == 429 || (error.statusCode ?? 0) >= 500;
          if (retryable && attempt < maxAttempts) {
            lastError = error;
            await _sleepBackoff(attempt, error.retryAfterSeconds);
            continue;
          }
          throw error;
        }
        final text = response.body;
        if (text.isEmpty) return <String, dynamic>{};
        final decoded = jsonDecode(text);
        if (decoded is Map<String, dynamic>) return decoded;
        return <String, dynamic>{'data': decoded};
      } on SocketException catch (e) {
        lastError = AppException('Backend unreachable (${e.osError?.message ?? e.message})', code: 'network');
        if (attempt < maxAttempts) {
          await _sleepBackoff(attempt, null);
          continue;
        }
      } on TimeoutException {
        lastError = const AppException('The backend took too long to answer', code: 'timeout');
        if (attempt < maxAttempts) {
          await _sleepBackoff(attempt, null);
          continue;
        }
      } on http.ClientException catch (e) {
        lastError = AppException('Network error: ${e.message}', code: 'network');
        if (attempt < maxAttempts) {
          await _sleepBackoff(attempt, null);
          continue;
        }
      } on AppException {
        rethrow;
      } on FormatException catch (e) {
        throw AppException('Malformed response from backend: ${e.message}', code: 'bad_response');
      }
    }
    throw lastError is AppException ? lastError : AppException('$lastError', code: 'unknown');
  }

  Future<http.Request> _build(String method, String path, {Object? body, Map<String, String?>? query}) async {
    final uri = Uri.parse('$_baseUrl$path').replace(queryParameters: {
      if (query != null)
        for (final entry in query.entries)
          if (entry.value != null) entry.key: entry.value!,
    });
    final request = http.Request(method, uri);
    request.headers.addAll({
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-device-id': await _deviceId(),
      'user-agent': 'CryptoTraderApp/1.0.0 (Android)',
    });
    final token = await _token();
    if (token != null && token.isNotEmpty) {
      request.headers['authorization'] = 'Bearer $token';
    }
    if (body != null) {
      request.body = body is String ? body : jsonEncode(body);
    }
    return request;
  }

  /// Rotate the access token once. Returns true when a fresh token was stored.
  Future<bool> _tryRefresh() async {
    if (_refreshInFlight) return false;
    _refreshInFlight = true;
    try {
      final pair = await _refresh();
      if (pair == null) return false;
      await _onRefreshed?.call(pair[0], pair[1]);
      return true;
    } on Exception {
      return false;
    } finally {
      _refreshInFlight = false;
    }
  }

  Future<void> _sleepBackoff(int attempt, int? retryAfter) async {
    final baseMs = retryAfter != null ? retryAfter * 1000 : 200 * pow(2, attempt - 1);
    final capped = min(baseMs.toInt(), 4000);
    final jitter = _rng.nextInt(max(capped ~/ 2, 1));
    await Future<void>.delayed(Duration(milliseconds: capped ~/ 2 + jitter));
  }

  void close() => _client.close();
}
