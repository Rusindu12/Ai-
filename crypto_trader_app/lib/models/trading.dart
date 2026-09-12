import '../core/json.dart';

/// `POST /api/order` result (also the shape of rows in `GET /api/orders`).
class OrderResult {
  const OrderResult({
    required this.id,
    required this.clientOrderId,
    required this.orderId,
    required this.symbol,
    required this.side,
    required this.type,
    required this.quantity,
    required this.price,
    required this.notional,
    required this.feeUsd,
    required this.realizedPnl,
    required this.status,
    required this.paper,
    required this.source,
    required this.createdAtMs,
    this.takeProfit,
    this.stopLoss,
    this.aiSignalId,
    this.confidence,
    this.position,
    this.risk,
    this.balanceAfter,
    this.warnings = const [],
  });

  final int id;
  final String clientOrderId;
  final String orderId;
  final String symbol;
  final String side;
  final String type;
  final double quantity;
  final double price;
  final double notional;
  final double feeUsd;
  final double realizedPnl;
  final String status;
  final bool paper;
  final String source;
  final int createdAtMs;
  final double? takeProfit;
  final double? stopLoss;
  final String? aiSignalId;
  final double? confidence;
  final PositionSummary? position;
  final RiskCheck? risk;
  final double? balanceAfter;
  final List<String> warnings;

  bool get isBuy => side.toUpperCase() == 'BUY';
  bool get filled => status.toUpperCase() == 'FILLED';

  static OrderResult fromJson(Map<String, dynamic> json) => OrderResult(
        id: asInt(json['id']),
        clientOrderId: asString(json['client_order_id']),
        orderId: asString(json['order_id']),
        symbol: asString(json['symbol']),
        side: asString(json['side'], fallback: 'BUY'),
        type: asString(json['type'], fallback: 'MARKET'),
        quantity: asDouble(json['quantity']),
        price: asDouble(json['price']),
        notional: asDouble(json['notional']),
        feeUsd: asDouble(json['fee_usd']),
        realizedPnl: asDouble(json['realized_pnl']),
        status: asString(json['status'], fallback: 'NEW'),
        paper: asBool(json['paper']),
        source: asString(json['source']),
        createdAtMs: asInt(json['created_at_ms']),
        takeProfit: asDoubleOrNull(json['take_profit']),
        stopLoss: asDoubleOrNull(json['stop_loss']),
        aiSignalId: json['ai_signal_id'] == null ? null : asString(json['ai_signal_id']),
        confidence: asDoubleOrNull(json['confidence']),
        position: json['position'] is Map ? PositionSummary.fromJson(asMap(json['position'])) : null,
        risk: json['risk'] is Map ? RiskCheck.fromJson(asMap(json['risk'])) : null,
        balanceAfter: asDoubleOrNull(json['balance_after']),
        warnings: asList(json['warnings']).map((e) => e.toString()).toList(growable: false),
      );
}

class PositionSummary {
  const PositionSummary({
    required this.symbol,
    required this.qty,
    required this.avgPrice,
    required this.unrealizedPnl,
    this.takeProfit,
    this.stopLoss,
  });

  final String symbol;
  final double qty;
  final double avgPrice;
  final double unrealizedPnl;
  final double? takeProfit;
  final double? stopLoss;

  static PositionSummary fromJson(Map<String, dynamic> json) => PositionSummary(
        symbol: asString(json['symbol']),
        qty: asDouble(json['qty']),
        avgPrice: asDouble(json['avg_price']),
        unrealizedPnl: asDouble(json['unrealized_pnl']),
        takeProfit: asDoubleOrNull(json['take_profit']),
        stopLoss: asDoubleOrNull(json['stop_loss']),
      );
}

class RiskCheck {
  const RiskCheck({
    required this.allowed,
    required this.reason,
    required this.code,
    required this.adjustedQty,
    required this.warnings,
    required this.notional,
    required this.maxTradeSizeUsd,
    required this.dailyLossLimitUsd,
    required this.realisedToday,
    required this.openPositions,
  });

  final bool allowed;
  final String reason;
  final String code;
  final double adjustedQty;
  final List<String> warnings;
  final double notional;
  final double maxTradeSizeUsd;
  final double dailyLossLimitUsd;
  final double realisedToday;
  final int openPositions;

  static RiskCheck fromJson(Map<String, dynamic> json) => RiskCheck(
        allowed: asBool(json['allowed']),
        reason: asString(json['reason']),
        code: asString(json['code']),
        adjustedQty: asDouble(json['adjusted_qty']),
        warnings: asList(json['warnings']).map((e) => e.toString()).toList(growable: false),
        notional: asDouble(json['notional']),
        maxTradeSizeUsd: asDouble(json['max_trade_size_usd']),
        dailyLossLimitUsd: asDouble(json['daily_loss_limit_usd']),
        realisedToday: asDouble(json['realised_pnl_today']),
        openPositions: asInt(json['open_positions']),
      );
}

/// `POST /api/order/preview`.
class OrderPreview {
  const OrderPreview({
    required this.symbol,
    required this.side,
    required this.quantity,
    required this.estPrice,
    required this.estNotional,
    required this.estFee,
    required this.risk,
    required this.paper,
    required this.clientOrderId,
    this.takeProfit,
    this.stopLoss,
  });

  final String symbol;
  final String side;
  final double quantity;
  final double estPrice;
  final double estNotional;
  final double estFee;
  final RiskCheck risk;
  final bool paper;
  final String clientOrderId;
  final double? takeProfit;
  final double? stopLoss;

  static OrderPreview fromJson(Map<String, dynamic> json) => OrderPreview(
        symbol: asString(json['symbol']),
        side: asString(json['side']),
        quantity: asDouble(json['quantity']),
        estPrice: asDouble(json['est_price']),
        estNotional: asDouble(json['est_notional']),
        estFee: asDouble(json['est_fee']),
        risk: RiskCheck.fromJson(asMap(json['risk'])),
        paper: asBool(json['paper']),
        clientOrderId: asString(json['client_order_id']),
        takeProfit: asDoubleOrNull(json['take_profit']),
        stopLoss: asDoubleOrNull(json['stop_loss']),
      );
}

/// `GET /api/account` -> holdings + performance.
class AccountSnapshot {
  const AccountSnapshot({
    required this.mode,
    required this.totalValueUsd,
    required this.investedUsd,
    required this.cashUsd,
    required this.change24hUsd,
    required this.change24hPct,
    required this.holdings,
    required this.allocation,
    required this.performance,
    required this.exchangeLabel,
    required this.canWithdraw,
    required this.paperTrading,
    required this.generatedAtMs,
    required this.limits,
  });

  final String mode;
  final double totalValueUsd;
  final double investedUsd;
  final double cashUsd;
  final double change24hUsd;
  final double change24hPct;
  final List<Holdings> holdings;
  final List<AllocationSlice> allocation;
  final Performance performance;
  final String exchangeLabel;
  final bool canWithdraw;
  final bool paperTrading;
  final int generatedAtMs;
  final TradingLimits limits;

  bool get hasData => mode != 'none';

  /// `demo` = backend simulator, `paper` = real prices with simulated fills.
  bool get demoMode => mode == 'demo' || mode == 'simulated';

  static AccountSnapshot fromJson(Map<String, dynamic> json) => AccountSnapshot(
        mode: asString(json['mode'], fallback: 'demo'),
        totalValueUsd: asDouble(json['total_value_usd']),
        investedUsd: asDouble(json['invested_value_usd']),
        cashUsd: asDouble(json['cash_usd']),
        change24hUsd: asDouble(json['change_24h_usd']),
        change24hPct: asDouble(json['change_24h_pct']),
        holdings: asMapList(json['holdings']).map(Holdings.fromJson).toList(growable: false),
        allocation: asMapList(json['allocation']).map(AllocationSlice.fromJson).toList(growable: false),
        performance: Performance.fromJson(asMap(json['performance'])),
        exchangeLabel: asString(asMap(json['exchange'])['name'], fallback: asString(json['credential'])),
        canWithdraw: asBool(asMap(json['exchange'])['can_withdraw']),
        paperTrading: asBool(json['paper_trading']),
        generatedAtMs: asInt(json['generated_at_ms']),
        limits: TradingLimits.fromJson(asMap(json['limits'])),
      );

  static const AccountSnapshot empty = AccountSnapshot(
    mode: 'none',
    totalValueUsd: 0,
    investedUsd: 0,
    cashUsd: 0,
    change24hUsd: 0,
    change24hPct: 0,
    holdings: [],
    allocation: [],
    performance: Performance.empty,
    exchangeLabel: '',
    canWithdraw: false,
    paperTrading: true,
    generatedAtMs: 0,
    limits: TradingLimits.empty,
  );
}

class TradingLimits {
  const TradingLimits({required this.maxTradeSizeUsd, required this.dailyLossLimitUsd, required this.riskLevel});
  final double maxTradeSizeUsd;
  final double dailyLossLimitUsd;
  final String riskLevel;

  static const TradingLimits empty = TradingLimits(maxTradeSizeUsd: 250, dailyLossLimitUsd: 500, riskLevel: 'moderate');

  static TradingLimits fromJson(Map<String, dynamic> json) => TradingLimits(
        maxTradeSizeUsd: asDouble(json['max_trade_size_usd'], fallback: 250),
        dailyLossLimitUsd: asDouble(json['daily_loss_limit_usd'], fallback: 500),
        riskLevel: asString(json['risk_level'], fallback: 'moderate'),
      );
}

class Holdings {
  const Holdings({
    required this.asset,
    required this.symbol,
    required this.name,
    required this.amount,
    required this.price,
    required this.valueUsd,
    required this.change24hPct,
    required this.avgBuyPrice,
    required this.unrealizedPnl,
    required this.unrealizedPnlPct,
    required this.allocationPct,
    required this.sparkline,
  });

  final String asset;
  final String symbol;
  final String name;
  final double amount;
  final double price;
  final double valueUsd;
  final double change24hPct;
  final double avgBuyPrice;
  final double unrealizedPnl;
  final double unrealizedPnlPct;
  final double allocationPct;
  final List<double> sparkline;

  static Holdings fromJson(Map<String, dynamic> json) => Holdings(
        asset: asString(json['asset']),
        symbol: asString(json['symbol']),
        name: asString(json['name']),
        amount: asDouble(json['amount']),
        price: asDouble(json['price']),
        valueUsd: asDouble(json['value_usd']),
        change24hPct: asDouble(json['change_24h_pct']),
        avgBuyPrice: asDouble(json['avg_buy_price']),
        unrealizedPnl: asDouble(json['unrealized_pnl']),
        unrealizedPnlPct: asDouble(json['unrealized_pnl_pct']),
        allocationPct: asDouble(json['allocation_pct']),
        sparkline: asList(json['sparkline']).map((e) => asDouble(e)).toList(growable: false),
      );
}

class AllocationSlice {
  const AllocationSlice({required this.asset, required this.label, required this.valueUsd, required this.pct, required this.colorSeed});
  final String asset;
  final String label;
  final double valueUsd;
  final double pct;
  final int colorSeed;

  static AllocationSlice fromJson(Map<String, dynamic> json) => AllocationSlice(
        asset: asString(json['asset']),
        label: asString(json['label']),
        valueUsd: asDouble(json['value_usd']),
        pct: asDouble(json['pct']),
        colorSeed: asInt(json['color_seed']),
      );
}

class Performance {
  const Performance({
    required this.realizedPnl,
    required this.feesPaid,
    required this.volume,
    required this.orders,
    required this.closedTrades,
    required this.wins,
    required this.losses,
    required this.winRate,
    required this.profitFactor,
    required this.avgWin,
    required this.avgLoss,
    required this.realizedToday,
    required this.dailyLossLimitUsd,
  });

  final double realizedPnl;
  final double feesPaid;
  final double volume;
  final int orders;
  final int closedTrades;
  final int wins;
  final int losses;
  final double winRate;
  final double? profitFactor;
  final double avgWin;
  final double avgLoss;
  final double realizedToday;
  final double dailyLossLimitUsd;

  static const Performance empty = Performance(
    realizedPnl: 0,
    feesPaid: 0,
    volume: 0,
    orders: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    profitFactor: null,
    avgWin: 0,
    avgLoss: 0,
    realizedToday: 0,
    dailyLossLimitUsd: 0,
  );

  static Performance fromJson(Map<String, dynamic> json) => Performance(
        realizedPnl: asDouble(json['realized_pnl']),
        feesPaid: asDouble(json['fees_paid']),
        volume: asDouble(json['volume']),
        orders: asInt(json['orders']),
        closedTrades: asInt(json['closed_trades']),
        wins: asInt(json['wins']),
        losses: asInt(json['losses']),
        winRate: asDouble(json['win_rate']),
        profitFactor: asDoubleOrNull(json['profit_factor']),
        avgWin: asDouble(json['avg_win']),
        avgLoss: asDouble(json['avg_loss']),
        realizedToday: asDouble(json['realized_today']),
        dailyLossLimitUsd: asDouble(json['daily_loss_limit_usd']),
      );
}

class OpenPosition {
  const OpenPosition({
    required this.symbol,
    required this.qty,
    required this.avgPrice,
    required this.markPrice,
    required this.valueUsd,
    required this.unrealizedPnl,
    required this.unrealizedPnlPct,
    required this.realizedPnl,
    required this.paper,
    this.takeProfit,
    this.stopLoss,
    this.distanceToTpPct,
    this.distanceToSlPct,
  });

  final String symbol;
  final double qty;
  final double avgPrice;
  final double markPrice;
  final double valueUsd;
  final double unrealizedPnl;
  final double unrealizedPnlPct;
  final double realizedPnl;
  final bool paper;
  final double? takeProfit;
  final double? stopLoss;
  final double? distanceToTpPct;
  final double? distanceToSlPct;

  bool get inProfit => unrealizedPnl >= 0;

  static OpenPosition fromJson(Map<String, dynamic> json) => OpenPosition(
        symbol: asString(json['symbol']),
        qty: asDouble(json['qty']),
        avgPrice: asDouble(json['avg_price']),
        markPrice: asDouble(json['mark_price']),
        valueUsd: asDouble(json['value_usd']),
        unrealizedPnl: asDouble(json['unrealized_pnl']),
        unrealizedPnlPct: asDouble(json['unrealized_pnl_pct']),
        realizedPnl: asDouble(json['realized_pnl']),
        paper: asBool(json['paper']),
        takeProfit: asDoubleOrNull(json['take_profit']),
        stopLoss: asDoubleOrNull(json['stop_loss']),
        distanceToTpPct: asDoubleOrNull(json['distance_to_tp_pct']),
        distanceToSlPct: asDoubleOrNull(json['distance_to_sl_pct']),
      );
}

/// Rows of `GET /api/trades` (either local ledger or exchange history).
class TradeRow {
  const TradeRow({
    required this.id,
    required this.symbol,
    required this.side,
    required this.qty,
    required this.price,
    required this.notional,
    required this.fee,
    required this.status,
    required this.time,
    required this.source,
    required this.paper,
    this.clientOrderId,
    this.orderId,
    this.realizedPnl,
    this.aiSignalId,
    this.confidence,
  });

  final String id;
  final String symbol;
  final String side;
  final double qty;
  final double price;
  final double notional;
  final double fee;
  final String status;
  final int time;
  final String source;
  final bool paper;
  final String? clientOrderId;
  final String? orderId;
  final double? realizedPnl;
  final String? aiSignalId;
  final double? confidence;

  bool get isBuy => side.toUpperCase() == 'BUY';
  DateTime get when => DateTime.fromMillisecondsSinceEpoch(time);

  static TradeRow fromJson(Map<String, dynamic> json) => TradeRow(
        id: asString(json['id']),
        symbol: asString(json['symbol']),
        side: asString(json['side'], fallback: 'BUY'),
        qty: asDouble(json['quantity'], fallback: asDouble(json['qty'])),
        price: asDouble(json['price']),
        notional: asDouble(json['notional'], fallback: asDouble(json['quoteQty'])),
        fee: asDouble(json['fee_usd'], fallback: asDouble(json['commission'])),
        status: asString(json['status'], fallback: 'FILLED'),
        time: asInt(json['created_at_ms'], fallback: asInt(json['time'])),
        source: asString(json['source']),
        paper: asBool(json['paper']),
        clientOrderId: json['client_order_id'] == null ? null : asString(json['client_order_id']),
        orderId: json['order_id'] == null ? (json['orderId'] == null ? null : asString(json['orderId'])) : asString(json['order_id']),
        realizedPnl: asDoubleOrNull(json['realized_pnl']),
        aiSignalId: json['ai_signal_id'] == null ? null : asString(json['ai_signal_id']),
        confidence: asDoubleOrNull(json['confidence']),
      );
}
