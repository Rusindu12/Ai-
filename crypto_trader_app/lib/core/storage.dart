import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Encrypted on-device storage (Android Keystore backed).
///
/// Stores the JWT pair and device id. Binance API keys are **never** written
/// here: they live only in memory for the seconds it takes to hand them to the
/// backend (see `BinanceKeyVault`).
class SecureStore {
  SecureStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(
                encryptedSharedPreferences: true,
                resetOnError: true,
              ),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  static const _accessToken = 'access_token';
  static const _refreshToken = 'refresh_token';
  static const _deviceId = 'device_id';
  static const _userEmail = 'user_email';
  static const _userPassword = 'user_password';
  static const _fcmToken = 'fcm_token';

  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } on Exception {
      return null;
    }
  }

  Future<void> write(String key, String value) async {
    try {
      await _storage.write(key: key, value: value);
    } on Exception {
      // A broken keystore must not crash the app; the user just re-auths.
    }
  }

  Future<void> delete(String key) async {
    try {
      await _storage.delete(key: key);
    } on Exception {
      // ignore
    }
  }

  Future<void> saveSession({required String access, required String refresh, String? email, String? password}) async {
    await write(_accessToken, access);
    await write(_refreshToken, refresh);
    if (email != null) await write(_userEmail, email);
    if (password != null) {
      await write(_userPassword, password);
    }
  }

  Future<void> clearSession({bool keepCredentials = true}) async {
    await delete(_accessToken);
    await delete(_refreshToken);
    if (!keepCredentials) {
      await delete(_userPassword);
    }
  }

  Future<String?> get accessToken => read(_accessToken);
  Future<String?> get refreshToken => read(_refreshToken);
  Future<String?> get savedEmail => read(_userEmail);
  Future<String?> get savedPassword => read(_userPassword);
  Future<String?> get fcmToken => read(_fcmToken);
  Future<void> saveFcmToken(String token) => write(_fcmToken, token);

  /// Stable per-install id used for device tracking and refresh-token binding.
  Future<String> deviceId() async {
    final existing = await read(_deviceId);
    if (existing != null && existing.isNotEmpty) return existing;
    final now = DateTime.now().microsecondsSinceEpoch;
    final rand = DateTime.now().millisecondsSinceEpoch.remainder(1000000);
    final id = 'dev-$now-$rand';
    await write(_deviceId, id);
    return id;
  }
}

/// Plain key/value settings + a small offline cache (last-seen prices) so the
/// dashboard paints instantly on a cold start even before the stream connects.
class LocalStore {
  LocalStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<LocalStore> open() async => LocalStore(await SharedPreferences.getInstance());

  String? get theme => _prefs.getString('settings.theme');
  Future<void> setTheme(String value) => _prefs.setString('settings.theme', value);

  String? get locale => _prefs.getString('settings.locale');
  Future<void> setLocale(String value) => _prefs.setString('settings.locale', value);

  bool get biometricEnabled => _prefs.getBool('settings.biometric') ?? true;
  Future<void> setBiometric(bool value) => _prefs.setBool('settings.biometric', value);

  bool get paperTrading => _prefs.getBool('trading.paper') ?? true;
  Future<void> setPaperTrading(bool value) => _prefs.setBool('trading.paper', value);

  String get defaultSymbol => _prefs.getString('trade.symbol') ?? 'BTCUSDT';
  Future<void> setDefaultSymbol(String value) => _prefs.setString('trade.symbol', value);

  String get defaultInterval => _prefs.getString('trade.interval') ?? '1m';
  Future<void> setDefaultInterval(String value) => _prefs.setString('trade.interval', value);

  List<String> get watchedSymbols {
    final raw = _prefs.getString('watchlist.local');
    if (raw == null || raw.isEmpty) return const ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    try {
      return (jsonDecode(raw) as List).map((e) => e.toString()).toList(growable: false);
    } on FormatException {
      return const ['BTCUSDT'];
    }
  }

  Future<void> setWatchedSymbols(List<String> symbols) =>
      _prefs.setString('watchlist.local', jsonEncode(symbols));

  Map<String, dynamic> get cachedPrices {
    final raw = _prefs.getString('cache.prices');
    if (raw == null) return const {};
    try {
      return (jsonDecode(raw) as Map).cast<String, dynamic>();
    } on FormatException {
      return const {};
    }
  }

  Future<void> saveCachedPrices(Map<String, dynamic> prices) async {
    if (prices.length > 60) return;
    await _prefs.setString('cache.prices', jsonEncode(prices));
  }

  DateTime? get lastSeenAt {
    final ms = _prefs.getInt('security.last_seen');
    return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms);
  }

  Future<void> touch() => _prefs.setInt('security.last_seen', DateTime.now().millisecondsSinceEpoch);

  int? get lastUserId => _prefs.getInt('auth.user_id');
  Future<void> setLastUserId(int id) => _prefs.setInt('auth.user_id', id);
  Future<void> clearLastUserId() => _prefs.remove('auth.user_id');

  double get aiMinConfidence => _prefs.getDouble('ai.min_confidence') ?? 65;
  Future<void> setAiMinConfidence(double v) => _prefs.setDouble('ai.min_confidence', v);

  bool get executeFromSignal => _prefs.getBool('ai.execute_from_signal') ?? false;
  Future<void> setExecuteFromSignal(bool v) => _prefs.setBool('ai.execute_from_signal', v);
}
