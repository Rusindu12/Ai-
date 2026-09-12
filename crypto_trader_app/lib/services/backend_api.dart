import 'dart:convert';

import '../core/errors.dart';
import '../models/ai.dart';
import '../models/app_user.dart';
import '../models/models.dart';
import '../models/trading.dart';
import 'api_client.dart';

/// Typed wrapper over the backend HTTP contract (76 routes; the app uses the
/// ones it needs). Every method here maps 1:1 to a FastAPI endpoint.
class BackendApi {
  BackendApi(this._http);

  final ApiClient _http;

  ApiClient get raw => _http;

  // ------------------------------------------------------------------ auth --
  Future<Session> signup({required String email, required String password, required String name, String? deviceId}) async {
    final json = await _http.post('/auth/signup', body: {
      'email': email,
      'password': password,
      'name': name,
      if (deviceId != null) 'device_id': deviceId,
    });
    return Session.fromJson(json);
  }

  Future<Session> login({
    required String email,
    required String password,
    String? totpCode,
    String? deviceId,
  }) async {
    final json = await _http.post('/auth/login', body: {
      'email': email,
      'password': password,
      if (totpCode != null && totpCode.isNotEmpty) 'totp_code': totpCode,
      if (deviceId != null) 'device_id': deviceId,
    });
    return Session.fromJson(json);
  }

  Future<Session> loginWithGoogle({required String idToken, String? deviceId}) async {
    final json = await _http.post('/auth/google', body: {
      'id_token': idToken,
      if (deviceId != null) 'device_id': deviceId,
    });
    return Session.fromJson(json);
  }

  Future<Session> loginWithFirebase({required String firebaseToken, String? fcmToken, String? deviceId}) async {
    final json = await _http.post('/auth/firebase', body: {
      'firebase_token': firebaseToken,
      if (fcmToken != null) 'fcm_token': fcmToken,
      if (deviceId != null) 'device_id': deviceId,
    });
    return Session.fromJson(json);
  }

  Future<TokenPair> biometricUnlock({required int userId, String? deviceId}) async {
    final json = await _http.post('/auth/biometric/unlock', body: {
      'user_id': userId,
      if (deviceId != null) 'device_id': deviceId,
    });
    return TokenPair.fromJson(json);
  }

  Future<TokenPair> refreshSession(String refreshToken, {String? deviceId}) async {
    final json = await _http.post('/auth/refresh', body: {
      'refresh_token': refreshToken,
      if (deviceId != null) 'device_id': deviceId,
    });
    return TokenPair.fromJson(json);
  }

  Future<void> logout({String? refreshToken}) => _http.post('/auth/logout', body: {
        if (refreshToken != null) 'refresh_token': refreshToken,
      });

  Future<void> logoutEverywhere() => _http.post('/auth/logout-all');

  Future<AppUser> me() async => AppUser.fromJson(await _http.get('/auth/me'));

  Future<ServerConfig> authConfig() async => ServerConfig.fromJson(await _http.get('/auth/config'));

  Future<void> changePassword({required String currentPassword, required String newPassword}) =>
      _http.post('/auth/password', body: {'current_password': currentPassword, 'new_password': newPassword});

  Future<Map<String, dynamic>> setup2fa() => _http.post('/auth/2fa/setup');

  Future<Map<String, dynamic>> enable2fa(String code) => _http.post('/auth/2fa/enable', body: {'code': code});

  Future<Map<String, dynamic>> disable2fa(String password, String code) =>
      _http.post('/auth/2fa/disable', body: {'password': password, 'code': code});

  Future<List<Map<String, dynamic>>> listDevices() async =>
      asListHelper(await _http.get('/auth/devices'), 'devices');

  Future<void> revokeDevice(String deviceId) => _http.delete('/auth/devices/$deviceId');

  // ------------------------------------------------------------------ keys --
  Future<Map<String, dynamic>> handshake() => _http.get('/keys/handshake');

  Future<Map<String, dynamic>> submitBinanceKey({
    required String apiKey,
    required String apiSecret,
    String label = 'default',
    bool isTestnet = true,
    Map<String, dynamic>? envelope,
  }) =>
      _http.post('/keys/binance', body: {
        if (envelope == null) 'api_key': apiKey,
        if (envelope == null) 'api_secret': apiSecret,
        if (envelope != null) 'envelope': envelope,
        'label': label,
        'is_testnet': isTestnet,
        'delete_local': true,
      });

  Future<KeyStatus> keyStatus() async => KeyStatus.fromJson(await _http.get('/keys'));

  Future<Map<String, dynamic>> verifyKey(int id) => _http.post('/keys/verify', body: {'credential_id': id});

  Future<void> deleteKey(int id) => _http.delete('/keys/binance/$id');

  // ----------------------------------------------------------------- market --
  Future<List<Ticker>> prices({List<String>? symbols}) async {
    final json = await _http.get('/prices', query: {
      if (symbols != null && symbols.isNotEmpty) 'symbols': symbols.join(','),
    });
    return asMapListHelper(json['prices']).map(Ticker.fromJson).toList(growable: false);
  }

  Future<Ticker> price(String symbol) async => Ticker.fromJson(await _http.get('/prices/$symbol'));

  Future<KlinePage> klines(String symbol, String interval, {int limit = 300, bool withIndicators = false}) async {
    final json = await _http.get('/klines/$symbol/$interval', query: {
      'limit': '$limit',
      if (withIndicators) 'with_indicators': 'true',
    });
    return KlinePage.fromJson(json);
  }

  Future<OrderBook> orderbook(String symbol, {int depth = 20}) async =>
      OrderBook.fromJson(await _http.get('/orderbook/$symbol', query: {'depth': '$depth'}));

  Future<List<double>> sparklines() async {
    final json = await _http.get('/sparklines', query: {'points': '32'});
    final series = (json['series'] as Map?)?.cast<String, dynamic>() ?? const {};
    // Dashboard uses the map directly; this returns BTC-ish order for fallback.
    return series.values
        .whereType<List>()
        .expand((e) => e)
        .map((e) => double.tryParse('$e') ?? 0)
        .take(32)
        .toList(growable: false);
  }

  Future<Map<String, List<double>>> sparklineSeries() async {
    final json = await _http.get('/sparklines', query: {'points': '32'});
    final series = (json['series'] as Map?)?.cast<String, dynamic>() ?? const {};
    return series.map(
      (key, value) => MapEntry(
        key,
        (value as List?)?.map((e) => double.tryParse('$e') ?? 0).toList(growable: false) ?? const <double>[],
      ),
    );
  }

  Future<List<SymbolInfo>> symbols() async {
    final json = await _http.get('/symbols');
    return asMapListHelper(json['symbols']).map(SymbolInfo.fromJson).toList(growable: false);
  }

  Future<MarketSummary> marketSummary() async => MarketSummary.fromJson(await _http.get('/market/summary'));

  Future<List<TradeTickRow>> recentTrades(String symbol, {int limit = 40}) async {
    final json = await _http.get('/recent-trades/$symbol', query: {'limit': '$limit'});
    return asMapListHelper(json['trades']).map(TradeTickRow.fromJson).toList(growable: false);
  }

  Future<List<WatchItem>> watchlist() async {
    final json = await _http.get('/watchlist');
    return asMapListHelper(json['watchlist']).map(WatchItem.fromJson).toList(growable: false);
  }

  Future<void> addWatch(String symbol, {String note = ''}) => _http.post('/watchlist', body: {'symbol': symbol, 'note': note});

  Future<void> removeWatch(String symbol) => _http.delete('/watchlist/$symbol');

  // ---------------------------------------------------------------- account --
  Future<AccountSnapshot> account() async => AccountSnapshot.fromJson(await _http.get('/account'));

  Future<List<OpenPosition>> positions() async {
    final json = await _http.get('/account/positions');
    return asMapListHelper(json['positions']).map(OpenPosition.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> allocation() => _http.get('/portfolio/allocation');

  Future<List<EquityPoint>> portfolioHistory({int days = 30}) async {
    final json = await _http.get('/portfolio/history', query: {'days': '$days'});
    return asMapListHelper(json['points'])
        .map((row) => EquityPoint(
              t: DateTime.tryParse('${row['date']}')?.millisecondsSinceEpoch ?? 0,
              equity: double.tryParse('${row['equity']}') ?? 0,
              position: '',
            ))
        .toList(growable: false);
  }

  Future<List<int>> exportCsv({int days = 90}) => _http.getBytes('/export/csv', query: {'days': '$days'});

  Future<void> resetPaper() => _http.post('/account/paper/reset', body: {'confirm': true});

  // ----------------------------------------------------------------- orders --
  Future<OrderPreview> previewOrder(Map<String, dynamic> payload) async =>
      OrderPreview.fromJson(await _http.post('/order/preview', body: payload));

  Future<OrderResult> placeOrder(Map<String, dynamic> payload) async =>
      OrderResult.fromJson(await _http.post('/order', body: payload));

  Future<Map<String, dynamic>> placeBulk(List<Map<String, dynamic>> orders) =>
      _http.post('/order/bulk', body: {'orders': orders});

  Future<List<TradeRow>> openOrders({String? symbol}) async {
    final json = await _http.get('/orders', query: {if (symbol != null) 'symbol': symbol});
    return asMapListHelper(json['orders']).map(TradeRow.fromJson).toList(growable: false);
  }

  Future<OrderResult> cancelOrderByRef(String ref) async => OrderResult.fromJson(await _http.delete('/order/$ref'));

  Future<List<TradeRow>> history({int limit = 60, int offset = 0, String? symbol}) async {
    final json = await _http.get('/trades', query: {
      'limit': '$limit',
      'offset': '$offset',
      if (symbol != null) 'symbol': symbol,
    });
    return asMapListHelper(json['trades']).map(TradeRow.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> tradeSummary() => _http.get('/trades/summary');

  // --------------------------------------------------------------------- ai --
  Future<AiSignal> signal(String symbol, {String interval = '1m', int bars = 400}) async {
    final json = await _http.get('/ai/signal/$symbol', query: {'interval': interval, 'bars': '$bars'});
    return AiSignal.fromJson(json);
  }

  Future<List<SymbolSignal>> batchSignals({String interval = '15m'}) async {
    final json = await _http.get('/ai/signals', query: {'interval': interval});
    return asMapListHelper(json['signals']).map(SymbolSignal.fromJson).toList(growable: false);
  }

  Future<MarketSentiment> sentiment() async => MarketSentiment.fromJson(await _http.get('/ai/sentiment'));

  Future<Indicators> indicators(String symbol, String interval) async =>
      Indicators.fromJson(await _http.get('/ai/indicators/$symbol/$interval'));

  Future<ModelInfo> models() async => ModelInfo.fromJson(await _http.get('/ai/models'));

  Future<List<AiSignal>> signalHistory(String symbol, {int limit = 30}) async {
    final json = await _http.get('/ai/history/$symbol', query: {'limit': '$limit'});
    return asMapListHelper(json['signals']).map(AiSignal.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> train({String symbols = 'BTCUSDT,ETHUSDT', String interval = '1h', int epochs = 6}) =>
      _http.post('/ai/train', body: {
        'symbols': symbols.split(',').map((e) => e.trim()).toList(),
        'interval': interval,
        'epochs': epochs,
      });

  Future<List<StrategySpec>> strategies() async {
    final json = await _http.get('/ai/strategies');
    return asMapListHelper(json['strategies']).map(StrategySpec.fromJson).toList(growable: false);
  }

  Future<BacktestResult> backtest({
    required String symbol,
    String interval = '1h',
    int bars = 500,
    String strategy = 'ai_hybrid',
    double riskPerTrade = 1.0,
    double atrTpMult = 2.0,
    double atrSlMult = 1.5,
  }) async {
    final json = await _http.post('/ai/backtest', body: {
      'symbol': symbol,
      'interval': interval,
      'bars': bars,
      'strategy': strategy,
      'risk_per_trade': riskPerTrade,
      'atr_tp_mult': atrTpMult,
      'atr_sl_mult': atrSlMult,
      'include_curve': true,
    });
    return BacktestResult.fromJson(json);
  }

  Future<OrderResult> executeSignal(String symbol, {double? quantity, String? interval}) async =>
      OrderResult.fromJson(await _http.post('/ai/signal/$symbol/execute', body: {
        if (quantity != null) 'quantity': quantity,
        if (interval != null) 'interval': interval,
      }));

  // ------------------------------------------------------------------- auto --
  Future<AutoTraderStatus> autoStatus() async => AutoTraderStatus.fromJson(await _http.get('/auto'));

  Future<AutoTraderStatus> saveAutoConfig({
    required bool enabled,
    required List<String> symbols,
    required String riskLevel,
    required double maxTradeSizeUsd,
    required double dailyLossLimitUsd,
    double? minConfidencePct,
    int? intervalS,
  }) async {
    final json = await _http.put('/auto', body: {
      'enabled': enabled,
      'symbols': symbols,
      'risk_level': riskLevel,
      'max_trade_size_usd': maxTradeSizeUsd,
      'daily_loss_limit_usd': dailyLossLimitUsd,
      if (minConfidencePct != null) 'min_confidence_pct': minConfidencePct,
      if (intervalS != null) 'interval_s': intervalS,
    });
    return AutoTraderStatus.fromJson(json);
  }

  Future<Map<String, dynamic>> killSwitch({bool flatten = false, String reason = ''}) =>
      _http.post('/auto/stop', body: {'flatten': flatten, 'reason': reason});

  Future<Map<String, dynamic>> resumeAuto() => _http.post('/auto/resume');

  Future<Map<String, dynamic>> runCycle() => _http.post('/auto/cycle');

  Future<List<AutoTradeEntry>> autoLog({int limit = 40}) async {
    final json = await _http.get('/auto/log', query: {'limit': '$limit'});
    return asMapListHelper(json['entries']).map(AutoTradeEntry.fromJson).toList(growable: false);
  }

  Future<AutoPerformance> autoPerformance() async => AutoPerformance.fromJson(await _http.get('/auto/performance'));

  // ----------------------------------------------------------------- alerts --
  Future<List<PriceAlert>> alerts() async {
    final json = await _http.get('/alerts');
    return asMapListHelper(json['alerts']).map(PriceAlert.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> createAlert({
    required String symbol,
    required String operator,
    required double threshold,
    String direction = 'price',
    int cooldownS = 900,
    bool oneShot = false,
  }) =>
      _http.post('/alerts', body: {
        'symbol': symbol,
        'operator': operator,
        'threshold': threshold,
        'direction': direction,
        'cooldown_s': cooldownS,
        'one_shot': oneShot,
      });

  Future<Map<String, dynamic>> updateAlert(int id, {bool? active, double? threshold, String? operator, int? cooldownS}) =>
      _http.patch('/alerts/$id', body: {
        if (active != null) 'active': active,
        if (threshold != null) 'threshold': threshold,
        if (operator != null) 'operator': operator,
        if (cooldownS != null) 'cooldown_s': cooldownS,
      });

  Future<void> deleteAlert(int id) => _http.delete('/alerts/$id');

  Future<Map<String, dynamic>> testAlert(int id) => _http.post('/alerts/$id/test');

  Future<List<AppNotification>> notifications({int limit = 40}) async {
    final json = await _http.get('/notifications', query: {'limit': '$limit'});
    return asMapListHelper(json['notifications']).map(AppNotification.fromJson).toList(growable: false);
  }

  Future<Map<String, dynamic>> registerPush(String? token) => _http.post('/notifications/register', body: {
        'platform': 'android',
        if (token != null) 'token': token,
      });

  Future<Map<String, dynamic>> scanNotifications() => _http.post('/notifications/scan');

  Future<void> markNotificationsRead(List<int> ids) => _http.post('/notifications/read', body: {'ids': ids});

  // --------------------------------------------------------------- settings --
  Future<Map<String, dynamic>> settings() => _http.get('/settings');

  Future<Map<String, dynamic>> saveSettings({
    String? name,
    String? theme,
    String? locale,
    bool? paperTrading,
    String? riskLevel,
    double? maxTradeSizeUsd,
    double? dailyLossLimitUsd,
    bool? biometricEnabled,
    Map<String, dynamic>? notificationPrefs,
  }) =>
      _http.put('/settings', body: {
        if (name != null) 'name': name,
        if (theme != null) 'theme': theme,
        if (locale != null) 'locale': locale,
        if (paperTrading != null) 'paper_trading': paperTrading,
        if (riskLevel != null) 'risk_level': riskLevel,
        if (maxTradeSizeUsd != null) 'max_trade_size_usd': maxTradeSizeUsd,
        if (dailyLossLimitUsd != null) 'daily_loss_limit_usd': dailyLossLimitUsd,
        if (biometricEnabled != null) 'biometric_enabled': biometricEnabled,
        if (notificationPrefs != null) 'notification_prefs': notificationPrefs,
      });

  // ----------------------------------------------------------------- health --
  Future<Map<String, dynamic>> health() async {
    try {
      return await _http.get('/health');
    } on AppException {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> status() => _http.get('/status');
}

/// `GET /api/auth/*` token payload.
class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken, required this.expiresIn});
  final String accessToken;
  final String refreshToken;
  final int expiresIn;

  static TokenPair fromJson(Map<String, dynamic> json) => TokenPair(
        accessToken: '${json['access_token'] ?? ''}',
        refreshToken: '${json['refresh_token'] ?? ''}',
        expiresIn: int.tryParse('${json['expires_in'] ?? 0}') ?? 0,
      );
}

/// Login/signup response = token pair + user.
class Session {
  const Session({required this.tokens, required this.user});
  final TokenPair tokens;
  final AppUser user;

  static Session fromJson(Map<String, dynamic> json) => Session(
        tokens: TokenPair.fromJson(json),
        user: json['user'] is Map ? AppUser.fromJson((json['user'] as Map).cast<String, dynamic>()) : AppUser.empty,
      );
}

class StrategySpec {
  const StrategySpec({required this.key, required this.name, required this.description, required this.tags});
  final String key;
  final String name;
  final String description;
  final List<String> tags;

  static StrategySpec fromJson(Map<String, dynamic> json) => StrategySpec(
        key: '${json['key'] ?? ''}',
        name: '${json['name'] ?? json['key'] ?? ''}',
        description: '${json['description'] ?? ''}',
        tags: ((json['tags'] as List?) ?? const []).map((e) => '$e').toList(growable: false),
      );
}

/// A print of the tape from `GET /api/recent-trades/{symbol}`.
class TradeTickRow {
  const TradeTickRow({required this.price, required this.qty, required this.time, required this.buyerIsMaker});
  final double price;
  final double qty;
  final int time;
  final bool buyerIsMaker;

  bool get isBuy => !buyerIsMaker;

  static TradeTickRow fromJson(Map<String, dynamic> json) {
    bool flag(Object? v) => v == true || v == 'true' || v == 1;
    return TradeTickRow(
      price: double.tryParse('${json['price'] ?? json['p'] ?? 0}') ?? 0,
      qty: double.tryParse('${json['qty'] ?? json['q'] ?? json['volume'] ?? 0}') ?? 0,
      time: int.tryParse('${json['time'] ?? json['T'] ?? 0}') ?? 0,
      buyerIsMaker: flag(json['buyer_is_maker'] ?? json['m']),
    );
  }
}

List<Map<String, dynamic>> asMapListHelper(Object? value) {
  if (value is! List) return const [];
  return value.whereType<Map>().map((e) => e.cast<String, dynamic>()).toList(growable: false);
}

List<dynamic> asListHelper(Map<String, dynamic> json, String key) {
  final value = json[key];
  return value is List ? value : const [];
}

String encodeJson(Object? value) => jsonEncode(value);
