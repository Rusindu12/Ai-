import 'package:crypto_trader_app/core/ta.dart';
import 'package:crypto_trader_app/models/models.dart';
import 'package:flutter_test/flutter_test.dart';

Candle c(int t, double o, double h, double l, double cl, [double v = 1]) =>
    Candle(openTime: t, open: o, high: h, low: l, close: cl, volume: v, trades: 1, closed: true);

void main() {
  test('EMA starts only after the warm-up period and follows price', () {
    final values = [for (var i = 0; i < 40; i++) 100.0 + i];
    final out = ema(values, 20);
    expect(out.length, 40);
    expect(out[0], isNull);
    expect(out[18], isNull);
    expect(out[19], isNotNull);
    expect(out.last!, greaterThan(120));
    expect(out.last!, lessThan(values.last));
  });

  test('VWAP resets on a new day and sits inside the range', () {
    final day1 = DateTime(2026, 1, 1, 10).millisecondsSinceEpoch;
    final day2 = DateTime(2026, 1, 2, 10).millisecondsSinceEpoch;
    final candles = [
      c(day1, 100, 110, 90, 105, 10),
      c(day1 + 60000, 105, 106, 100, 101, 10),
      c(day2, 200, 210, 190, 205, 1),
    ];
    final series = vwap(candles);
    // (H + L + C) / 3 for the first bar, volume weighted from there.
    expect(series[0]!, closeTo((110 + 90 + 105) / 3, 1e-6));
    expect(series[1]!, closeTo(((101.6666666 * 10) + (102.3333333 * 10)) / 20, 1e-4));
    // New day -> the anchor resets to that day's own volume-weighted price.
    expect(series[2]!, closeTo((210 + 190 + 205) / 3, 1e-6));
    for (final value in series.whereType<double>()) {
      expect(value, greaterThan(0));
    }
  });

  test('Bollinger bands bracket the mean and widen with volatility', () {
    final calm = [for (var i = 0; i < 40; i++) 100.0];
    final wild = [for (var i = 0; i < 40; i++) i.isEven ? 90.0 : 110.0];
    final calmBb = bollinger(calm);
    final wildBb = bollinger(wild);
    expect(calmBb.upper.last, closeTo(100.0, 1e-9));
    expect(calmBb.lower.last, closeTo(100.0, 1e-9));
    expect(wildBb.upper.last! - wildBb.lower.last!, greaterThan(10.0));
    for (var i = 0; i < 40; i++) {
      if (wildBb.upper[i] == null) continue;
      expect(wildBb.upper[i]!, greaterThanOrEqualTo(wildBb.middle[i]!));
      expect(wildBb.lower[i]!, lessThanOrEqualTo(wildBb.middle[i]!));
    }
  });

  test('RSI is 100 on a straight climb and bounded in [0, 100]', () {
    final up = [for (var i = 0; i < 40; i++) 100.0 + i];
    final out = rsi(up);
    expect(out.sublist(0, 14).every((e) => e == null), isTrue);
    expect(out.last!, closeTo(100.0, 1e-6));
    final mixed = rsi([for (var i = 0; i < 60; i++) 100.0 + (i % 7) - 3]);
    expect(mixed.whereType<double>().every((v) => v >= 0 && v <= 100), isTrue);
  });

  test('toDense keeps length so overlays align with candles', () {
    final dense = toDense(ema([1, 2, 3, 4].map((e) => e.toDouble()).toList(), 3));
    expect(dense, hasLength(4));
    expect(dense[0].isNaN, isTrue);
  });
}
