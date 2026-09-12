import '../core/json.dart';

/// `GET /api/ai/signal/{symbol}` - the explainable AI decision.
class AiSignal {
  const AiSignal({
    required this.signalId,
    required this.symbol,
    required this.interval,
    required this.action,
    required this.confidence,
    required this.reason,
    required this.score,
    required this.price,
    required this.indicators,
    required this.models,
    required this.rules,
    required this.tradePlan,
    required this.modelVersion,
    required this.warnings,
    this.generatedAtMs,
    this.created,
    this.actedOn,
  });

  final String signalId;
  final String symbol;
  final String interval;
  final String action;
  final double confidence;
  final String reason;
  final double score;
  final double price;
  final Indicators indicators;
  final ModelOutputs models;
  final List<SignalRule> rules;
  final TradePlan tradePlan;
  final String modelVersion;
  final List<String> warnings;
  final int? generatedAtMs;
  final int? created;
  final bool actedOn;

  bool get isBuy => action.toUpperCase() == 'BUY';
  bool get isSell => action.toUpperCase() == 'SELL';
  bool get isHold => !isBuy && !isSell;

  static AiSignal fromJson(Map<String, dynamic> json) => AiSignal(
        signalId: asString(json['signal_id']),
        symbol: asString(json['symbol']),
        interval: asString(json['interval'], fallback: '1m'),
        action: asString(json['action'], fallback: 'HOLD'),
        confidence: asDouble(json['confidence_pct'], fallback: asDouble(json['confidence']) * 100),
        reason: asString(json['reason']),
        score: asDouble(json['score']),
        price: asDouble(json['price']),
        indicators: Indicators.fromJson(asMap(json['indicators'])),
        models: ModelOutputs.fromJson(asMap(json['models'])),
        rules: asMapList(json['rules']).map(SignalRule.fromJson).toList(growable: false),
        tradePlan: TradePlan.fromJson(asMap(json['trade_plan'])),
        modelVersion: asString(json['model_version']),
        warnings: asList(json['warnings']).map((e) => e.toString()).toList(growable: false),
        generatedAtMs: asInt(json['generated_at_ms'], fallback: asInt(json['created_at_ms'], fallback: 0)),
        created: asInt(json['created_at_ms'], fallback: 0),
        actedOn: asBool(json['acted_on']),
      );
}

class SignalRule {
  const SignalRule({required this.name, required this.vote, required this.weight, required this.detail});
  final String name;
  final int vote; // -1 / 0 / +1
  final double weight;
  final String detail;

  static SignalRule fromJson(Map<String, dynamic> json) => SignalRule(
        name: asString(json['name'] ?? json['indicator']),
        vote: asInt(json['vote'] ?? json['signal']),
        weight: asDouble(json['weight'], fallback: 1),
        detail: asString(json['detail'] ?? json['note'] ?? json['reason']),
      );
}

class TradePlan {
  const TradePlan({
    required this.entry,
    required this.takeProfit,
    required this.stopLoss,
    required this.rewardRisk,
    required this.suggestedQty,
    required this.suggestedNotional,
    required this.atr,
  });

  final double entry;
  final double takeProfit;
  final double stopLoss;
  final double rewardRisk;
  final double suggestedQty;
  final double suggestedNotional;
  final double atr;

  bool get hasLevels => takeProfit > 0 && stopLoss > 0;
  double get riskPct => entry == 0 || stopLoss == 0 ? 0 : (entry - stopLoss).abs() / entry * 100;

  static const TradePlan empty = TradePlan(entry: 0, takeProfit: 0, stopLoss: 0, rewardRisk: 0, suggestedQty: 0, suggestedNotional: 0, atr: 0);

  static TradePlan fromJson(Map<String, dynamic> json) {
    if (json.isEmpty) return empty;
    return TradePlan(
      entry: asDouble(json['entry']),
      takeProfit: asDouble(json['take_profit']),
      stopLoss: asDouble(json['stop_loss']),
      rewardRisk: asDouble(json['reward_risk']),
      suggestedQty: asDouble(json['suggested_qty']),
      suggestedNotional: asDouble(json['suggested_notional']),
      atr: asDouble(json['atr']),
    );
  }
}

class ModelOutputs {
  const ModelOutputs({
    required this.lstmPredReturn,
    required this.lstmDirectionProb,
    required this.classifierAction,
    required this.classifierConfidence,
    required this.classifierProbs,
    required this.status,
  });

  final double lstmPredReturn;
  final double lstmDirectionProb;
  final String classifierAction;
  final double classifierConfidence;
  final Map<String, double> classifierProbs;
  final String status;

  bool get healthy => status.isEmpty || status == 'ok';

  static const ModelOutputs empty = ModelOutputs(
    lstmPredReturn: 0,
    lstmDirectionProb: 0,
    classifierAction: '',
    classifierConfidence: 0,
    classifierProbs: {},
    status: '',
  );

  static ModelOutputs fromJson(Map<String, dynamic> json) {
    if (json.isEmpty) return empty;
    return ModelOutputs(
      lstmPredReturn: asDouble(json['lstm_pred_return']),
      lstmDirectionProb: asDouble(json['lstm_direction_prob']),
      classifierAction: asString(json['classifier_action']),
      classifierConfidence: asDouble(json['classifier_confidence']),
      classifierProbs: asMap(json['classifier_probs']).map((k, v) => MapEntry(k, asDouble(v))),
      status: asString(json['status']),
    );
  }
}

/// `GET /api/ai/indicators/{symbol}/{interval}` (also embedded in a signal).
class Indicators {
  const Indicators({
    required this.price,
    required this.rsi,
    required this.macd,
    required this.macdSignal,
    required this.macdHist,
    required this.ema20,
    required this.ema50,
    required this.ema200,
    required this.sma20,
    required this.bbUpper,
    required this.bbLower,
    required this.bbPercentB,
    required this.bbWidth,
    required this.atr,
    required this.atrPct,
    required this.adx,
    required this.vwap,
    required this.stochK,
    required this.stochD,
    required this.williamsR,
    required this.roc,
    required this.cci,
    required this.obvSlope,
    required this.mfi,
    required this.relativeVolume,
    required this.volZ,
    required this.takerRatio,
    required this.levels,
    required this.supports,
    required this.resistances,
    required this.poc,
    required this.valueAreaHigh,
    required this.valueAreaLow,
    required this.series,
  });

  final double price;
  final double rsi;
  final double macd;
  final double macdSignal;
  final double macdHist;
  final double ema20;
  final double ema50;
  final double ema200;
  final double sma20;
  final double bbUpper;
  final double bbLower;
  final double bbPercentB;
  final double bbWidth;
  final double atr;
  final double atrPct;
  final double adx;
  final double vwap;
  final double stochK;
  final double stochD;
  final double williamsR;
  final double roc;
  final double cci;
  final double obvSlope;
  final double mfi;
  final double relativeVolume;
  final double volZ;
  final double takerRatio;
  final List<PriceLevel> levels;
  final List<double> supports;
  final List<double> resistances;
  final double poc;
  final double valueAreaHigh;
  final double valueAreaLow;
  final Map<String, List<double>> series;

  static const Indicators empty = Indicators(
    price: 0, rsi: 50, macd: 0, macdSignal: 0, macdHist: 0, ema20: 0, ema50: 0, ema200: 0, sma20: 0,
    bbUpper: 0, bbLower: 0, bbPercentB: 0.5, bbWidth: 0, atr: 0, atrPct: 0, adx: 0, vwap: 0, stochK: 50,
    stochD: 50, williamsR: -50, roc: 0, cci: 0, obvSlope: 0, mfi: 50, relativeVolume: 1, volZ: 0,
    takerRatio: 0.5, levels: [], supports: [], resistances: [], poc: 0, valueAreaHigh: 0, valueAreaLow: 0, series: {},
  );

  static Indicators fromJson(Map<String, dynamic> json) {
    if (json.isEmpty) return empty;
    double d(String key, {double fallback = 0}) => asDouble(json[key], fallback: fallback);
    return Indicators(
      price: d('price'),
      rsi: d('rsi', fallback: 50),
      macd: d('macd'),
      macdSignal: d('macd_signal'),
      macdHist: d('macd_hist'),
      ema20: d('ema_20'),
      ema50: d('ema_50'),
      ema200: d('ema_200'),
      sma20: d('sma_20'),
      bbUpper: d('bb_upper'),
      bbLower: d('bb_lower'),
      bbPercentB: d('bb_percent_b', fallback: 0.5),
      bbWidth: d('bb_width'),
      atr: d('atr'),
      atrPct: d('atr_pct'),
      adx: d('adx'),
      vwap: d('vwap'),
      stochK: d('stoch_k', fallback: 50),
      stochD: d('stoch_d', fallback: 50),
      williamsR: d('williams_r', fallback: -50),
      roc: d('roc'),
      cci: d('cci'),
      obvSlope: d('obv_slope'),
      mfi: d('mfi', fallback: 50),
      relativeVolume: d('relative_volume', fallback: 1),
      volZ: d('vol_z'),
      takerRatio: d('taker_ratio'),
      levels: asMapList(json['levels']).map(PriceLevel.fromJson).toList(growable: false),
      supports: asList(json['supports']).map((e) => asDouble(e)).toList(growable: false),
      resistances: asList(json['resistances']).map((e) => asDouble(e)).toList(growable: false),
      poc: d('poc'),
      valueAreaHigh: d('value_area_high'),
      valueAreaLow: d('value_area_low'),
      series: asMap(json['series']).map(
        (k, v) => MapEntry(k, asList(v).map((e) => asDouble(e)).toList(growable: false)),
      ),
    );
  }
}

class PriceLevel {
  const PriceLevel({required this.price, required this.role, required this.touches, required this.strength, required this.distancePct});
  final double price;
  final String role;
  final int touches;
  final double strength;
  final double distancePct;

  bool get isSupport => role == 'support';

  static PriceLevel fromJson(Map<String, dynamic> json) => PriceLevel(
        price: asDouble(json['price']),
        role: asString(json['role']),
        touches: asInt(json['touches']),
        strength: asDouble(json['strength']),
        distancePct: asDouble(json['distance_pct']),
      );
}

/// `GET /api/ai/sentiment`.
class MarketSentiment {
  const MarketSentiment({
    required this.state,
    required this.label,
    required this.score,
    required this.avgChangePct,
    required this.advancers,
    required this.decliners,
    required this.buySignals,
    required this.sellSignals,
    required this.holdSignals,
    required this.updatedAtMs,
    required this.perSymbol,
  });

  final String state;
  final String label;
  final double score;
  final double avgChangePct;
  final int advancers;
  final int decliners;
  final int buySignals;
  final int sellSignals;
  final int holdSignals;
  final int updatedAtMs;
  final List<SymbolSignal> perSymbol;

  double get breadthValue => (advancers + decliners) == 0 ? 0 : advancers / (advancers + decliners);
  bool get bullish => state == 'BULLISH';
  bool get bearish => state == 'BEARISH';

  static MarketSentiment fromJson(Map<String, dynamic> json) => MarketSentiment(
        state: asString(json['state'], fallback: 'NEUTRAL'),
        label: asString(json['label'], fallback: 'Neutral'),
        score: asDouble(json['score']),
        avgChangePct: asDouble(json['avg_change_24h_pct']),
        advancers: asInt(json['advancers']),
        decliners: asInt(json['decliners']),
        buySignals: asInt(json['buy_signals']),
        sellSignals: asInt(json['sell_signals']),
        holdSignals: asInt(json['hold_signals']),
        updatedAtMs: asInt(json['updated_at_ms']),
        perSymbol: asMapList(json['per_symbol']).map(SymbolSignal.fromJson).toList(growable: false),
      );
}

class SymbolSignal {
  const SymbolSignal({required this.symbol, required this.action, required this.confidence, required this.score, required this.price, required this.reason});
  final String symbol;
  final String action;
  final double confidence;
  final double score;
  final double price;
  final String reason;

  static SymbolSignal fromJson(Map<String, dynamic> json) => SymbolSignal(
        symbol: asString(json['symbol']),
        action: asString(json['action'], fallback: 'HOLD'),
        confidence: asDouble(json['confidence']),
        score: asDouble(json['score']),
        price: asDouble(json['price']),
        reason: asString(json['reason']),
      );
}

/// `POST /api/ai/backtest` response (subset the UI renders).
class BacktestResult {
  const BacktestResult({
    required this.symbol,
    required this.interval,
    required this.bars,
    required this.startEquity,
    required this.endEquity,
    required this.metrics,
    required this.trades,
    required this.equityCurve,
    required this.strategy,
  });

  final String symbol;
  final String interval;
  final int bars;
  final double startEquity;
  final double endEquity;
  final BacktestMetrics metrics;
  final List<BacktestTrade> trades;
  final List<EquityPoint> equityCurve;
  final String strategy;

  static BacktestResult fromJson(Map<String, dynamic> json) => BacktestResult(
        symbol: asString(json['symbol']),
        interval: asString(json['interval']),
        bars: asInt(json['bars']),
        startEquity: asDouble(json['start_equity']),
        endEquity: asDouble(json['end_equity']),
        metrics: BacktestMetrics.fromJson(asMap(json['metrics'])),
        trades: asMapList(json['trades']).map(BacktestTrade.fromJson).toList(growable: false),
        equityCurve: asMapList(json['equity_curve']).map(EquityPoint.fromJson).toList(growable: false),
        strategy: asString(asMap(json['config'])['strategy']),
      );
}

class BacktestMetrics {
  const BacktestMetrics({
    required this.totalReturnPct,
    required this.annualisedReturnPct,
    required this.buyHoldReturnPct,
    required this.alphaPct,
    required this.maxDrawdownPct,
    required this.sharpe,
    required this.sortino,
    required this.trades,
    required this.winRatePct,
    required this.profitFactor,
    required this.feesPaid,
    required this.exposurePct,
  });

  final double totalReturnPct;
  final double annualisedReturnPct;
  final double buyHoldReturnPct;
  final double alphaPct;
  final double maxDrawdownPct;
  final double sharpe;
  final double sortino;
  final int trades;
  final double winRatePct;
  final double profitFactor;
  final double feesPaid;
  final double exposurePct;

  static BacktestMetrics fromJson(Map<String, dynamic> json) => BacktestMetrics(
        totalReturnPct: asDouble(json['total_return_pct']),
        annualisedReturnPct: asDouble(json['annualised_return_pct']),
        buyHoldReturnPct: asDouble(json['buy_hold_return_pct']),
        alphaPct: asDouble(json['alpha_vs_buy_hold_pct']),
        maxDrawdownPct: asDouble(json['max_drawdown_pct']),
        sharpe: asDouble(json['sharpe']),
        sortino: asDouble(json['sortino']),
        trades: asInt(json['trades']),
        winRatePct: asDouble(json['win_rate_pct']),
        profitFactor: asDouble(json['profit_factor']),
        feesPaid: asDouble(json['fees_paid']),
        exposurePct: asDouble(json['exposure_pct']),
      );
}

class BacktestTrade {
  const BacktestTrade({required this.side, required this.entry, required this.exit, required this.pnl, required this.pnlPct, required this.bars, required this.reason, required this.entryTime});
  final String side;
  final double entry;
  final double exit;
  final double pnl;
  final double pnlPct;
  final int bars;
  final String reason;
  final int entryTime;

  static BacktestTrade fromJson(Map<String, dynamic> json) => BacktestTrade(
        side: asString(json['side'], fallback: 'LONG'),
        entry: asDouble(json['entry']),
        exit: asDouble(json['exit']),
        pnl: asDouble(json['pnl']),
        pnlPct: asDouble(json['pnl_pct']),
        bars: asInt(json['bars']),
        reason: asString(json['reason']),
        entryTime: asInt(json['entry_time']),
      );
}

class EquityPoint {
  const EquityPoint({required this.t, required this.equity, required this.position});
  final int t;
  final double equity;
  final String position;

  static EquityPoint fromJson(Map<String, dynamic> json) => EquityPoint(
        t: asInt(json['t']),
        equity: asDouble(json['equity']),
        position: asString(json['position']),
      );
}

/// `GET /api/ai/models`.
class ModelInfo {
  const ModelInfo({
    required this.version,
    required this.hasModels,
    required this.source,
    required this.trainedAgoS,
    required this.retrainAfterS,
    required this.metrics,
    required this.nFeatures,
    required this.lookBack,
    this.artifacts,
    this.retrainPolicy,
  });

  final String version;
  final bool hasModels;
  final String source;
  final int trainedAgoS;
  final int retrainAfterS;
  final Map<String, double> metrics;
  final int nFeatures;
  final int lookBack;
  final Map<String, bool>? artifacts;
  final Map<String, Object?>? retrainPolicy;

  bool get needsRetrain => retrainAfterS <= 0;

  static ModelInfo fromJson(Map<String, dynamic> json) {
    final active = asMap(json['active']);
    return ModelInfo(
      version: asString(active['version'], fallback: 'unknown'),
      hasModels: asBool(active['has_models']),
      source: asString(active['source']),
      trainedAgoS: asInt(active['trained_ago_s']),
      retrainAfterS: asInt(asMap(active['retrain_after_s'])['seconds'], fallback: asInt(active['retrain_after_s'])),
      metrics: asMap(active['metrics']).map((k, v) => MapEntry(k, asDouble(v))),
      nFeatures: asInt(active['n_features']),
      lookBack: asInt(active['look_back']),
      artifacts: active['artifacts'] == null ? null : asMap(active['artifacts']).map((k, v) => MapEntry(k, asBool(v))),
      retrainPolicy: json['retrain_policy'] == null ? null : asMap(json['retrain_policy']),
    );
  }
}
