/// Build-time configuration, injected with `--dart-define`.
///
/// The app talks **only** to your own backend; the backend owns Binance.
/// Nothing secret (API keys, JWT secret) is ever compiled into the APK.
class AppConfig {
  const AppConfig._();

  /// REST base URL. Emulator -> http://10.0.2.2:8000 ; production -> https://api.your-domain.com
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  /// WebSocket base (ws/wss). Derived from [apiBaseUrl] when unset.
  static const String _wsBaseUrl = String.fromEnvironment('WS_BASE_URL', defaultValue: '');

  /// Certificate pinning (SSL pinning) is enabled when at least one SHA-256
  /// fingerprint of your leaf/intermediate SPKI is provided at build time.
  static const List<String> pinnedCertHashes = String.fromEnvironment('PIN_SHA256').isEmpty
      ? <String>[]
      : String.fromEnvironment('PIN_SHA256').split(',');

  /// Firebase project id (optional - the app degrades gracefully without it).
  static const String firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID', defaultValue: '');

  /// Google OAuth client id for Firebase Google sign-in (optional).
  static const String googleClientId = String.fromEnvironment('GOOGLE_CLIENT_ID', defaultValue: '');

  /// Set true to require the biometric trade gate even for paper trading.
  static const bool enforceBiometricForPaper = bool.fromEnvironment('ENFORCE_BIOMETRIC_PAPER', defaultValue: false);

  /// Seconds of inactivity after which the app locks itself (backend session
  /// timeout is independent and always enforced server side).
  static const int autoLogoutSeconds = int.fromEnvironment('AUTO_LOGOUT_SECONDS', defaultValue: 900);

  static bool get hasFirebase => firebaseProjectId.isNotEmpty;

  static Uri get wsUri {
    final raw = _wsBaseUrl.isNotEmpty ? _wsBaseUrl : apiBaseUrl;
    final uri = Uri.parse(raw);
    final scheme = uri.scheme == 'https' ? 'wss' : 'ws';
    return uri.replace(scheme: scheme, path: '/ws');
  }

  static String get restRoot {
    final uri = Uri.parse(apiBaseUrl);
    return uri.path.endsWith('/api') ? uri.toString() : '${uri.toString().replaceAll(RegExp(r'/+$'), '')}/api';
  }

  static bool get isProduction => Uri.parse(apiBaseUrl).scheme == 'https';

  /// Human readable target, shown in Settings so you always know where you're
  /// connected (demo vs live backend).
  static String get summary {
    final host = Uri.parse(apiBaseUrl).host;
    return '$host (${isProduction ? 'TLS' : 'plain HTTP - dev only'})';
  }
}
