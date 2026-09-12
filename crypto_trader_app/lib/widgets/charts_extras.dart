import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/ai.dart';
import '../models/models.dart';
import 'common.dart';

/// Line chart for the indicator sub-panes (RSI / MACD histogram / volume).
class IndicatorPane extends StatelessWidget {
  const IndicatorPane({
    super.key,
    required this.title,
    required this.spots,
    this.secondary,
    this.height = 84,
    this.minY,
    this.maxY,
    this.bands = const [],
    this.showZeroLine = false,
    this.color = AppColors.info,
    this.secondaryColor = AppColors.ai,
  });

  final String title;
  final List<FlSpot> spots;
  final List<FlSpot>? secondary;
  final double height;
  final double? minY;
  final double? maxY;
  final List<HLine> bands;
  final bool showZeroLine;
  final Color color;
  final Color secondaryColor;

  @override
  Widget build(BuildContext context) {
    if (spots.length < 2) {
      return SizedBox(height: height, child: Center(child: Text('$title — collecting data', style: Theme.of(context).textTheme.bodySmall)));
    }
    double lo = minY ?? spots.map((s) => s.y).reduce(math.min);
    double hi = maxY ?? spots.map((s) => s.y).reduce(math.max);
    if (showZeroLine) {
      lo = math.min(lo, 0);
      hi = math.max(hi, 0);
    }
    if (hi - lo < 1e-9) {
      hi = lo + 1;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(title.toUpperCase(), style: TextStyle(fontSize: 9.5, letterSpacing: 0.8, color: Theme.of(context).textTheme.bodySmall?.color)),
            const Spacer(),
            Text(
              spots.last.y.toStringAsFixed(spots.last.y.abs() > 100 ? 1 : 3),
              style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.info),
            ),
          ],
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: height,
          child: LineChart(
            LineChartData(
              minY: lo,
              maxY: hi,
              gridData: FlGridData(show: false),
              borderData: FlBorderData(show: false),
              titlesData: const FlTitlesData(show: false),
              extraLinesData: ExtraLinesData(horizontalLines: [...bands, if (showZeroLine) const HLine(y: 0, color: Colors.white24, strokeWidth: 1)]),
              lineTouchData: const LineTouchData(enabled: false),
              lineBarsData: [
                LineChartBarData(
                  spots: spots,
                  isCurved: false,
                  barWidth: 1.6,
                  color: color,
                  dotData: const FlDotData(show: false),
                  belowBarData: BarAreaData(show: true, color: color.withOpacity(0.12)),
                ),
                if (secondary != null)
                  LineChartBarData(
                    spots: secondary!,
                    isCurved: false,
                    barWidth: 1.2,
                    color: secondaryColor,
                    dotData: const FlDotData(show: false),
                  ),
              ],
            ),
            duration: const Duration(milliseconds: 220),
          ),
        ),
      ],
    );
  }
}

/// Portfolio allocation donut (fl_chart's pie).
class AllocationDonut extends StatelessWidget {
  const AllocationDonut({super.key, required this.slices, this.totalUsd = 0, this.size = 148});

  final List<AllocationSlice> slices;
  final double totalUsd;
  final double size;

  static const List<Color> palette = [
    Color(0xFF38BDF8),
    Color(0xFFF59E0B),
    Color(0xFF22C55E),
    Color(0xFFA78BFA),
    Color(0xFFEF4444),
    Color(0xFF14B8A6),
    Color(0xFFF472B6),
    Color(0xFFEAB308),
  ];

  @override
  Widget build(BuildContext context) {
    if (slices.isEmpty) {
      return SizedBox(
        height: size,
        child: const Center(child: Text('No holdings yet', style: TextStyle(fontSize: 11.5))),
      );
    }
    final cash = math.max(0, totalUsd - slices.fold<double>(0, (s, x) => s + x.valueUsd));
    final sections = <PieChartSectionData>[
      for (var i = 0; i < slices.length; i++)
        PieChartSectionData(
          value: slices[i].pct <= 0 ? slices[i].valueUsd : slices[i].pct,
          color: palette[(slices[i].colorSeed + i) % palette.length],
          radius: size * 0.19,
          title: slices[i].asset,
          titleStyle: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.black87),
          showTitle: slices[i].pct > 6,
        ),
      if (cash > 0.5)
        PieChartSectionData(
          value: cash / math.max(totalUsd, 1) * 100,
          color: AppColors.hold.withOpacity(0.55),
          radius: size * 0.19,
          title: 'USDT',
          titleStyle: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: Colors.black87),
          showTitle: cash / math.max(totalUsd, 1) > 0.06,
        ),
    ];

    return SizedBox(
      height: size,
      width: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          PieChart(
            PieChartData(
              sections: sections,
              sectionsSpace: 2,
              centerSpaceRadius: size * 0.26,
              startDegreeOffset: -90,
              pieTouchData: PieTouchData(enabled: false),
            ),
            duration: const Duration(milliseconds: 320),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(totalUsd <= 0 ? '—' : '\$${totalUsd.toStringAsFixed(0)}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
              Text('${slices.length} assets', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 9.5)),
            ],
          ),
        ],
      ),
    );
  }
}

/// Equity curve (backtest or portfolio history) with a zero-line reference.
class EquityCurve extends StatelessWidget {
  const EquityCurve({super.key, required this.points, this.height = 150, this.baseline});

  final List<EquityPoint> points;
  final double height;
  final double? baseline;

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) {
      return SizedBox(height: height, child: const Center(child: Text('Not enough trades yet to draw a curve', style: TextStyle(fontSize: 11.5))));
    }
    final spots = [for (var i = 0; i < points.length; i++) FlSpot(i.toDouble(), points[i].equity)];
    final lo = spots.map((s) => s.y).reduce(math.min);
    final hi = spots.map((s) => s.y).reduce(math.max);
    final pad = (hi - lo) * 0.12 + 1e-9;
    final up = points.last.equity >= points.first.equity;
    return SizedBox(
      height: height,
      child: LineChart(
        LineChartData(
          minY: lo - pad,
          maxY: hi + pad,
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: ((hi - lo) / 4).abs() < 1e-9 ? 1 : (hi - lo) / 4,
            getDrawingHorizontalLine: (value) => FlLine(color: Theme.of(context).dividerColor.withOpacity(0.5), strokeWidth: 0.5),
          ),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(),
            rightTitles: const AxisTitles(),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: points.length > 6,
                reservedSize: 18,
                interval: math.max(1, points.length / 4),
                getTitlesWidget: (value, meta) {
                  final index = value.round();
                  if (index < 0 || index >= points.length) return const SizedBox.shrink();
                  final t = points[index].t;
                  if (t <= 0) return const SizedBox.shrink();
                  final date = DateTime.fromMillisecondsSinceEpoch(t);
                  return Padding(
                    padding: const EdgeInsets.only(top: 3),
                    child: Text('${date.day}/${date.month}', style: const TextStyle(fontSize: 8.5)),
                  );
                },
              ),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 44,
                getTitlesWidget: (value, meta) => Text('\$${value.toStringAsFixed(0)}', style: const TextStyle(fontSize: 8.5)),
              ),
            ),
          ),
          extraLinesData: baseline == null
              ? null
              : ExtraLinesData(horizontalLines: [HLine(y: baseline!, color: Colors.white24, strokeWidth: 1, dashArray: const [4, 4])]),
          lineTouchData: const LineTouchData(enabled: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              curveSmoothness: 0.18,
              barWidth: 2,
              color: up ? AppColors.up : AppColors.down,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [(up ? AppColors.up : AppColors.down).withOpacity(0.28), Colors.transparent],
                ),
              ),
            ),
          ],
        ),
        duration: const Duration(milliseconds: 300),
      ),
    );
  }
}

/// Mini RSI/MACD/BB strip rendered from the AI indicator snapshot.
class IndicatorStrip extends StatelessWidget {
  const IndicatorStrip({super.key, required this.indicators, this.compact = true});

  final Indicators indicators;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final i = indicators;
    final rows = <Widget>[
      _GaugeRow(label: 'RSI 14', value: i.rsi, min: 0, max: 100, lowWarn: 30, highWarn: 70, suffix: ''),
      _GaugeRow(label: '%B (BB)', value: i.bbPercentB * 100, min: 0, max: 100, lowWarn: 8, highWarn: 92, suffix: ''),
      _GaugeRow(label: 'MFI', value: i.mfi, min: 0, max: 100, lowWarn: 20, highWarn: 80, suffix: ''),
      _GaugeRow(label: 'Stoch %K', value: i.stochK, min: 0, max: 100, lowWarn: 20, highWarn: 80, suffix: ''),
      _GaugeRow(label: 'ADX', value: i.adx, min: 0, max: 100, lowWarn: 0, highWarn: 0, suffix: ''),
    ];
    return Column(children: rows);
  }
}

class _GaugeRow extends StatelessWidget {
  const _GaugeRow({required this.label, required this.value, required this.min, required this.max, required this.lowWarn, required this.highWarn, required this.suffix});

  final String label;
  final double value;
  final double min;
  final double max;
  final double lowWarn;
  final double highWarn;
  final String suffix;

  @override
  Widget build(BuildContext context) {
    final fraction = ((value - min) / math.max(max - min, 1e-9)).clamp(0.0, 1.0);
    final colour = (highWarn > 0 && value >= highWarn)
        ? AppColors.down
        : (lowWarn > 0 && value <= lowWarn)
            ? AppColors.up
            : AppColors.hold;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(width: 66, child: Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600))),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: fraction,
                minHeight: 5,
                backgroundColor: Theme.of(context).dividerColor.withOpacity(0.35),
                valueColor: AlwaysStoppedAnimation(colour),
              ),
            ),
          ),
          SizedBox(
            width: 52,
            child: Text(
              '${value.toStringAsFixed(1)}$suffix',
              textAlign: TextAlign.right,
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: colour),
            ),
          ),
        ],
      ),
    );
  }
}
