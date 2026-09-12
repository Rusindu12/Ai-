import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../models/trading.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/charts_extras.dart';
import '../../widgets/common.dart';


/// Screen 5 — Portfolio: equity, allocation donut, holdings with sparklines,
/// realised performance, and a CSV export for your tax software.
class PortfolioScreen extends ConsumerStatefulWidget {
  const PortfolioScreen({super.key});

  @override
  ConsumerState<PortfolioScreen> createState() => _PortfolioScreenState();
}

class _PortfolioScreenState extends ConsumerState<PortfolioScreen> {
  bool _exporting = false;

  Future<void> _export() async {
    setState(() => _exporting = true);
    try {
      final bytes = await ref.read(backendApiProvider).exportCsv(days: 90);
      final path = 'cryptotrader_trades_${DateTime.now().millisecondsSinceEpoch}.csv';
      if (mounted) {
        showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text('Export ready (${bytes.length} bytes)'),
            content: Text(
              'Saved on the backend as $path for this session and returned to the app.\n\n'
              'Wire the bytes to share_to_file / a file provider if you want the CSV in Downloads.',
            ),
            actions: [
              TextButton(
                onPressed: () async {
                  await ClipboardProxy.copy(String.fromCharCodes(bytes.take(4096)));
                  if (context.mounted) Navigator.pop(context);
                },
                child: const Text('Copy first rows'),
              ),
              FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
            ],
          ),
        );
      }
    } on Exception catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Export failed: $e')));
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accountAsync = ref.watch(accountProvider);
    final history = ref.watch(portfolioChartProvider).valueOrNull ?? const [];
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(accountProvider);
        ref.invalidate(portfolioChartProvider);
        ref.invalidate(tradeSummaryProvider);
      },
      child: accountAsync.when(
        loading: () => const LoadingBox(height: 300, message: 'Reading your account…'),
        error: (error, _) => ListView(
          children: [
            const SizedBox(height: 80),
            ErrorView(error: error, onRetry: () => ref.invalidate(accountProvider)),
          ],
        ),
        data: (account) => ListView(
          padding: const EdgeInsets.fromLTRB(12, 6, 12, 90),
          children: [
            _EquityHeader(account: account, onExport: _export, exporting: _exporting),
            const SizedBox(height: 10),
            if (history.length > 1) ...[
              SectionCard(
                title: 'Equity (30 days, from the trade ledger)',
                child: EquityCurve(points: history, height: 140, baseline: history.first.equity),
              ),
              const SizedBox(height: 10),
            ],
            Row(
              children: [
                Expanded(
                  child: SectionCard(
                    title: 'Allocation',
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                    child: AllocationDonut(slices: account.allocation, totalUsd: account.totalValueUsd),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SectionCard(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                    title: 'Breakdown',
                    child: Column(
                      children: [
                        InfoRow(label: 'Cash', value: fmtUsd(account.cashUsd)),
                        InfoRow(label: 'Invested', value: fmtUsd(account.investedUsd)),
                        InfoRow(label: 'Positions', value: '${account.holdings.length}'),
                        InfoRow(
                          label: 'Unrealised',
                          value: fmtSignedUsd(account.performance.realizedPnl),
                          color: account.performance.realizedPnl >= 0 ? AppColors.up : AppColors.down,
                          bold: true,
                        ),
                        InfoRow(label: 'Fees paid', value: fmtUsd(account.performance.feesPaid)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SectionTitle(text: 'Holdings', icon: Icons.layers_outlined),
            if (account.holdings.isEmpty)
              SectionCard(
                child: EmptyState(
                  icon: Icons.account_balance_wallet_outlined,
                  title: 'No open positions',
                  message: account.paperTrading
                      ? 'Paper balance is idle. Buy something from the Trade tab — fills are simulated against live prices.'
                      : 'Your account is flat.',
                  action: FilledButton.tonal(onPressed: () => ref.read(selectedSymbolProvider.notifier).state = 'BTCUSDT', child: const Text('Pick a pair on the Trade tab')),
                  compact: true,
                ),
              )
            else
              Column(
                children: [
                  for (final holding in account.holdings)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: SectionCard(
                        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                        onTap: () {
                          ref.read(selectedSymbolProvider.notifier).state = holding.symbol;
                          ref.read(localStoreProvider).setDefaultSymbol(holding.symbol);
                        },
                        child: Row(
                          children: [
                            SizedBox(
                              width: 62,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(holding.asset, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 13.5)),
                                  Text(holding.symbol, style: theme.textTheme.bodySmall?.copyWith(fontSize: 9)),
                                ],
                              ),
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('${fmtQty(holding.amount)} @ ${fmtPrice(holding.price)}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                                  const SizedBox(height: 2),
                                  Text(
                                    'cost ${fmtPrice(holding.avgBuyPrice)} · alloc ${holding.allocationPct.toStringAsFixed(1)}%',
                                    style: theme.textTheme.bodySmall?.copyWith(fontSize: 9.5),
                                  ),
                                ],
                              ),
                            ),
                            if (holding.sparkline.length > 2) Sparkline(values: holding.sparkline, up: holding.change24hPct >= 0, height: 26),
                            const SizedBox(width: 8),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(fmtUsd(holding.valueUsd), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                                const SizedBox(height: 2),
                                PnlPill(value: holding.unrealizedPnlPct, compact: true),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            const SectionTitle(text: 'Performance', icon: Icons.query_stats),
            SectionCard(
              child: Column(
                children: [
                  KeyValueGrid(
                    rows: [
                      InfoRow(label: 'Realised PnL', value: fmtSignedUsd(account.performance.realizedPnl), color: account.performance.realizedPnl >= 0 ? AppColors.up : AppColors.down, bold: true),
                      InfoRow(label: 'Today', value: fmtSignedUsd(account.performance.realizedToday), color: account.performance.realizedToday >= 0 ? AppColors.up : AppColors.down),
                      InfoRow(label: 'Closed trades', value: '${account.performance.closedTrades}'),
                      InfoRow(label: 'Win rate', value: '${account.performance.winRate.toStringAsFixed(1)}%'),
                      InfoRow(label: 'Wins / losses', value: '${account.performance.wins} / ${account.performance.losses}'),
                      InfoRow(label: 'Profit factor', value: account.performance.profitFactor == null ? '—' : account.performance.profitFactor!.toStringAsFixed(2)),
                      InfoRow(label: 'Avg win', value: fmtUsd(account.performance.avgWin), color: AppColors.up),
                      InfoRow(label: 'Avg loss', value: fmtUsd(account.performance.avgLoss), color: AppColors.down),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: (history.isEmpty || history.first.equity == 0)
                                ? 0
                                : ((history.last.equity / history.first.equity) - 1).clamp(-1, 1) / 2 + 0.5,
                            minHeight: 5,
                            backgroundColor: theme.dividerColor,
                            valueColor: AlwaysStoppedAnimation(history.last.equity >= history.first.equity ? AppColors.up : AppColors.down),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text('30d', style: theme.textTheme.bodySmall?.copyWith(fontSize: 10)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            if (account.paperTrading)
              OutlinedButton.icon(
                onPressed: () async {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('Reset paper account?'),
                      content: const Text('Balances go back to \$10,000 USDT and open paper positions are cleared. Your trade history stays for auditing.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Reset')),
                      ],
                    ),
                  );
                  if (confirmed == true) {
                    await ref.read(backendApiProvider).resetPaper();
                    ref.invalidate(accountProvider);
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Paper account reset')));
                    }
                  }
                },
                icon: const Icon(Icons.restart_alt, size: 16),
                label: const Text('Reset paper balances'),
              ),
            const SizedBox(height: 14),
            Text(
              'Values are marked with the same prices the AI uses, so the chart, the signal and your PnL never disagree.',
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 9.5),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _EquityHeader extends StatelessWidget {
  const _EquityHeader({required this.account, required this.onExport, required this.exporting});

  final AccountSnapshot account;
  final VoidCallback onExport;
  final bool exporting;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.info.withOpacity(0.16), theme.cardColor],
        ),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Total value', style: theme.textTheme.bodySmall?.copyWith(fontSize: 10, letterSpacing: 0.6)),
              const Spacer(),
              IconButton(
                tooltip: 'Export CSV (90 days)',
                onPressed: exporting ? null : onExport,
                icon: exporting
                    ? const SizedBox(height: 15, width: 15, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.download_outlined, size: 18),
              ),
            ],
          ),
          Text(fmtUsd(account.totalValueUsd), style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w900, letterSpacing: -1)),
          const SizedBox(height: 4),
          Row(
            children: [
              PnlPill(value: account.change24hPct),
              const SizedBox(width: 8),
              Text('${fmtSignedUsd(account.change24hUsd)} today', style: theme.textTheme.bodySmall),
              const Spacer(),
              Text('mode: ${account.mode}', style: theme.textTheme.bodySmall?.copyWith(fontSize: 10)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: StatTile(label: 'Cash', value: fmtUsd(account.cashUsd), dense: true)),
              const SizedBox(width: 6),
              Expanded(child: StatTile(label: 'Invested', value: fmtUsd(account.investedUsd), dense: true)),
              const SizedBox(width: 6),
              Expanded(
                child: StatTile(
                  label: 'Limit',
                  value: fmtUsd(account.limits.maxTradeSizeUsd, decimals: 0),
                  secondary: 'risk ${account.limits.riskLevel}',
                  dense: true,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Clipboard helper (keeps the export demoable without adding a plugin).
class ClipboardProxy {
  static Future<void> copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
  }
}
