import 'package:crypto_trader_app/core/theme.dart';
import 'package:crypto_trader_app/models/models.dart';
import 'package:crypto_trader_app/widgets/candle_chart.dart';
import 'package:crypto_trader_app/widgets/charts_extras.dart';
import 'package:crypto_trader_app/widgets/common.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Candle candle(int i, double base) => Candle(
      openTime: DateTime(2026, 1, 1).add(Duration(minutes: i)).millisecondsSinceEpoch,
      open: base,
      high: base + 8,
      low: base - 8,
      close: base + (i.isEven ? 4 : -4),
      volume: 10 + i,
      trades: 100 + i,
      closed: true,
    );

void main() {
  testWidgets('CandleChart paints without throwing', (tester) async {
    final candles = [for (var i = 0; i < 120; i++) candle(i, 100 + i * 0.5)];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(brightness: Brightness.dark),
        home: Scaffold(
          body: SizedBox(
            width: 420,
            child: CandleChart(
              candles: candles,
              height: 240,
              emaFast: [for (var i = 0; i < candles.length; i++) i > 20 ? 110.0 : double.nan],
              supports: const [100.0],
              resistances: const [160.0],
              plan: const TradePlan(entry: 120, takeProfit: 150, stopLoss: 110, rewardRisk: 2.4, suggestedQty: 0.01, suggestedNotional: 1200, atr: 10),
            ),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byType(CustomPaint), findsWidgets);
  });

  testWidgets('CandleChart shows a spinner with no data', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: SizedBox(width: 300, child: CandleChart(candles: const [], height: 200)))),
    );
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('TickerRow renders symbol, price and change pill', (tester) async {
    final ticker = Ticker.fromJson({
      'symbol': 'BTCUSDT',
      'price': 68000.0,
      'change_percent_24h': 2.5,
      'high_24h': 69000.0,
      'low_24h': 67000.0,
      'quote_volume_24h': 1.2e9,
      'volume_24h': 1200.0,
      'trades_24h': 90000,
      'bid': 67999.0,
      'ask': 68001.0,
      'open_24h': 66300.0,
      'updated_at_ms': 1,
      'change_24h': 1700.0,
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(brightness: Brightness.dark),
        home: Scaffold(body: TickerRow(ticker: ticker, onTap: () {}, sparkline: const [1.0, 1.2, 1.1, 1.4, 1.35])),
      ),
    );
    expect(find.text('BTC'), findsOneWidget);
    expect(find.textContaining('2.50%'), findsOneWidget);
  });

  testWidgets('AllocationDonut handles the empty portfolio', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: AllocationDonut(slices: [], totalUsd: 0))),
    );
    expect(find.text('No holdings yet'), findsOneWidget);
  });

  testWidgets('AllocationDonut renders slices', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(brightness: Brightness.dark),
        home: const Scaffold(
          body: AllocationDonut(
            totalUsd: 1000,
            slices: [
              AllocationSlice(asset: 'BTC', label: 'Bitcoin', valueUsd: 600, pct: 60, colorSeed: 0),
              AllocationSlice(asset: 'ETH', label: 'Ethereum', valueUsd: 400, pct: 40, colorSeed: 1),
            ],
          ),
        ),
      ),
    );
    expect(find.text('2 assets'), findsOneWidget);
    expect(find.text('\$1000'), findsOneWidget);
  });

  testWidgets('EquityCurve degrades gracefully with one point', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(brightness: Brightness.dark),
        home: const Scaffold(
          body: EquityCurve(points: [EquityPoint(t: 0, equity: 100, position: '')]),
        ),
      ),
    );
    expect(find.textContaining('Not enough trades'), findsOneWidget);
  });
}
