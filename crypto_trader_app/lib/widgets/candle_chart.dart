import 'dart:math';

import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/models.dart';

/// Candlestick chart painted by hand instead of via a charting package.
///
/// Reasons: fl_chart has no candlestick series, and adding a third-party
/// candles package pulls a dependency we cannot easily audit. A CustomPainter
/// is ~250 lines, draws 240 candles at 60fps with no rebuilds, and lets us
/// overlay exactly the levels we care about (VWAP, EMA, BB, S/R, AI plan).
class CandleChart extends StatefulWidget {
  const CandleChart({
    super.key,
    required this.candles,
    this.vwap = const [],
    this.emaFast = const [],
    this.emaSlow = const [],
    this.bollingerUpper = const [],
    this.bollingerLower = const [],
    this.supports = const [],
    this.resistances = const [],
    this.plan,
    this.priceLabelColor = AppColors.info,
    this.height = 260,
    this.showVolume = true,
    this.onCandleSelected,
  });

  final List<Candle> candles;

  /// Optional overlay series (same length as [candles], NaN/null = skip).
  final List<double> vwap;
  final List<double> emaFast;
  final List<double> emaSlow;
  final List<double> bollingerUpper;
  final List<double> bollingerLower;

  final List<double> supports;
  final List<double> resistances;
  final TradePlan? plan;
  final Color priceLabelColor;
  final double height;
  final bool showVolume;
  final ValueChanged<int>? onCandleSelected;

  @override
  State<CandleChart> createState() => _CandleChartState();
}

class _CandleChartState extends State<CandleChart> {
  final ScrollController _scroll = ScrollController();
  int _hoverIndex = -1;
  double _scale = 1;

  static const double _rightAxis = 66;
  static const double _bottomAxis = 20;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  int get _visibleCount {
    if (widget.candles.isEmpty) return 0;
    return max(20, (widget.candles.length / _scale).round());
  }

  double get _offset {
    final total = widget.candles.length;
    final visible = _visibleCount;
    if (total <= visible) return 0;
    if (!_scroll.hasClients) return (total - visible).toDouble();
    final maxScroll = (total - visible).toDouble();
    final perPx = maxScroll / max(_scroll.position.maxScrollExtent, 1);
    return (_scroll.offset * perPx).clamp(0.0, maxScroll);
  }

  @override
  Widget build(BuildContext context) {
    if (widget.candles.isEmpty) {
      return SizedBox(
        height: widget.height,
        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    final candles = widget.candles;
    final visible = min(_visibleCount, candles.length);
    final start = (candles.length - visible).clamp(0, candles.length).toInt();
    // `_offset` lets a drag scroll back in time; here we simply anchor to the
    // right edge (live view) and allow panning left through the offset.
    final leftShift = _offset.round();
    final first = max(0, start - leftShift);
    final window = candles.sublist(first, min(candles.length, first + visible));
    if (window.isEmpty) return SizedBox(height: widget.height);

    double lo = double.infinity, hi = double.negativeInfinity, maxVol = 0;
    for (final c in window) {
      lo = min(lo, c.low);
      hi = max(hi, c.high);
      maxVol = max(maxVol, c.volume);
    }
    for (final level in [...widget.supports, ...widget.resistances]) {
      if (level > 0) {
        lo = min(lo, level);
        hi = max(hi, level);
      }
    }
    final plan = widget.plan;
    if (plan != null && plan.hasLevels) {
      lo = min(lo, plan.stopLoss);
      hi = max(hi, plan.takeProfit);
    }
    if (!lo.isFinite || !hi.isFinite || hi <= lo) {
      hi = lo + (lo.abs() * 0.01).clamp(1e-8, double.infinity);
    }
    final pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;

    return GestureDetector(
      onDoubleTap: () => setState(() => _scale = 1),
      onScaleUpdate: (details) {
        final next = (details.scale * _scale).clamp(1.0, 6.0);
        if ((next - _scale).abs() > 0.01) setState(() => _scale = next);
      },
      onHorizontalDragUpdate: widget.candles.length > visible
          ? (details) {
              if (_scroll.hasClients) {
                _scroll.jumpTo((_scroll.offset - details.delta.dx).clamp(0.0, _scroll.position.maxScrollExtent));
              }
            }
          : null,
      onTapUp: (details) {
        if (widget.onCandleSelected == null) return;
        final local = details.localPosition;
        final chartWidth = context.size?.width ?? 0;
        final idx = ((local.dx / max(chartWidth - _rightAxis, 1)) * window.length).floor();
        if (idx >= 0 && idx < window.length) {
          widget.onCandleSelected!(first + idx);
        }
      },
      child: SizedBox(
        height: widget.height,
        child: LayoutBuilder(
          builder: (context, box) {
            return CustomPaint(
              size: Size(box.maxWidth, widget.height),
              painter: _CandlePainter(
                candles: window,
                low: lo,
                high: hi,
                maxVolume: maxVol,
                theme: Theme.of(context),
                vwap: _slice(widget.vwap, first, window.length),
                emaFast: _slice(widget.emaFast, first, window.length),
                emaSlow: _slice(widget.emaSlow, first, window.length),
                bbUpper: _slice(widget.bollingerUpper, first, window.length),
                bbLower: _slice(widget.bollingerLower, first, window.length),
                supports: widget.supports,
                resistances: widget.resistances,
                plan: plan,
                showVolume: widget.showVolume,
                hoverIndex: _hoverIndex,
              ),
            );
          },
        ),
      ),
    );
  }

  List<double>? _slice(List<double>? source, int start, int length) {
    if (source == null || source!.isEmpty) return null;
    final from = min(start, source.length);
    final to = min(from + length, source.length);
    return source.sublist(from, to);
  }
}

class _CandlePainter extends CustomPainter {
  _CandlePainter({
    required this.candles,
    required this.low,
    required this.high,
    required this.maxVolume,
    required this.theme,
    required this.showVolume,
    required this.supports,
    required this.resistances,
    this.vwap,
    this.emaFast,
    this.emaSlow,
    this.bbUpper,
    this.bbLower,
    this.plan,
    this.hoverIndex = -1,
  });

  final List<Candle> candles;
  final double low;
  final double high;
  final double maxVolume;
  final ThemeData theme;
  final bool showVolume;
  final List<double> supports;
  final List<double> resistances;
  final List<double>? vwap;
  final List<double>? emaFast;
  final List<double>? emaSlow;
  final List<double>? bbUpper;
  final List<double>? bbLower;
  final TradePlan? plan;
  final int hoverIndex;

  static const double _axisW = 66;
  static const double _axisH = 20;

  @override
  void paint(Canvas canvas, Size size) {
    final chartRect = Rect.fromLTRB(0, 0, size.width - _axisW, size.height - _axisH);
    if (chartRect.width <= 0 || chartRect.height <= 0) return;
    final priceAreaHeight = showVolume ? chartRect.height * 0.76 : chartRect.height;
    final volumeRect = Rect.fromLTRB(0, priceAreaHeight, chartRect.width, chartRect.height);
    final priceRect = Rect.fromLTRB(0, 0, chartRect.width, priceAreaHeight);

    double y(double price) => priceRect.bottom - (price - low) / (high - low) * priceRect.height;
    final slot = chartRect.width / candles.length;
    double x(int i) => chartRect.left + slot * (i + 0.5);

    _drawGrid(canvas, chartRect, theme, y, priceRect);

    // Bollinger fill.
    if (bbUpper != null && bbLower != null) {
      final path = Path();
      var started = false;
      for (var i = 0; i < candles.length; i++) {
        final v = bbUpper![min(i, bbUpper!.length - 1)];
        if (!v.isFinite) continue;
        if (!started) {
          path.moveTo(x(i), y(v));
          started = true;
        } else {
          path.lineTo(x(i), y(v));
        }
      }
      for (var i = candles.length - 1; i >= 0; i--) {
        final v = bbLower![min(i, bbLower!.length - 1)];
        if (!v.isFinite) continue;
        path.lineTo(x(i), y(v));
      }
      if (started) {
        path.close();
        canvas.drawPath(path, Paint()..color = AppColors.info.withOpacity(0.07));
      }
    }

    _drawSeries(canvas, bbUpper, x, y, AppColors.info.withOpacity(0.5), 1);
    _drawSeries(canvas, bbLower, x, y, AppColors.info.withOpacity(0.5), 1);
    _drawSeries(canvas, vwap, x, y, Colors.white.withOpacity(0.55), 1.2);
    _drawSeries(canvas, emaFast, x, y, AppColors.ai, 1.4);
    _drawSeries(canvas, emaSlow, x, y, const Color(0xFFA78BFA), 1.4);

    // Support / resistance lines.
    final sr = Paint()..strokeWidth = 1;
    for (final level in supports) {
      if (level < low || level > high) continue;
      sr.color = AppColors.up.withOpacity(0.55);
      _dashed(canvas, Offset(chartRect.left, y(level)), Offset(chartRect.right, y(level)), sr);
    }
    for (final level in resistances) {
      if (level < low || level > high) continue;
      sr.color = AppColors.down.withOpacity(0.55);
      _dashed(canvas, Offset(chartRect.left, y(level)), Offset(chartRect.right, y(level)), sr);
    }

    // Candles.
    final body = Paint()..style = PaintingStyle.fill;
    final wick = Paint()..style = PaintingStyle.stroke..strokeWidth = max(1.0, slot * 0.08);
    final candleW = max(1.5, slot * 0.62);
    for (var i = 0; i < candles.length; i++) {
      final c = candles[i];
      final colour = c.isUp ? AppColors.up : AppColors.down;
      body.color = colour;
      wick.color = colour;
      final cx = x(i);
      canvas.drawLine(Offset(cx, y(c.high)), Offset(cx, y(c.low)), wick);
      final top = y(max(c.open, c.close));
      final bottom = y(min(c.open, c.close));
      final h = max(bottom - top, 1.0);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(cx - candleW / 2, top, candleW, h),
          const Radius.circular(1.5),
        ),
        body,
      );
    }

    // Volume histogram.
    if (showVolume && maxVolume > 0) {
      for (var i = 0; i < candles.length; i++) {
        final c = candles[i];
        final h = (c.volume / maxVolume) * (volumeRect.height * 0.9);
        body.color = (c.isUp ? AppColors.up : AppColors.down).withOpacity(0.45);
        canvas.drawRect(
          Rect.fromLTWH(x(i) - candleW / 2, volumeRect.bottom - h, candleW, h),
          body,
        );
      }
    }

    // AI trade plan.
    final p = plan;
    if (p != null && p.hasLevels) {
      _level(canvas, chartRect, y(p.entry), 'ENTRY ${_short(p.entry)}', AppColors.info);
      _level(canvas, chartRect, y(p.takeProfit), 'TP ${_short(p.takeProfit)}', AppColors.up);
      _level(canvas, chartRect, y(p.stopLoss), 'SL ${_short(p.stopLoss)}', AppColors.down);
    }

    // Last price marker.
    final last = candles.last;
    final yLast = y(last.close);
    final line = Paint()
      ..color = (last.isUp ? AppColors.up : AppColors.down).withOpacity(0.85)
      ..strokeWidth = 1;
    _dashed(canvas, Offset(chartRect.left, yLast), Offset(chartRect.right, yLast), line);
    _priceTag(canvas, Offset(size.width - _axisW + 4, yLast - 9), _short(last.close),
        last.isUp ? AppColors.up : AppColors.down, Colors.black);

    _drawAxis(canvas, size, priceRect, theme, y);
  }

  void _drawGrid(Canvas canvas, Rect rect, ThemeData theme, double Function(double) y, Rect priceRect) {
    final grid = Paint()
      ..color = theme.dividerColor.withOpacity(0.35)
      ..strokeWidth = 0.6;
    for (var i = 1; i < 5; i++) {
      final yy = priceRect.top + priceRect.height * i / 5;
      canvas.drawLine(Offset(rect.left, yy), Offset(rect.right, yy), grid);
    }
    for (var i = 1; i < 6; i++) {
      final xx = rect.left + rect.width * i / 6;
      canvas.drawLine(Offset(xx, rect.top), Offset(xx, rect.bottom), grid);
    }
  }

  void _drawSeries(Canvas canvas, List<double>? series, double Function(int) x, double Function(double) y, Color color, double width) {
    if (series == null || series.isEmpty) return;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..isAntiAlias = true;
    final path = Path();
    var started = false;
    for (var i = 0; i < candles.length; i++) {
      final v = series[min(i, series.length - 1)];
      if (!v.isFinite) continue;
      final px = x(i);
      final py = y(v);
      if (!started) {
        path.moveTo(px, py);
        started = true;
      } else {
        path.lineTo(px, py);
      }
    }
    if (started) canvas.drawPath(path, paint);
  }

  void _dashed(Canvas canvas, Offset from, Offset to, Paint paint) {
    const dash = 5.0;
    const gap = 4.0;
    final total = (to - from).distance;
    if (total <= 0) return;
    final dir = (to - from) / total;
    var travelled = 0.0;
    while (travelled < total) {
      final end = min(travelled + dash, total);
      canvas.drawLine(from + dir * travelled, from + dir * end, paint);
      travelled = end + gap;
    }
  }

  void _level(Canvas canvas, Rect rect, double py, String label, Color color) {
    final paint = Paint()
      ..color = color.withOpacity(0.8)
      ..strokeWidth = 1.1;
    _dashed(canvas, Offset(rect.left, py), Offset(rect.right, py), paint);
    _priceTag(canvas, Offset(rect.left + 4, py - 8), label, color, Colors.white);
  }

  void _priceTag(Canvas canvas, Offset at, String text, Color bg, Color fg) {
    final tp = TextPainter(
      text: TextSpan(text: text, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: fg)),
      textDirection: TextDirection.ltr,
    )..layout();
    final rect = Rect.fromLTWH(at.dx, at.dy, tp.width + 10, tp.height + 4);
    canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)), Paint()..color = bg);
    tp.paint(canvas, Offset(rect.left + 5, rect.top + 2));
  }

  void _drawAxis(Canvas canvas, Size size, Rect priceRect, ThemeData theme, double Function(double) y) {
    final style = TextStyle(fontSize: 9.5, color: theme.textTheme.bodySmall?.color?.withOpacity(0.75));
    final axisX = size.width - _axisW + 6;
    for (var i = 0; i <= 4; i++) {
      final price = high - (high - low) * i / 4;
      final py = y(price);
      final tp = TextPainter(text: TextSpan(text: _short(price), style: style), textDirection: TextDirection.ltr)
        ..layout();
      tp.paint(canvas, Offset(axisX, py - tp.height / 2));
    }
    if (candles.isEmpty) return;
    final timeStyle = style.copyWith(fontSize: 9);
    final step = max(1, (candles.length / 4).floor());
    for (var i = 0; i < candles.length; i += step) {
      final t = candles[i].time;
      final label = '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
      final tp = TextPainter(text: TextSpan(text: label, style: timeStyle), textDirection: TextDirection.ltr)..layout();
      final slot = priceRect.width / candles.length;
      tp.paint(canvas, Offset(i * slot + slot / 2 - tp.width / 2, size.height - _axisH + 3));
    }
  }

  static String _short(double value) {
    final a = value.abs();
    if (a >= 10000) return value.toStringAsFixed(0);
    if (a >= 100) return value.toStringAsFixed(1);
    if (a >= 1) return value.toStringAsFixed(3);
    if (a >= 0.01) return value.toStringAsFixed(5);
    return value.toStringAsFixed(8);
  }

  @override
  bool shouldRepaint(_CandlePainter old) =>
      old.candles != candles ||
      old.low != low ||
      old.high != high ||
      old.maxVolume != maxVolume ||
      old.hoverIndex != hoverIndex ||
      old.plan != plan ||
      old.vwap != vwap ||
      old.emaFast != emaFast;
}
