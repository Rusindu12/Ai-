import '../core/json.dart';

/// `GET /api/auth/me`, and the `user` object inside login responses.
class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.paperTrading,
    required this.riskLevel,
    required this.maxTradeSizeUsd,
    required this.dailyLossLimitUsd,
    required this.biometricEnabled,
    required this.twoFactorEnabled,
    required this.theme,
    required this.locale,
    required this.hasExchangeKey,
    required this.autoTradeEnabled,
    required this.autoTradeSymbols,
    required this.killSwitch,
  });

  final int id;
  final String email;
  final String name;
  final String role;
  final bool paperTrading;
  final String riskLevel;
  final double maxTradeSizeUsd;
  final double dailyLossLimitUsd;
  final bool biometricEnabled;
  final bool twoFactorEnabled;
  final String theme;
  final String locale;
  final int hasExchangeKey;
  final bool autoTradeEnabled;
  final List<String> autoTradeSymbols;
  final bool killSwitch;

  static const AppUser empty = AppUser(
    id: 0,
    email: '',
    name: '',
    role: 'user',
    paperTrading: true,
    riskLevel: 'moderate',
    maxTradeSizeUsd: 250,
    dailyLossLimitUsd: 500,
    biometricEnabled: true,
    twoFactorEnabled: false,
    theme: 'dark',
    locale: 'en',
    hasExchangeKey: 0,
    autoTradeEnabled: false,
    autoTradeSymbols: [],
    killSwitch: false,
  );

  String get initials {
    final src = name.isNotEmpty ? name : email;
    final parts = src.split(RegExp(r'[\s@._-]+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  static AppUser fromJson(Map<String, dynamic> json) {
    final auto = asMap(json['auto_trade']);
    return AppUser(
      id: asInt(json['id']),
      email: asString(json['email']),
      name: asString(json['name']),
      role: asString(json['role'], fallback: 'user'),
      paperTrading: asBool(json['paper_trading'], fallback: true),
      riskLevel: asString(json['risk_level'], fallback: 'moderate'),
      maxTradeSizeUsd: asDouble(json['max_trade_size_usd'], fallback: 250),
      dailyLossLimitUsd: asDouble(json['daily_loss_limit_usd'], fallback: 500),
      biometricEnabled: asBool(json['biometric_enabled']),
      twoFactorEnabled: asBool(json['two_factor_enabled']),
      theme: asString(json['theme'], fallback: 'dark'),
      locale: asString(json['locale'], fallback: 'en'),
      hasExchangeKey: asInt(json['has_exchange_key']),
      autoTradeEnabled: asBool(auto['enabled']),
      autoTradeSymbols: asList(auto['symbols']).map((e) => e.toString()).toList(growable: false),
      killSwitch: asBool(auto['kill_switch']),
    );
  }
}

/// `GET /api/auth/config` - feature flags published by the backend.
class ServerConfig {
  const ServerConfig({
    required this.demoMode,
    required this.envelopeRequired,
    required this.minNotionalUsd,
    required this.autoLogoutMinutes,
    required this.accessTokenMinutes,
    required this.intervals,
    required this.markets,
    required this.integrityMode,
    required this.keyProvider,
    required this.websocket,
    required this.push,
    required this.biometric,
    required this.csvExport,
    required this.googleWebClientId,
    required this.backendVersion,
    required this.environment,
  });

  final bool demoMode;
  final bool envelopeRequired;
  final double minNotionalUsd;
  final int autoLogoutMinutes;
  final int accessTokenMinutes;
  final List<String> intervals;
  final List<String> markets;
  final String integrityMode;
  final String keyProvider;
  final bool websocket;
  final bool push;
  final bool biometric;
  final bool csvExport;
  final String googleWebClientId;
  final String backendVersion;
  final String environment;

  static const ServerConfig fallback = ServerConfig(
    demoMode: true,
    envelopeRequired: false,
    minNotionalUsd: 10,
    autoLogoutMinutes: 15,
    accessTokenMinutes: 60,
    intervals: ['1m', '5m', '15m', '1h', '4h', '1d'],
    markets: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'],
    integrityMode: 'disabled',
    keyProvider: 'local',
    websocket: true,
    push: false,
    biometric: true,
    csvExport: true,
    googleWebClientId: '',
    backendVersion: 'unknown',
    environment: 'dev',
  );

  static ServerConfig fromJson(Map<String, dynamic> json) {
    final features = asMap(json['features']);
    return ServerConfig(
      demoMode: asBool(json['demo_mode'], fallback: true),
      envelopeRequired: asBool(json['envelope_required']),
      minNotionalUsd: asDouble(json['min_notional_usd'], fallback: 10),
      autoLogoutMinutes: asInt(json['auto_logout_minutes'], fallback: 15),
      accessTokenMinutes: asInt(json['access_token_minutes'], fallback: 60),
      intervals: asList(json['intervals']).map((e) => e.toString()).toList(growable: false),
      markets: asList(json['markets']).map((e) => e.toString()).toList(growable: false),
      integrityMode: asString(json['integrity_mode'], fallback: 'disabled'),
      keyProvider: asString(json['key_provider'], fallback: 'local'),
      websocket: asBool(features['websocket'], fallback: true),
      push: asBool(features['push']),
      biometric: asBool(features['biometric'], fallback: true),
      csvExport: asBool(features['csv_export'], fallback: true),
      googleWebClientId: asString(json['google_web_client_id']),
      backendVersion: asString(json['app'], fallback: 'backend'),
      environment: asString(json['environment'], fallback: 'dev'),
    );
  }
}

/// `GET /api/keys` - never exposes secrets, only metadata.
class KeyStatus {
  const KeyStatus({
    required this.count,
    required this.active,
    required this.keysOnDevice,
    required this.canWithdraw,
    required this.ipRestricted,
    required this.isTestnet,
    required this.provider,
  });

  final int count;
  final KeyRecord? active;
  final bool keysOnDevice;
  final bool canWithdraw;
  final bool ipRestricted;
  final bool isTestnet;
  final String provider;

  bool get configured => active != null;

  static KeyStatus fromJson(Map<String, dynamic> json) {
    final rows = asMapList(json['credentials']).isEmpty ? asMapList(json['keys']) : asMapList(json['credentials']);
    final activeRow = rows.isEmpty
        ? null
        : (rows.firstWhere((r) => asBool(r['is_active'], fallback: true), orElse: () => rows.first));
    return KeyStatus(
      count: asInt(json['count'], fallback: rows.length),
      active: activeRow == null ? null : KeyRecord.fromJson(activeRow),
      keysOnDevice: asBool(json['keys_on_device']),
      canWithdraw: asBool(json['can_withdraw']),
      ipRestricted: asBool(activeRow == null ? null : activeRow['ip_restricted']),
      isTestnet: asBool(activeRow == null ? null : activeRow['is_testnet']),
      provider: asString(json['provider'], fallback: 'server-side encrypted vault'),
    );
  }
}

class KeyRecord {
  const KeyRecord({required this.id, required this.label, required this.maskedKey, required this.fingerprint, required this.canTrade, required this.isTestnet, required this.lastCheckedAt, this.lastError});
  final int id;
  final String label;
  final String maskedKey;
  final String fingerprint;
  final bool canTrade;
  final bool isTestnet;
  final int? lastCheckedAt;
  final String? lastError;

  static KeyRecord fromJson(Map<String, dynamic> json) => KeyRecord(
        id: asInt(json['id']),
        label: asString(json['label'], fallback: 'default'),
        maskedKey: asString(json['masked_key'], fallback: json['api_key_masked']?.toString() ?? ''),
        fingerprint: asString(json['fingerprint']),
        canTrade: asBool(json['can_trade'], fallback: true),
        isTestnet: asBool(json['is_testnet']),
        lastCheckedAt: asInt(json['last_checked_at'], fallback: 0),
        lastError: json['last_error'] == null ? null : asString(json['last_error']),
      );
}

/// `GET /api/alerts` rows.
class PriceAlert {
  const PriceAlert({
    required this.id,
    required this.symbol,
    required this.operator,
    required this.threshold,
    required this.direction,
    required this.active,
    required this.triggeredOnce,
    required this.cooldownS,
    required this.currentPrice,
    required this.currentValue,
    required this.distance,
    required this.changePct,
    this.lastTriggeredAtMs,
  });

  final int id;
  final String symbol;
  final String operator;
  final double threshold;
  final String direction;
  final bool active;
  final bool triggeredOnce;
  final int cooldownS;
  final double currentPrice;
  final double currentValue;
  final double? distance;
  final double changePct;
  final int? lastTriggeredAtMs;

  double get remainingPct => currentValue == 0 || distance == null ? 0 : distance! / currentValue.abs() * 100;

  static PriceAlert fromJson(Map<String, dynamic> json) => PriceAlert(
        id: asInt(json['id']),
        symbol: asString(json['symbol']),
        operator: asString(json['operator'], fallback: '>'),
        threshold: asDouble(json['threshold']),
        direction: asString(json['direction'], fallback: 'price'),
        active: asBool(json['active'], fallback: true),
        triggeredOnce: asBool(json['triggered_once']),
        cooldownS: asInt(json['cooldown_s'], fallback: 900),
        currentPrice: asDouble(json['current_price']),
        currentValue: asDouble(json['current_value']),
        distance: asDoubleOrNull(json['distance']),
        changePct: asDouble(json['pct_24h']),
        lastTriggeredAtMs: asInt(json['last_triggered_at_ms'], fallback: 0),
      );
}

/// `GET /api/notifications` rows (in-app mirror of FCM pushes).
class AppNotification {
  const AppNotification({required this.id, required this.kind, required this.title, required this.body, required this.channel, required this.delivered, required this.createdAtMs, required this.data});
  final int id;
  final String kind;
  final String title;
  final String body;
  final String channel;
  final bool delivered;
  final int createdAtMs;
  final Map<String, dynamic> data;

  DateTime get when => DateTime.fromMillisecondsSinceEpoch(createdAtMs);

  static AppNotification fromJson(Map<String, dynamic> json) => AppNotification(
        id: asInt(json['id']),
        kind: asString(json['kind'], fallback: 'info'),
        title: asString(json['title']),
        body: asString(json['body']),
        channel: asString(json['channel']),
        delivered: asBool(json['delivered']),
        createdAtMs: asInt(json['created_at_ms']),
        data: asMap(json['data']),
      );
}

/// `GET /api/auto` + `GET /api/auto/log`.
class AutoTraderStatus {
  const AutoTraderStatus({
    required this.enabled,
    required this.killSwitch,
    required this.symbols,
    required this.riskLevel,
    required this.maxTradeSizeUsd,
    required this.dailyLossLimitUsd,
    required this.minConfidencePct,
    required this.intervalS,
    required this.paperTrading,
    required this.running,
    required this.cycles,
    required this.executed,
    required this.rejected,
    required this.lastCycleMs,
    required this.todayRealizedPnl,
    required this.todayOrders,
    required this.profile,
  });

  final bool enabled;
  final bool killSwitch;
  final List<String> symbols;
  final String riskLevel;
  final double maxTradeSizeUsd;
  final double dailyLossLimitUsd;
  final double minConfidencePct;
  final int intervalS;
  final bool paperTrading;
  final bool running;
  final int cycles;
  final int executed;
  final int rejected;
  final int lastCycleMs;
  final double todayRealizedPnl;
  final int todayOrders;
  final Map<String, double> profile;

  static AutoTraderStatus fromJson(Map<String, dynamic> json) {
    final engine = asMap(json['engine']);
    final today = asMap(json['today']);
    return AutoTraderStatus(
      enabled: asBool(json['enabled']),
      killSwitch: asBool(json['kill_switch']),
      symbols: asList(json['symbols']).map((e) => e.toString()).toList(growable: false),
      riskLevel: asString(json['risk_level'], fallback: 'moderate'),
      maxTradeSizeUsd: asDouble(json['max_trade_size_usd'], fallback: 250),
      dailyLossLimitUsd: asDouble(json['daily_loss_limit_usd'], fallback: 500),
      minConfidencePct: asDouble(json['min_confidence_pct'], fallback: 60),
      intervalS: asInt(json['interval_s'], fallback: 300),
      paperTrading: asBool(json['paper_trading'], fallback: true),
      running: asBool(engine['running']),
      cycles: asInt(engine['cycles']),
      executed: asInt(engine['executed']),
      rejected: asInt(engine['rejected']),
      lastCycleMs: asInt(engine['last_cycle_ms']),
      todayRealizedPnl: asDouble(today['realized_pnl']),
      todayOrders: asInt(today['orders']),
      profile: asMap(json['profile']).map((k, v) => MapEntry(k, asDouble(v))),
    );
  }
}

class AutoTradeEntry {
  const AutoTradeEntry({required this.id, required this.symbol, required this.decision, required this.executed, required this.confidence, required this.reason, required this.createdAtMs, required this.orderClientId});
  final int id;
  final String symbol;
  final String decision;
  final bool executed;
  final double confidence;
  final String reason;
  final int createdAtMs;
  final String orderClientId;

  DateTime get when => DateTime.fromMillisecondsSinceEpoch(createdAtMs);

  static AutoTradeEntry fromJson(Map<String, dynamic> json) => AutoTradeEntry(
        id: asInt(json['id']),
        symbol: asString(json['symbol']),
        decision: asString(json['decision'], fallback: 'HOLD'),
        executed: asBool(json['executed']),
        confidence: asDouble(json['confidence']),
        reason: asString(json['reason']),
        createdAtMs: asInt(json['created_at_ms']),
        orderClientId: asString(json['order_client_id']),
      );
}

/// `GET /api/auto/performance`.
class AutoPerformance {
  const AutoPerformance({
    required this.trades,
    required this.wins,
    required this.losses,
    required this.winRate,
    required this.totalPnl,
    required this.avgPnl,
    required this.bestTrade,
    required this.worstTrade,
    required this.sharpe,
    required this.maxDrawdown,
    required this.decisions,
    required this.executedDecisions,
    required this.recent,
  });

  final int trades;
  final int wins;
  final int losses;
  final double winRate;
  final double totalPnl;
  final double avgPnl;
  final double bestTrade;
  final double worstTrade;
  final double sharpe;
  final double maxDrawdown;
  final int decisions;
  final int executedDecisions;
  final List<AutoTradeEntry> recent;

  static AutoPerformance fromJson(Map<String, dynamic> json) => AutoPerformance(
        trades: asInt(json['trades']),
        wins: asInt(json['wins']),
        losses: asInt(json['losses']),
        winRate: asDouble(json['win_rate']),
        totalPnl: asDouble(json['total_pnl']),
        avgPnl: asDouble(json['avg_pnl']),
        bestTrade: asDouble(json['best_trade']),
        worstTrade: asDouble(json['worst_trade']),
        sharpe: asDouble(json['sharpe_ratio']),
        maxDrawdown: asDouble(json['max_drawdown']),
        decisions: asInt(json['decisions']),
        executedDecisions: asInt(json['executed_decisions']),
        recent: asMapList(json['recent_decisions']).map(AutoTradeEntry.fromJson).toList(growable: false),
      );
}
