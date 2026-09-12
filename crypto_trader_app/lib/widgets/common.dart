import 'package:flutter/material.dart';

import '../core/errors.dart';
import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/websocket_service.dart';

/// Card with consistent padding/heading used on every screen.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.trailing,
    this.padding = const EdgeInsets.all(14),
    this.onTap,
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final EdgeInsets padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final hasHeader = title != null || trailing != null;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: padding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (hasHeader)
                Padding(
                  padding: EdgeInsets.only(bottom: title == null ? 0 : 10),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (title != null)
                              Text(title!, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5)),
                            if (subtitle != null)
                              Text(
                                subtitle!,
                                style: TextStyle(fontSize: 11.5, color: Theme.of(context).textTheme.bodySmall?.color),
                              ),
                          ],
                        ),
                      ),
                      if (trailing != null) trailing!,
                    ],
                  ),
                ),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    this.secondary,
    this.color,
    this.icon,
    this.dense = false,
  });

  final String label;
  final String value;
  final String? secondary;
  final Color? color;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: dense ? 8 : 11),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 12, color: color ?? theme.textTheme.bodySmall?.color),
                const SizedBox(width: 4),
              ],
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 10, letterSpacing: 0.4),
                ),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontWeight: FontWeight.w700, fontSize: dense ? 13 : 15, color: color),
          ),
          if (secondary != null)
            Text(secondary!, style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5)),
        ],
      ),
    );
  }
}

/// +/- % pill (green/red) used next to prices everywhere.
class PnlPill extends StatelessWidget {
  const PnlPill({super.key, required this.value, this.suffix = '%', this.compact = false, this.alwaysSign = true});

  final double value;
  final String suffix;
  final bool compact;
  final bool alwaysSign;

  @override
  Widget build(BuildContext context) {
    final up = value >= 0;
    final colour = up ? AppColors.up : AppColors.down;
    final text = '${alwaysSign && up ? '+' : ''}${value.toStringAsFixed(compact ? 1 : 2)}$suffix';
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 5 : 7, vertical: compact ? 1.5 : 3),
      decoration: BoxDecoration(
        color: colour.withOpacity(0.14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: colour.withOpacity(0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(up ? Icons.arrow_upward : Icons.arrow_downward, size: compact ? 9 : 11, color: colour),
          const SizedBox(width: 2),
          Text(text, style: TextStyle(fontSize: compact ? 10 : 11.5, fontWeight: FontWeight.w700, color: colour)),
        ],
      ),
    );
  }
}

class SignalActionChip extends StatelessWidget {
  const SignalActionChip({super.key, required this.action, this.confidence, this.size = 1.0, this.onTap});

  final String action;
  final double? confidence;
  final double size;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colour = AppColors.forAction(action);
    final label = action.toUpperCase();
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10 * size, vertical: 5 * size),
        decoration: BoxDecoration(
          color: colour.withOpacity(0.16),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: colour.withOpacity(0.5)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              label == 'BUY' ? Icons.shopping_cart : label == 'SELL' ? Icons.remove_shopping_cart : Icons.pause_circle,
              size: 13 * size,
              color: colour,
            ),
            SizedBox(width: 4 * size),
            Text(
              label,
              style: TextStyle(color: colour, fontWeight: FontWeight.w800, fontSize: 12 * size, letterSpacing: 0.6),
            ),
            if (confidence != null) ...[
              SizedBox(width: 5 * size),
              Text('${confidence!.round()}%', style: TextStyle(color: colour, fontSize: 11 * size, fontWeight: FontWeight.w700)),
            ],
          ],
        ),
      ),
    );
  }
}

class Sparkline extends StatelessWidget {
  const Sparkline({super.key, required this.values, required this.up, this.height = 30, this.lineWidth = 1.4});

  final List<double> values;
  final bool up;
  final double height;
  final double lineWidth;

  @override
  Widget build(BuildContext context) {
    if (values.length < 2) {
      return SizedBox(height: height, child: const Center(child: Text('·', style: TextStyle(color: Colors.white24))));
    }
    return SizedBox(height: height, width: 74, child: CustomPaint(painter: _SparkPainter(values, up ? AppColors.up : AppColors.down, lineWidth)));
  }
}

class _SparkPainter extends CustomPainter {
  _SparkPainter(this.values, this.color, this.lineWidth);

  final List<double> values;
  final Color color;
  final double lineWidth;

  @override
  void paint(Canvas canvas, Size size) {
    var lo = values.reduce(min2);
    var hi = values.reduce(max2);
    for (final v in values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    final range = hi - lo;
    final safe = range == 0 ? (hi.abs() < 1e-9 ? 1.0 : hi.abs()) : range;
    final stepX = size.width / (values.length - 1);
    final line = Path();
    final fill = Path()..moveTo(0, size.height);
    for (var i = 0; i < values.length; i++) {
      final x = i * stepX;
      final y = size.height - (values[i] - lo) / safe * (size.height * 0.86) - size.height * 0.07;
      if (i == 0) {
        line.moveTo(x, y);
      } else {
        line.lineTo(x, y);
      }
      fill.lineTo(x, y);
    }
    fill
      ..lineTo(size.width, size.height)
      ..close();
    canvas.drawPath(fill, Paint()..color = color.withOpacity(0.16));
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = lineWidth
        ..isAntiAlias = true,
    );
  }

  static double min2(double a, double b) => a < b ? a : b;
  static double max2(double a, double b) => a > b ? a : b;

  @override
  bool shouldRepaint(_SparkPainter old) => old.values != values || old.color != color;
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action, this.compact = false});

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.symmetric(vertical: compact ? 18 : 42, horizontal: 18),
      child: Column(
        children: [
          Icon(icon, size: compact ? 26 : 40, color: theme.textTheme.bodySmall?.color),
          SizedBox(height: compact ? 8 : 14),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(message!, textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
          ],
          if (action != null) ...[const SizedBox(height: 14), action!],
        ],
      ),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry, this.compact = false});

  final Object error;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final isNetwork = error is AppException && error.isNetwork;
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(isNetwork ? Icons.wifi_off : Icons.error_outline, color: AppColors.down, size: compact ? 22 : 32),
          const SizedBox(height: 8),
          Text(
            error.toString().replaceFirst('AppException', '').replaceFirst(RegExp(r'^\(|\)$'), ''),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh, size: 16), label: const Text('Retry')),
          ],
        ],
      ),
    );
  }
}

class LoadingBox extends StatelessWidget {
  const LoadingBox({super.key, this.height = 120, this.message});

  final double height;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
            if (message != null) ...[const SizedBox(height: 8), Text(message!, style: Theme.of(context).textTheme.bodySmall)],
          ],
        ),
      ),
    );
  }
}

class InfoRow extends StatelessWidget {
  const InfoRow({super.key, required this.label, required this.value, this.color, this.bold = false});

  final String label;
  final String value;
  final Color? color;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 12, color: Theme.of(context).textTheme.bodySmall?.color))),
          Text(
            value,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
              color: color,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

/// Two-column key/value table used in settings/summary blocks.
class KeyValueGrid extends StatelessWidget {
  const KeyValueGrid({super.key, required this.rows, this.columns = 2});

  final List<Widget> rows;
  final int columns;

  @override
  Widget build(BuildContext context) {
    final perRow = <Row>[];
    for (var i = 0; i < rows.length; i += columns) {
      final cells = <Widget>[];
      for (var j = 0; j < columns; j++) {
        final index = i + j;
        cells.add(Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: j == columns - 1 ? 0 : 10, top: 3, bottom: 3),
            child: index < rows.length ? rows[index] : const SizedBox(height: 14),
          ),
        ));
      }
      perRow.add(Row(crossAxisAlignment: CrossAxisAlignment.start, children: cells));
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: perRow);
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle({super.key, required this.text, this.trailing, this.icon});

  final String text;
  final Widget? trailing;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 14, 2, 8),
      child: Row(
        children: [
          if (icon != null) ...[Icon(icon, size: 15, color: AppColors.info), const SizedBox(width: 6)],
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: TextStyle(
                fontSize: 11,
                letterSpacing: 1.1,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).textTheme.bodySmall?.color,
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class ModeBanner extends StatelessWidget {
  const ModeBanner({super.key, required this.paperTrading, required this.demoMode, this.canWithdraw = false});

  final bool paperTrading;
  final bool demoMode;
  final bool canWithdraw;

  @override
  Widget build(BuildContext context) {
    final Color colour;
    final String text;
    if (demoMode) {
      colour = AppColors.info;
      text = 'DEMO — simulated market & paper fills, no real orders are possible';
    } else if (paperTrading) {
      colour = AppColors.ai;
      text = 'PAPER TRADING — live Binance prices, orders are simulated';
    } else if (canWithdraw) {
      colour = AppColors.down;
      text = 'LIVE — real orders with your API key';
    } else {
      colour = AppColors.up;
      text = 'LIVE — trade-only key (withdrawals disabled)';
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      color: colour.withOpacity(0.14),
      child: Row(
        children: [
          Icon(paperTrading || demoMode ? Icons.science_outlined : Icons.bolt, size: 13, color: colour),
          const SizedBox(width: 6),
          Expanded(child: Text(text, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: colour))),
        ],
      ),
    );
  }
}

/// Tabular numbers for price columns.
class MonoText extends StatelessWidget {
  const MonoText(this.text, {super.key, this.style, this.maxLines = 1});

  final String text;
  final TextStyle? style;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      maxLines: maxLines,
      overflow: TextOverflow.ellipsis,
      style: (style ?? const TextStyle()).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
    );
  }
}

String priceOf(double value) => fmtPrice(value);

/// A one-row ticker in the dashboard list: rank, symbol, price, 24h pill,
/// sparkline, and a tap to open the trade screen.
class TickerRow extends StatelessWidget {
  const TickerRow({
    super.key,
    required this.ticker,
    required this.onTap,
    this.onWatch,
    this.watched = false,
    this.sparkline,
    this.selected = false,
  });

  final Ticker ticker;
  final VoidCallback onTap;
  final VoidCallback? onWatch;
  final bool watched;
  final List<double>? sparkline;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: selected ? AppColors.info.withOpacity(0.08) : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
          child: Row(
            children: [
              SizedBox(
                width: 74,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      ticker.symbol.replaceAll(RegExp(r'(USDT|BUSD|USDC|FDUSD)$'), ''),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13),
                    ),
                    Text(
                      ticker.symbol.substring(ticker.symbol.length > 4 ? 4 : 0).isEmpty ? 'spot' : ticker.symbol.substring(ticker.symbol.length - 4),
                      style: theme.textTheme.bodySmall?.copyWith(fontSize: 9),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    MonoText(
                      fmtPrice(ticker.price),
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'H ${fmtPrice(ticker.high)}  L ${fmtPrice(ticker.low)}  V ${fmtCompact(ticker.quoteVolume)}',
                      style: theme.textTheme.bodySmall?.copyWith(fontSize: 9),
                    ),
                  ],
                ),
              ),
              if (sparkline != null && sparkline!.length > 2) ...[
                Sparkline(values: sparkline!, up: ticker.isUp),
                const SizedBox(width: 8),
              ],
              PnlPill(value: ticker.changePct, compact: true),
              if (onWatch != null)
                IconButton(
                  onPressed: onWatch,
                  visualDensity: VisualDensity.compact,
                  iconSize: 17,
                  icon: Icon(watched ? Icons.star : Icons.star_border, color: watched ? AppColors.ai : theme.textTheme.bodySmall?.color),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The little live/offline indicator in every app bar.
class ConnectionBadge extends StatelessWidget {
  const ConnectionBadge({super.key, required this.state, this.events = 0, this.onTap});

  final ConnectionState state;
  final int events;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colour = switch (state.status) {
      SocketStatus.connected => AppColors.up,
      SocketStatus.connecting || SocketStatus.reconnecting => AppColors.ai,
      SocketStatus.waitingForAuth => AppColors.hold,
      SocketStatus.disconnected => AppColors.down,
    };
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: colour, shape: BoxShape.circle, boxShadow: [BoxShadow(color: colour.withOpacity(0.7), blurRadius: 6)]),
            ),
            const SizedBox(width: 6),
            Text(
              state.label,
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: colour),
            ),
            if (events > 0) ...[
              const SizedBox(width: 4),
              Text('$events', style: TextStyle(fontSize: 9.5, color: Theme.of(context).textTheme.bodySmall?.color)),
            ],
          ],
        ),
      ),
    );
  }
}
