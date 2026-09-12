import 'package:crypto_trader_app/core/json.dart';
import 'package:crypto_trader_app/models/ai.dart';
import 'package:crypto_trader_app/models/app_user.dart';
import 'package:crypto_trader_app/models/models.dart';
import 'package:crypto_trader_app/models/trading.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fixtures below are copied from live `crypto_trader_backend` responses
/// (scripts/dump_contract.py) so the app can never drift silently from the API.
void main() {
  test('json helpers tolerate decimal-strings and epoch millis', () {
    expect(asDouble('0.00012300'), 0.000123);
    expect(asDouble(5), 5.0);
    expect(asDouble(null, fallback: -1), -1);
    expect(asDouble('nonsense', fallback: 0), 0);
    expect(asInt('42'), 42);
    expect(asBool('true'), isTrue);
    expect(asDate(1_700_000_000_000).isUtc || asDate(1_700_000_000_000).year > 2020, isTrue);
    expect(trimZeros('1.2300'), '1.23');
  });

  test('Ticker parses the /api/prices row shape', () {
    final ticker = Ticker.fromJson({
      'symbol': 'BTCUSDT',
      'price': 68123.4,
      'change_24h': -120.5,
      'change_percent_24h': -0.18,
      'high_24h': 69000.0,
      'low_24h': 67500.0,
      'volume_24h': 12500.0,
      'quote_volume_24h': 8.5e8,
      'trades_24h': 999999,
      'bid': 68123.0,
      'ask': 68124.0,
      'open_24h': 68243.9,
      'updated_at_ms': 1_700_000_000_000,
    });
    expect(ticker.symbol, 'BTCUSDT');
    expect(ticker.isUp, isFalse);
    expect(ticker.spreadPct, greaterThan(0));
    final after = ticker.applyTick(close: 70000, open: 68243.9, high: 70100, low: 67500, volume: 1, trades: 2);
    expect(after.changePct, closeTo((70000 - 68243.9) / 68243.9 * 100, 1e-6));
    expect(after.updatedAtMs, greaterThan(ticker.updatedAtMs));
  });

  test('Candle + KlinePage parse klines payloads', () {
    final page = KlinePage.fromJson({
      'symbol': 'BTCUSDT',
      'interval': '1m',
      'change_percent': 1.5,
      'candles': [
        {'open_time': 1, 'open': 10.0, 'high': 12.0, 'low': 9.0, 'close': 11.0, 'volume': 3.0, 'trades': 5, 'closed': true},
        {'open_time': 2, 'open': 11.0, 'high': 11.5, 'low': 8.0, 'close': 8.5, 'volume': 4.0, 'trades': 7, 'closed': false},
      ],
    });
    expect(page.candles, hasLength(2));
    expect(page.candles.first.isUp, isTrue);
    expect(page.candles.last.isUp, isFalse);
    expect(page.last!.openTime, 2);
  });

  test('OrderBook computes depth metrics from [price, qty] pairs', () {
    final book = OrderBook.fromJson({
      'symbol': 'BTCUSDT',
      'bids': [
        [100.0, 2.0],
        [99.0, 1.0],
      ],
      'asks': [
        [101.0, 1.0],
        [102.0, 4.0],
      ],
      'best_bid': 100.0,
      'best_ask': 101.0,
      'mid_price': 100.5,
      'spread_bps': 9.95,
      'imbalance': -0.2222,
      'from_cache': true,
    });
    expect(book.bestBid, 100.0);
    expect(book.maxSideQty, 4.0);
    expect(book.fromCache, isTrue);
    expect(book.imbalance, lessThan(0));
  });

  test('AiSignal parses a full signal incl. models, rules and trade plan', () {
    final signal = AiSignal.fromJson({
      'signal_id': 'sig_abc',
      'symbol': 'BTCUSDT',
      'interval': '15m',
      'action': 'BUY',
      'confidence': 0.72,
      'confidence_pct': 72.0,
      'reason': 'MACD bullish crossover above the 50 EMA',
      'score': 0.41,
      'price': 68000.0,
      'indicators': {'rsi': 61.2, 'atr': 240.0, 'levels': [{'price': 67000.0, 'role': 'support', 'touches': 3, 'strength': 0.8, 'distance_pct': -1.47}]},
      'models': {
        'lstm_pred_return': 0.0042,
        'lstm_direction_prob': 0.66,
        'classifier_probs': {'BUY': 0.61, 'HOLD': 0.3, 'SELL': 0.09},
        'classifier_action': 'BUY',
        'classifier_confidence': 0.61,
        'status': 'ok',
      },
      'rules': [
        {'name': 'macd', 'vote': 1, 'weight': 1.4, 'detail': 'histogram rising'},
        {'name': 'rsi', 'vote': 0, 'weight': 1.0, 'detail': 'neutral'},
      ],
      'trade_plan': {'entry': 68000.0, 'take_profit': 68480.0, 'stop_loss': 67640.0, 'reward_risk': 1.33, 'suggested_qty': 0.0036, 'suggested_notional': 244.8, 'atr': 240.0},
      'model_version': 'ai-20260911-190341',
      'warnings': ['thin book'],
    });
    expect(signal.isBuy, isTrue);
    expect(signal.confidence, 72.0);
    expect(signal.indicators.rsi, 61.2);
    expect(signal.indicators.levels.single.isSupport, isTrue);
    expect(signal.models.classifierProbs['BUY'], closeTo(0.61, 1e-9));
    expect(signal.rules.first.vote, 1);
    expect(signal.tradePlan.hasLevels, isTrue);
    expect(signal.tradePlan.riskPct, greaterThan(0));
    expect(signal.warnings, contains('thin book'));
  });

  test('AccountSnapshot reads holdings, allocation and performance', () {
    final account = AccountSnapshot.fromJson({
      'mode': 'demo',
      'paper_trading': true,
      'total_value_usd': 10123.45,
      'invested_value_usd': 1000.0,
      'cash_usd': 9123.45,
      'change_24h_usd': -12.0,
      'change_24h_pct': -0.12,
      'holdings': [
        {'asset': 'BTC', 'symbol': 'BTCUSDT', 'name': 'Bitcoin', 'amount': 0.0147, 'price': 68000.0, 'value_usd': 999.6, 'change_24h_pct': 1.1, 'avg_buy_price': 67000.0, 'unrealized_pnl': 14.7, 'unrealized_pnl_pct': 1.49, 'allocation_pct': 9.8, 'sparkline': [1.0, 1.1, 1.2]},
      ],
      'allocation': [
        {'asset': 'BTC', 'label': 'Bitcoin', 'value_usd': 999.6, 'pct': 9.8, 'color_seed': 2},
      ],
      'performance': {'realized_pnl': 120.0, 'fees_paid': 3.4, 'volume': 5000.0, 'orders': 12, 'closed_trades': 5, 'wins': 4, 'losses': 1, 'win_rate': 80.0, 'profit_factor': null, 'avg_win': 40.0, 'avg_loss': -10.0, 'daily_loss_limit_usd': 500.0, 'realized_today': 5.0},
      'exchange': {'name': 'simulated', 'can_withdraw': false},
      'limits': {'max_trade_size_usd': 250.0, 'daily_loss_limit_usd': 500.0, 'risk_level': 'moderate'},
    });
    expect(account.demoMode, isTrue);
    expect(account.holdings.single.asset, 'BTC');
    expect(account.holdings.single.sparkline, hasLength(3));
    expect(account.performance.profitFactor, isNull);
    expect(account.canWithdraw, isFalse);
    expect(account.limits.riskLevel, 'moderate');
  });

  test('OrderResult + RiskCheck mirror the trade response', () {
    final result = OrderResult.fromJson({
      'id': 7,
      'client_order_id': 'ct123',
      'order_id': '1',
      'symbol': 'BTCUSDT',
      'side': 'BUY',
      'type': 'MARKET',
      'quantity': 0.001,
      'price': 68000.0,
      'notional': 68.0,
      'fee_usd': 0.068,
      'realized_pnl': 0.0,
      'status': 'FILLED',
      'paper': true,
      'source': 'manual',
      'created_at_ms': 1_700_000_000_000,
      'position': {'symbol': 'BTCUSDT', 'qty': 0.001, 'avg_price': 68000.0, 'unrealized_pnl': 0.1},
      'risk': {'allowed': true, 'reason': 'approved', 'code': 'ok', 'adjusted_qty': 0.001, 'warnings': [], 'notional': 68.0, 'max_trade_size_usd': 250.0, 'daily_loss_limit_usd': 500.0, 'realised_pnl_today': 0.0, 'open_positions': 1},
      'warnings': ['paper fill'],
      'balance_after': 9055.4,
    });
    expect(result.filled, isTrue);
    expect(result.isBuy, isTrue);
    expect(result.position?.qty, 0.001);
    expect(result.risk?.allowed, isTrue);
    expect(result.warnings, isNotEmpty);
  });

  test('TradeRow accepts both the local ledger and Binance history shapes', () {
    final local = TradeRow.fromJson({'id': 3, 'symbol': 'ETHUSDT', 'side': 'sell', 'quantity': 0.5, 'price': 3000.0, 'notional': 1500.0, 'fee_usd': 0.9, 'status': 'FILLED', 'created_at_ms': 1, 'source': 'ai', 'paper': true, 'realized_pnl': 12.0, 'ai_signal_id': 'sig_1'});
    final exchange = TradeRow.fromJson({'id': '9', 'orderId': '8', 'symbol': 'ETHUSDT', 'side': 'BUY', 'price': '2999.50000', 'qty': '0.50000', 'quoteQty': '1499.75', 'commission': '0.001', 'time': 1_700_000_000_000});
    expect(local.isBuy, isFalse);
    expect(local.realizedPnl, 12.0);
    expect(exchange.isBuy, isTrue);
    expect(exchange.qty, 0.5);
    expect(exchange.notional, closeTo(1499.75, 1e-9));
  });

  test('AppUser, ServerConfig and KeyStatus parse their endpoints', () {
    final user = AppUser.fromJson({'id': 2, 'email': 'a@b.c', 'name': 'Ada', 'risk_level': 'aggressive', 'paper_trading': false, 'auto_trade': {'enabled': true, 'symbols': ['BTCUSDT'], 'kill_switch': false}, 'has_exchange_key': 1});
    expect(user.initials, 'A');
    expect(user.autoTradeSymbols, ['BTCUSDT']);
    expect(user.hasExchangeKey, 1);

    final config = ServerConfig.fromJson({'demo_mode': false, 'min_notional_usd': '5.0', 'markets': ['BTCUSDT'], 'intervals': ['1m', '1h'], 'features': {'websocket': true, 'push': false}});
    expect(config.demoMode, isFalse);
    expect(config.minNotionalUsd, 5.0);
    expect(config.websocket, isTrue);
    expect(config.push, isFalse);

    final keys = KeyStatus.fromJson({'count': 1, 'credentials': [{'id': 4, 'label': 'spot', 'masked_key': 'abcd…wxyz', 'can_trade': true, 'is_active': true, 'is_testnet': true}], 'provider': 'local'});
    expect(keys.configured, isTrue);
    expect(keys.active?.maskedKey, 'abcd…wxyz');
    expect(keys.provider, 'local');
  });

  test('PriceAlert and AutoTraderStatus tolerate sparse payloads', () {
    final alert = PriceAlert.fromJson({'id': 1, 'symbol': 'BTCUSDT', 'operator': '>', 'threshold': 70000.0, 'direction': 'price', 'active': true, 'current_price': 68000.0, 'current_value': 68000.0, 'distance': 2000.0, 'pct_24h': 1.0});
    expect(alert.remainingPct, greaterThan(0));
    final empty = AutoTraderStatus.fromJson({});
    expect(empty.enabled, isFalse);
    expect(empty.maxTradeSizeUsd, 250);
    expect(empty.riskLevel, 'moderate');
  });
}
