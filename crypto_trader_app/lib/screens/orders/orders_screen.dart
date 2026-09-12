import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../models/trading.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';

/// Screen 6 — Orders & History: working (open) orders and the closed ledger,
/// with cancel + close-position actions and per-trade PnL.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  String _filter = 'ALL';

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final openAsync = ref.watch(openOrdersProvider);
    final historyAsync = ref.watch(tradeHistoryProvider);
    final positionsAsync = ref.watch(positionsProvider);
    final summary = ref.watch(tradeSummaryProvider).valueOrNull;
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
            child: Column(
              children: [
                if (summary != null)
                  Row(
                    children: [
                      Expanded(child: StatTile(label: 'Orders', value: '${_num(summary['orders'])}', secondary: '${_num(summary['closed_trades'])} closed', dense: true)),
                      const SizedBox(width: 6),
                      Expanded(
                        child: StatTile(
                          label: 'Realised',
                          value: fmtSignedUsd(_dbl(summary['realized_pnl'])),
                          color: _dbl(summary['realized_pnl']) >= 0 ? AppColors.up : AppColors.down,
                          dense: true,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(child: StatTile(label: 'Win rate', value: '${_dbl(summary['win_rate']).toStringAsFixed(1)}%', secondary: 'PF ${summary['profit_factor'] ?? '—'}', dense: true)),
                      const SizedBox(width: 6),
                      Expanded(child: StatTile(label: 'Volume', value: '\$${fmtCompact(_dbl(summary['volume_usd']))}', secondary: 'fees ${fmtUsd(_dbl(summary['fees_usd']))}', dense: true)),
                    ],
                  ),
                TabBar(
                  controller: _tabs,
                  labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                  tabs: const [
                    Tab(text: 'Open orders'),
                    Tab(text: 'Positions'),
                    Tab(text: 'History'),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                _list(
                  openAsync,
                  (row) => _OrderTile(
                    row: row,
                    trailing: TextButton(
                      onPressed: () async {
                        final id = row.clientOrderId?.isNotEmpty ?? false ? row.clientOrderId! : (row.orderId ?? row.id);
                        try {
                          await ref.read(tradeSubmitProvider.notifier).cancel(id);
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Cancel sent for $id')));
                        } on Exception catch (e) {
                          if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Cancel failed: $e')));
                        }
                      },
                      child: const Text('Cancel', style: TextStyle(color: AppColors.down, fontSize: 11.5)),
                    ),
                  ),
                  emptyTitle: 'No working orders',
                  emptyMessage: 'Limit orders you place appear here until they fill or are cancelled.',
                ),
                _listPositions(positionsAsync),
                _history(historyAsync),
              ],
            ),
          ),
          if (_tabs.index == 2)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Row(
                children: [
                  Text('Filter', style: theme.textTheme.bodySmall),
                  const SizedBox(width: 8),
                  for (final option in const ['ALL', 'BUY', 'SELL', 'AI'])
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(option),
                        selected: _filter == option,
                        visualDensity: VisualDensity.compact,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        labelStyle: const TextStyle(fontSize: 10.5),
                        onSelected: (_) => setState(() => _filter = option),
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _list(AsyncValue<List<TradeRow>> async, Widget Function(TradeRow) build, {required String emptyTitle, required String emptyMessage}) {
    return async.when(
      loading: () => const LoadingBox(height: 200),
      error: (error, _) => ErrorView(error: error, onRetry: () => ref.invalidate(openOrdersProvider)),
      data: (rows) => rows.isEmpty
          ? EmptyState(icon: Icons.inbox_outlined, title: emptyTitle, message: emptyMessage, compact: true)
          : RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(openOrdersProvider);
              },
              child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 90), children: [for (final row in rows) build(row)]),
            ),
    );
  }

  Widget _listPositions(AsyncValue<List<OpenPosition>> async) {
    return async.when(
      loading: () => const LoadingBox(height: 200),
      error: (error, _) => ErrorView(error: error, onRetry: () => ref.invalidate(positionsProvider)),
      data: (rows) => rows.isEmpty
          ? const EmptyState(icon: Icons.layers_outlined, title: 'No open positions', message: 'Flat means zero risk — that is a valid position.', compact: true)
          : ListView(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 90),
              children: [
                for (final p in rows)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: SectionCard(
                      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              Text(p.symbol, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14)),
                              const SizedBox(width: 8),
                              PnlPill(value: p.unrealizedPnlPct),
                              const Spacer(),
                              Text(fmtUsd(p.valueUsd), style: const TextStyle(fontWeight: FontWeight.w800)),
                            ],
                          ),
                          const SizedBox(height: 6),
                          InfoRow(label: 'Size / entry', value: '${fmtQty(p.qty)} @ ${fmtPrice(p.avgPrice)}'),
                          InfoRow(label: 'Mark', value: fmtPrice(p.markPrice)),
                          InfoRow(
                            label: 'Unrealised',
                            value: fmtSignedUsd(p.unrealizedPnl),
                            color: p.inProfit ? AppColors.up : AppColors.down,
                            bold: true,
                          ),
                          if (p.takeProfit != null || p.stopLoss != null)
                            InfoRow(
                              label: 'TP / SL',
                              value: '${p.takeProfit == null ? '—' : fmtPrice(p.takeProfit!)}  /  ${p.stopLoss == null ? '—' : fmtPrice(p.stopLoss!)}',
                            ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () => ref.read(selectedSymbolProvider.notifier).state = p.symbol,
                                  icon: const Icon(Icons.show_chart, size: 15),
                                  label: const Text('Chart', style: TextStyle(fontSize: 11.5)),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: FilledButton.tonalIcon(
                                  onPressed: () async {
                                    final confirmed = await showDialog<bool>(
                                      context: context,
                                      builder: (context) => AlertDialog(
                                        title: Text('Close ${p.symbol}?'),
                                        content: Text('Market sell of ${fmtQty(p.qty)} at ~${fmtPrice(p.markPrice)} (${fmtUsd(p.valueUsd)}).'),
                                        actions: [
                                          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                                          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Close now')),
                                        ],
                                      ),
                                    );
                                    if (confirmed != true) return;
                                    try {
                                      final result = await ref.read(tradeSubmitProvider.notifier).submit({
                                        'symbol': p.symbol,
                                        'side': 'SELL',
                                        'order_type': 'MARKET',
                                        'quantity': p.qty,
                                      });
                                      if (mounted && result != null) {
                                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Closed ${p.symbol} · ${fmtSignedUsd(result.realizedPnl)}')));
                                      }
                                    } on Exception catch (e) {
                                      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Close failed: $e')));
                                    }
                                  },
                                  icon: const Icon(Icons.flash_on, size: 15),
                                  label: const Text('Market close', style: TextStyle(fontSize: 11.5)),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
    );
  }

  Widget _history(AsyncValue<List<TradeRow>> async) {
    return async.when(
      loading: () => const LoadingBox(height: 200),
      error: (error, _) => ErrorView(error: error, onRetry: () => ref.invalidate(tradeHistoryProvider)),
      data: (rows) {
        final filtered = _filter == 'ALL'
            ? rows
            : (_filter == 'AI'
                ? rows.where((r) => r.source == 'ai' || r.aiSignalId != null).toList()
                : rows.where((r) => r.side.toUpperCase() == _filter).toList());
        if (filtered.isEmpty) {
          return const EmptyState(icon: Icons.history, title: 'Nothing here yet', message: 'Fills land in this ledger the moment the exchange accepts them.', compact: true);
        }
        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(tradeHistoryProvider);
            ref.invalidate(tradeSummaryProvider);
          },
          child: ListView(padding: const EdgeInsets.fromLTRB(12, 8, 12, 90), children: [
            for (final row in filtered) _TradeTile(row: row),
          ]),
        );
      },
    );
  }

  static int _num(Object? value) => value is int ? value : int.tryParse('$value') ?? 0;
  static double _dbl(Object? value) => value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.row, this.trailing});

  final TradeRow row;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colour = row.isBuy ? AppColors.up : AppColors.down;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: SectionCard(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(color: colour.withOpacity(0.16), borderRadius: BorderRadius.circular(5)),
              child: Text(row.side.toUpperCase(), style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: colour)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${row.symbol} · ${row.status}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                  Text('${fmtQty(row.qty)} @ ${fmtPrice(row.price)} = ${fmtUsd(row.notional)}', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10.5)),
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}

class _TradeTile extends StatelessWidget {
  const _TradeTile({required this.row});

  final TradeRow row;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colour = row.isBuy ? AppColors.up : AppColors.down;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: theme.cardColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.dividerColor),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 52,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(fmtTime(row.when), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
                  Text(row.when.day.toString().padLeft(2, '0') + '/' + row.when.month.toString().padLeft(2, '0'), style: theme.textTheme.bodySmall?.copyWith(fontSize: 9)),
                ],
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(row.symbol, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                      const SizedBox(width: 6),
                      Text(row.side.toUpperCase(), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: colour)),
                      if (row.paper) ...[
                        const SizedBox(width: 6),
                        const Text('paper', style: TextStyle(fontSize: 9, color: AppColors.ai)),
                      ],
                      if (row.aiSignalId != null) ...[
                        const SizedBox(width: 6),
                        const Icon(Icons.auto_awesome, size: 10, color: AppColors.ai),
                      ],
                    ],
                  ),
                  Text(
                    '${fmtQty(row.qty)} @ ${fmtPrice(row.price)}  ·  fee ${fmtUsd(row.fee)}',
                    style: theme.textTheme.bodySmall?.copyWith(fontSize: 10),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(fmtUsd(row.notional), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
                if (row.realizedPnl != null && row.realizedPnl != 0)
                  Text(
                    fmtSignedUsd(row.realizedPnl!),
                    style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: row.realizedPnl! >= 0 ? AppColors.up : AppColors.down),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
