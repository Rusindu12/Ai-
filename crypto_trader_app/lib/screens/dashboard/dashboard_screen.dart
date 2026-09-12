import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../models/models.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/pickers.dart';
import '../settings/settings_screen.dart';

/// Screen 2 — the market overview: sentiment, movers, watchlist, ticker table.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key, this.onOpenTrade});

  final VoidCallback? onOpenTrade;

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  String _sort = 'volume'; // volume | gainers | losers | name
  bool _watchOnly = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    ref.invalidate(tickerTableProvider);
  }

  List<Ticker> _rows(Map<String, Ticker> source) {
    final watch = ref.read(watchlistProvider).valueOrNull?.map((w) => w.symbol).toSet() ?? <String>{};
    var rows = source.values.toList();
    if (_watchOnly && watch.isNotEmpty) rows = rows.where((r) => watch.contains(r.symbol)).toList();
    switch (_sort) {
      case 'gainers':
        rows.sort((a, b) => b.changePct.compareTo(a.changePct));
      case 'losers':
        rows.sort((a, b) => a.changePct.compareTo(b.changePct));
      case 'name':
        rows.sort((a, b) => a.symbol.compareTo(b.symbol));
      default:
        rows.sort((a, b) => b.quoteVolume.compareTo(a.quoteVolume));
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final tickersAsync = ref.watch(tickerTableProvider);
    final summary = ref.watch(marketSummaryProvider).valueOrNull;
    final sentiment = ref.watch(sentimentProvider).valueOrNull;
    final sparklines = ref.watch(sparklineProvider).valueOrNull ?? const {};
    final watchlist = ref.watch(watchlistProvider).valueOrNull ?? const [];
    final watched = watchlist.map((w) => w.symbol).toSet();
    final selected = ref.watch(selectedSymbolProvider);
    final theme = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(marketSummaryProvider);
        ref.invalidate(sentimentProvider);
        ref.invalidate(sparklineProvider);
        ref.invalidate(watchlistProvider);
        await ref.read(tickerTableProvider.notifier).load();
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 90),
        children: [
          if (sentiment != null) _SentimentHero(sentiment: sentiment, summary: summary),
          const SizedBox(height: 10),
          if (summary != null)
            Row(
              children: [
                Expanded(child: StatTile(label: 'Tracked', value: '${summary.tracked}', secondary: 'pairs on this backend', icon: Icons.visibility_outlined)),
                const SizedBox(width: 8),
                Expanded(
                  child: StatTile(
                    label: '24h volume',
                    value: '\$${fmtCompact(summary.totalQuoteVolumeUsd)}',
                    secondary: '${summary.advancers} up / ${summary.decliners} down',
                    icon: Icons.swap_horiz,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: StatTile(
                    label: 'Feed',
                    value: summary.demoMode ? 'Simulator' : (summary.streamConnected ? 'Binance WS' : 'REST'),
                    secondary: summary.secondsSinceEvent > 0 ? '${summary.secondsSinceEvent.toStringAsFixed(1)}s ago' : 'streaming',
                    color: summary.streamConnected ? AppColors.up : AppColors.ai,
                    icon: Icons.sensors,
                  ),
                ),
              ],
            ),
          const SizedBox(height: 12),
          if (summary != null && (summary.gainers.isNotEmpty || summary.losers.isNotEmpty))
            _MoverStrip(title: 'Top movers', gainers: summary.gainers, losers: summary.losers, onPick: _select),
          const SectionTitle(text: 'Markets', icon: Icons.list_alt),
          SectionCard(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'volume', label: Text('Vol')),
                          ButtonSegment(value: 'gainers', label: Text('Gainers')),
                          ButtonSegment(value: 'losers', label: Text('Losers')),
                          ButtonSegment(value: 'name', label: Text('A-Z')),
                        ],
                        selected: {_sort},
                        showSelectedIcon: false,
                        style: SegmentedButton.styleFrom(visualDensity: VisualDensity.compact, textStyle: const TextStyle(fontSize: 11)),
                        onSelectionChanged: (value) => setState(() => _sort = value.first),
                      ),
                    ),
                    IconButton(
                      tooltip: _watchOnly ? 'Show all' : 'Watchlist only',
                      onPressed: () => setState(() => _watchOnly = !_watchOnly),
                      icon: Icon(watched.isEmpty ? Icons.star_border : Icons.filter_alt, size: 19, color: _watchOnly ? AppColors.ai : null),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                tickersAsync.when(
                  loading: () => const LoadingBox(height: 160, message: 'Loading prices…'),
                  error: (error, _) => ErrorView(
                    error: error,
                    onRetry: () => ref.read(tickerTableProvider.notifier).load(),
                  ),
                  data: (rows) {
                    final list = _rows(rows);
                    if (list.isEmpty) {
                      return const EmptyState(
                        icon: Icons.marketplace_update_outlined,
                        title: 'No tickers yet',
                        message: 'The backend is warming its cache — pull to refresh in a second.',
                        compact: true,
                      );
                    }
                    return Column(
                      children: [
                        for (final ticker in list)
                          TickerRow(
                            ticker: ticker,
                            selected: ticker.symbol == selected,
                            sparkline: sparklines[ticker.symbol],
                            watched: watched.contains(ticker.symbol),
                            onWatch: () async {
                              if (watched.contains(ticker.symbol)) {
                                await ref.read(backendApiProvider).removeWatch(ticker.symbol);
                              } else {
                                await ref.read(backendApiProvider).addWatch(ticker.symbol);
                              }
                              ref.invalidate(watchlistProvider);
                            },
                            onTap: () => _select(ticker.symbol),
                          ),
                      ],
                    );
                  },
                ),
                if (theme.useMaterial3) const SizedBox(height: 4),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _SessionCard(onSettings: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()))),
        ],
      ),
    );
  }

  void _select(String symbol) {
    ref.read(selectedSymbolProvider.notifier).state = symbol;
    ref.read(localStoreProvider).setDefaultSymbol(symbol);
    ref.invalidate(orderBookProvider);
    widget.onOpenTrade?.call();
  }
}

class _SentimentHero extends ConsumerWidget {
  const _SentimentHero({required this.sentiment, this.summary});

  final MarketSentiment sentiment;
  final MarketSummary? summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colour = sentiment.bullish ? AppColors.up : (sentiment.bearish ? AppColors.down : AppColors.hold);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(begin: Alignment.centerLeft, end: Alignment.centerRight, colors: [colour.withOpacity(0.22), colour.withOpacity(0.04)]),
        border: Border.all(color: colour.withOpacity(0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(sentiment.bullish ? Icons.trending_up : (sentiment.bearish ? Icons.trending_down : Icons.trending_flat), color: colour, size: 20),
              const SizedBox(width: 8),
              Text('Market ${sentiment.label}', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: colour)),
              const Spacer(),
              Text('score ${sentiment.score.toStringAsFixed(2)}', style: TextStyle(fontSize: 11, color: colour, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: _mini(context, 'avg 24h', fmtPct(sentiment.avgChangePct, decimals: 2))),
              Expanded(child: _mini(context, 'buy signals', '${sentiment.buySignals}')),
              Expanded(child: _mini(context, 'sell', '${sentiment.sellSignals}')),
              Expanded(child: _mini(context, 'hold', '${sentiment.holdSignals}')),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: sentiment.breadthValue,
              minHeight: 4,
              backgroundColor: colour.withOpacity(0.16),
              valueColor: AlwaysStoppedAnimation(colour),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Breadth: ${sentiment.advancers} advancing vs ${sentiment.decliners} declining · updated ${fmtRelative(DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(sentiment.updatedAtMs)))}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 9.5),
          ),
        ],
      ),
    );
  }

  Widget _mini(BuildContext context, String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label.toUpperCase(), style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 8.5, letterSpacing: 0.6)),
        Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
      ],
    );
  }
}

class _MoverStrip extends StatelessWidget {
  const _MoverStrip({required this.title, required this.gainers, required this.losers, required this.onPick});

  final String title;
  final List<Ticker> gainers;
  final List<Ticker> losers;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final items = <Ticker>[...gainers.take(3), ...losers.take(3)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(text: title, icon: Icons.local_fire_department_outlined),
        SizedBox(
          height: 78,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final ticker in items)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: InkWell(
                    onTap: () => onPick(ticker.symbol),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      width: 128,
                      padding: const EdgeInsets.all(9),
                      decoration: BoxDecoration(
                        color: Theme.of(context).cardColor,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: (ticker.isUp ? AppColors.up : AppColors.down).withOpacity(0.35)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(child: Text(ticker.symbol, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800))),
                              Icon(ticker.isUp ? Icons.arrow_upward : Icons.arrow_downward, size: 12, color: ticker.isUp ? AppColors.up : AppColors.down),
                            ],
                          ),
                          const Spacer(),
                          Text(fmtPrice(ticker.price), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                          Text(fmtPct(ticker.changePct), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: ticker.isUp ? AppColors.up : AppColors.down)),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SessionCard extends ConsumerWidget {
  const _SessionCard({required this.onSettings});

  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authStateProvider).valueOrNull?.user;
    final connection = ref.watch(realtimeProvider).currentState;
    return SectionCard(
      title: 'Signed in as ${user?.email ?? 'unknown'}',
      subtitle: 'user #${user?.id ?? 0} · risk ${user?.riskLevel ?? '—'} · ${user?.paperTrading ?? true ? 'paper' : 'live'}',
      trailing: IconButton(onPressed: onSettings, icon: const Icon(Icons.settings_outlined, size: 18)),
      child: Column(
        children: [
          InfoRow(label: 'Stream', value: connection.label, color: connection.live ? AppColors.up : AppColors.ai),
          InfoRow(label: 'Access token', value: 'rotates every ${ref.watch(serverConfigProvider).valueOrNull?.accessTokenMinutes ?? 60} min'),
          InfoRow(label: 'Idle lock', value: '${ref.watch(serverConfigProvider).valueOrNull?.autoLogoutMinutes ?? 15} min'),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () async {
                    await ref.read(authServiceProvider).logout();
                  },
                  icon: const Icon(Icons.logout, size: 16),
                  label: const Text('Sign out'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

