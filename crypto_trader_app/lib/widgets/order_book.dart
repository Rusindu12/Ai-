import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/models.dart';
import 'common.dart';

/// Order-book ladder with cumulative depth bars and a spread/imbalance header.
class OrderBookLadder extends StatelessWidget {
  const OrderBookLadder({
    super.key,
    required this.book,
    this.rows = 10,
    this.onPickPrice,
    this.compact = false,
  });

  final OrderBook book;
  final int rows;
  final ValueChanged<double>? onPickPrice;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final maxQty = book.maxSideQty;
    final asks = book.asks.take(rows).toList();
    final bids = book.bids.take(rows).toList();
    // Asks render bottom-up (worst first) so the best ask sits next to mid.
    asks
      ..sort((a, b) => b[0].compareTo(a[0]));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            children: [
              Expanded(
                child: InfoRow(label: 'Spread', value: '${book.spreadBps.toStringAsFixed(2)} bps'),
              ),
              Expanded(
                child: InfoRow(
                  label: 'Depth imbalance',
                  value: fmtPct(book.imbalance * 100, decimals: 1),
                  color: book.imbalance >= 0 ? AppColors.up : AppColors.down,
                  bold: true,
                ),
              ),
            ],
          ),
        ),
        _header(context, 'Bid / Ask'),
        for (final level in asks)
          _row(context, price: level[0], qty: level[1], maxQty: maxQty, isBid: false),
        Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.info.withOpacity(0.4)),
          ),
          child: Row(
            children: [
              Text(fmtPrice(book.midPrice), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
              const Spacer(),
              Text(
                'mid ${fmtPrice(book.midPrice)}  •  ${book.fromCache ? 'cached' : 'live'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10),
              ),
            ],
          ),
        ),
        for (final level in bids)
          _row(context, price: level[0], qty: level[1], maxQty: maxQty, isBid: true),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: _sum(context, 'Bid depth', book.bids.take(20).fold<double>(0, (s, l) => s + l[1])),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _sum(context, 'Ask depth', book.asks.take(20).fold<double>(0, (s, l) => s + l[1])),
            ),
          ],
        ),
      ],
    );
  }

  Widget _header(BuildContext context, String label) {
    final style = TextStyle(fontSize: 9.5, letterSpacing: 0.5, color: Theme.of(context).textTheme.bodySmall?.color);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2, horizontal: 4),
      child: Row(
        children: [
          Expanded(child: Text(label.toUpperCase(), style: style)),
          Expanded(child: Text('PRICE', style: style, textAlign: TextAlign.right)),
          Expanded(child: Text('SIZE', style: style, textAlign: TextAlign.right)),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, {required double price, required double qty, required double maxQty, required bool isBid}) {
    final colour = isBid ? AppColors.up : AppColors.down;
    final fraction = maxQty <= 0 ? 0.0 : (qty / maxQty).clamp(0.0, 1.0);
    return InkWell(
      onTap: onPickPrice == null ? null : () => onPickPrice!(price),
      child: Stack(
        children: [
          Positioned.fill(
            child: Align(
              alignment: Alignment.centerRight,
              child: Container(width: fraction * 160, color: colour.withOpacity(0.13)),
            ),
          ),
          Padding(
            padding: EdgeInsets.symmetric(vertical: compact ? 1.5 : 2.5, horizontal: 4),
            child: Row(
              children: [
                Expanded(child: Text(isBid ? 'BID' : 'ASK', style: TextStyle(fontSize: 9.5, color: colour, fontWeight: FontWeight.w700))),
                Expanded(child: MonoText(fmtPrice(price), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600))),
                Expanded(child: MonoText(fmtQty(qty), style: TextStyle(fontSize: 11, color: Theme.of(context).textTheme.bodyMedium?.color))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sum(BuildContext context, String label, double value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        color: Theme.of(context).dividerColor.withOpacity(0.25),
      ),
      child: Row(
        children: [
          Expanded(child: Text(label, style: const TextStyle(fontSize: 10.5))),
          Text(fmtQty(value), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
