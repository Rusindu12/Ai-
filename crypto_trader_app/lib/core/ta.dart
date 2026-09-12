/// A handful of indicators computed on-device, purely for chart overlays.
///
/// The *decision* always comes from the backend (authoritative, same numbers the
/// model saw); these curves exist so the chart can draw EMAs/VWAP/Bollinger
/// without an extra round trip.
library;

import '../models/models.dart';

List<double?> ema(List<double> values, int period) {
  if (values.isEmpty) return const [];
  final alpha = 2 / (period + 1);
  final out = List<double?>.filled(values.length, null);
  var prev = values.first;
  out[0] = prev;
  for (var i = 1; i < values.length; i++) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  // Warm-up period: hide the first `period` bars so the curve is not misleading.
  for (var i = 0; i < values.length && i < period - 1; i++) {
    out[i] = null;
  }
  return out;
}

List<double?> vwap(List<Candle> candles) {
  if (candles.isEmpty) return const [];
  final out = List<double?>.filled(candles.length, null);
  double pv = 0, vol = 0;
  DateTime? day;
  for (var i = 0; i < candles.length; i++) {
    final c = candles[i];
    final startOfDay = DateTime(c.time.year, c.time.month, c.time.day);
    if (day == null || startOfDay.isAfter(day)) {
      day = startOfDay;
      pv = 0;
      vol = 0;
    }
    final typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

class BollingerSeries {
  const BollingerSeries({required this.upper, required this.middle, required this.lower});
  final List<double?> upper;
  final List<double?> middle;
  final List<double?> lower;
}

BollingerSeries bollinger(List<double> values, {int period = 20, double mult = 2}) {
  final n = values.length;
  final upper = List<double?>.filled(n, null);
  final middle = List<double?>.filled(n, null);
  final lower = List<double?>.filled(n, null);
  for (var i = period - 1; i < n; i++) {
    var sum = 0.0;
    for (var j = i - period + 1; j <= i; j++) {
      sum += values[j];
    }
    final mean = sum / period;
    var variance = 0.0;
    for (var j = i - period + 1; j <= i; j++) {
      final d = values[j] - mean;
      variance += d * d;
    }
    final sd = _sqrt(variance / period);
    middle[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return BollingerSeries(upper: upper, middle: middle, lower: lower);
}

List<double?> rsi(List<double> values, {int period = 14}) {
  final n = values.length;
  final out = List<double?>.filled(n, null);
  if (n <= period) return out;
  double gain = 0, loss = 0;
  for (var i = 1; i <= period; i++) {
    final delta = values[i] - values[i - 1];
    if (delta >= 0) {
      gain += delta;
    } else {
      loss -= delta;
    }
  }
  gain /= period;
  loss /= period;
  out[period] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (var i = period + 1; i < n; i++) {
    final delta = values[i] - values[i - 1];
    final g = delta > 0 ? delta : 0.0;
    final l = delta < 0 ? -delta : 0.0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/// Newton–Raphson sqrt is overkill; keep it dependency free and readable.
double _sqrt(double value) {
  if (value <= 0) return 0;
  var guess = value / 2;
  for (var i = 0; i < 24; i++) {
    guess = (guess + value / guess) / 2;
  }
  return guess;
}

/// Convert an overlay series into fl_chart/CandleChart friendly `double` lists
/// (nulls become NaN so the painter skips them).
List<double> toDense(List<double?>? series) => [for (final v in series ?? const <double?>[]) v ?? double.nan];
