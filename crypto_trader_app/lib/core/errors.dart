import 'dart:convert';

/// Errors surfaced to the UI, mapped from the backend's
/// `{"error","message","details","retry_after"}` error envelope.
class AppException implements Exception {
  const AppException(
    this.message, {
    this.code = 'error',
    this.statusCode,
    this.retryAfterSeconds,
    this.details = const {},
  });

  final String message;
  final String code;
  final int? statusCode;
  final int? retryAfterSeconds;
  final Map<String, dynamic> details;

  bool get isAuth => statusCode == 401 || code == 'invalid_credentials' || code == 'token_expired';
  bool get isNetwork => code == 'network' || code == 'timeout';
  bool get isRateLimited => statusCode == 429 || code == 'rate_limited';
  bool get isForbidden => statusCode == 403;

  factory AppException.fromResponse(int status, String body, {Map<String, String>? headers}) {
    var message = 'Request failed ($status)';
    var code = 'http_$status';
    var details = <String, dynamic>{};
    int? retryAfter;

    final decoded = _tryDecode(body);
    if (decoded is Map) {
      final rawMessage = decoded['message'] ?? decoded['detail'] ?? decoded['error'];
      if (decoded['error'] is String) code = decoded['error'] as String;
      if (rawMessage is String && rawMessage.isNotEmpty) message = rawMessage;
      if (decoded['details'] is Map) {
        details = (decoded['details'] as Map).cast<String, dynamic>();
        final errs = details['errors'];
        if (errs is List && errs.isNotEmpty && errs.first is Map) {
          final first = errs.first as Map;
          final loc = (first['loc'] as List?)?.join('.');
          message = 'Check input${loc == null ? '' : ' ($loc)'}: ${first['msg'] ?? first['type'] ?? 'invalid'}';
        }
      }
      if (decoded['retry_after'] is num) retryAfter = (decoded['retry_after'] as num).toInt();
    } else if (body.trim().isNotEmpty) {
      message = body.length > 180 ? '${body.substring(0, 180)}…' : body;
    }

    if (headers != null) {
      final ra = int.tryParse(headers['retry-after'] ?? '');
      if (ra != null) retryAfter = ra;
    }
    var explicitMessage = decoded is Map && (decoded['message'] is String || decoded['detail'] is String);
    if (status == 401 && !explicitMessage) message = 'Session expired — sign in again';
    if (status == 429 && !explicitMessage) {
      message = 'Too many requests — the backend rate limit is protecting your API weight';
    }
    if (status == 429) code = 'rate_limited';

    return AppException(
      message,
      code: code,
      statusCode: status,
      retryAfterSeconds: retryAfter,
      details: details,
    );
  }

  static Object? _tryDecode(String body) {
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }

  @override
  String toString() => 'AppException($code): $message';
}

/// One place that turns any thrown object into human text for snackbars.
String describeError(Object error) {
  if (error is AppException) {
    if (error.isNetwork) {
      return 'Cannot reach the backend. Check the API URL in Settings → Connection.';
    }
    if (error.isRateLimited) {
      return 'Rate limited — retry in ${error.retryAfterSeconds ?? 5}s';
    }
    return error.message;
  }
  final text = error.toString();
  return text.length > 220 ? '${text.substring(0, 220)}…' : text;
}
