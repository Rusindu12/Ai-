import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../models/app_user.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/pickers.dart';

/// Screen 8 — Alerts: price/alert rules plus the notification inbox.
class AlertsScreen extends ConsumerStatefulWidget {
  const AlertsScreen({super.key});

  @override
  ConsumerState<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends ConsumerState<AlertsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final alertsAsync = ref.watch(alertsProvider);
    final inboxAsync = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Alerts'),
        bottom: TabBar(
          controller: _tabs,
          labelStyle: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800),
          tabs: const [Tab(text: 'Rules'), Tab(text: 'Inbox')],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _rules(alertsAsync),
          _inbox(inboxAsync),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _create(),
        backgroundColor: AppColors.info,
        foregroundColor: Colors.black87,
        icon: const Icon(Icons.add_alert),
        label: const Text('New alert', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
    );
  }

  Widget _rules(AsyncValue<List<PriceAlert>> async) {
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(alertsProvider),
      child: async.when(
        loading: () => const LoadingBox(height: 200),
        error: (error, _) => ListView(children: [ErrorView(error: error, onRetry: () => ref.invalidate(alertsProvider))]),
        data: (rows) => ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
          children: [
            if (rows.isEmpty)
              const EmptyState(
                icon: Icons.notifications_none,
                title: 'No alerts yet',
                message: '“Tell me when BTC crosses 70,000” or “ping me when the AI turns bullish”. The backend evaluates rules every few seconds against its price cache — no battery-draining polling on the phone.',
              )
            else
              for (final alert in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _AlertTile(alert: alert),
                ),
          ],
        ),
      ),
    );
  }

  Widget _inbox(AsyncValue<List<AppNotification>> async) {
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(notificationsProvider);
      },
      child: async.when(
        loading: () => const LoadingBox(height: 200),
        error: (error, _) => ListView(children: [ErrorView(error: error, onRetry: () => ref.invalidate(notificationsProvider))]),
        data: (rows) => rows.isEmpty
            ? const EmptyState(icon: Icons.inbox_outlined, title: 'Inbox empty', message: 'Alerts, fills and AI actions land here (and as push when FCM is configured).')
            : ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
                itemCount: rows.length,
                itemBuilder: (context, index) {
                  final row = rows[index];
                  final colour = switch (row.kind) {
                    'alert' || 'price_alert' => AppColors.info,
                    'ai_trade' || 'signal' => AppColors.ai,
                    'order' || 'fill' => AppColors.up,
                    'risk' || 'error' => AppColors.down,
                    _ => AppColors.hold,
                  };
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: SectionCard(
                      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(width: 3, height: 34, decoration: BoxDecoration(color: colour, borderRadius: BorderRadius.circular(2))),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(row.title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
                                const SizedBox(height: 2),
                                Text(row.body, style: const TextStyle(fontSize: 11.5, height: 1.35)),
                                const SizedBox(height: 3),
                                Text(
                                  '${fmtDateTime(row.when)} · ${row.channel}${row.delivered ? '' : ' · stored only'}',
                                  style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 9.5),
                                ),
                              ],
                            ),
                          ),
                          PopupMenuButton<String>(
                            tooltip: 'Open',
                            onSelected: (value) {
                              if (value == 'symbol') {
                                final symbol = '${row.data['symbol'] ?? ''}';
                                if (symbol.isNotEmpty) {
                                  ref.read(selectedSymbolProvider.notifier).state = symbol;
                                  ref.read(localStoreProvider).setDefaultSymbol(symbol);
                                }
                              } else if (value == 'dismiss') {
                                ref.read(backendApiProvider).markNotificationsRead([row.id]);
                                ref.invalidate(notificationsProvider);
                              }
                            },
                            itemBuilder: (context) => [
                              const PopupMenuItem(value: 'symbol', child: Text('Open this pair')),
                              const PopupMenuItem(value: 'dismiss', child: Text('Mark read')),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }

  Future<void> _create() async {
    final symbol = ref.read(selectedSymbolProvider);
    final ticker = ref.read(tickerTableProvider).valueOrNull?[symbol];
    final form = await showModalBottomSheet<_AlertDraft>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _AlertDraftSheet(symbol: symbol, price: ticker?.price ?? 0),
    );
    if (form == null) return;
    try {
      await ref.read(backendApiProvider).createAlert(
            symbol: form.symbol,
            operator: form.operator,
            threshold: form.threshold,
            direction: form.direction,
            cooldownS: form.cooldownS,
            oneShot: form.oneShot,
          );
      ref.invalidate(alertsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Alert armed: ${form.symbol} ${form.operator} ${form.threshold}')));
      }
    } on Exception catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not create alert: $e')));
    }
  }
}

class _AlertTile extends ConsumerWidget {
  const _AlertTile({required this.alert});

  final PriceAlert alert;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pct = alert.remainingPct;
    final close = pct.abs() < 1.5;
    return SectionCard(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: AppColors.info.withOpacity(0.16), borderRadius: BorderRadius.circular(5)),
                child: Text(alert.symbol, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w900, color: AppColors.info)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${alert.direction == 'price' ? 'price' : '24h %'} ${alert.operator} ${alert.direction == 'price' ? fmtPrice(alert.threshold) : '${alert.threshold.toStringAsFixed(2)}%'}',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                ),
              ),
              IconButton(
                tooltip: alert.active ? 'Pause' : 'Re-arm',
                onPressed: () async {
                  await ref.read(backendApiProvider).updateAlert(alert.id, active: !alert.active);
                  ref.invalidate(alertsProvider);
                },
                icon: Icon(alert.active ? Icons.pause_circle_outline : Icons.play_circle_outline, size: 19),
              ),
              IconButton(
                tooltip: 'Delete',
                onPressed: () async {
                  await ref.read(backendApiProvider).deleteAlert(alert.id);
                  ref.invalidate(alertsProvider);
                },
                icon: const Icon(Icons.delete_outline, size: 19),
              ),
            ],
          ),
          const SizedBox(height: 4),
          InfoRow(label: 'Now', value: alert.direction == 'price' ? fmtPrice(alert.currentPrice) : fmtPct(alert.currentValue)),
          InfoRow(
            label: 'Distance to trigger',
            value: alert.distance == null ? '—' : '${fmtPct(pct, decimals: 2)} (gap ${alert.direction == 'price' ? fmtPrice(alert.distance!.abs()) : '${alert.distance!.abs().toStringAsFixed(2)}%'})',
            color: close ? AppColors.ai : null,
            bold: close,
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (1 - (pct.abs() / 10)).clamp(0.0, 1.0),
              minHeight: 4,
              backgroundColor: Theme.of(context).dividerColor,
              valueColor: AlwaysStoppedAnimation(close ? AppColors.ai : AppColors.info),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Text(
                alert.triggeredOnce ? 'fired before · cooldown ${alert.cooldownS}s' : 'armed · cooldown ${alert.cooldownS}s',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10),
              ),
              const Spacer(),
              TextButton(
                onPressed: () async {
                  await ref.read(backendApiProvider).testAlert(alert.id);
                  ref.invalidate(notificationsProvider);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Test notification sent')));
                  }
                },
                child: const Text('Test now', style: TextStyle(fontSize: 11)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AlertDraft {
  _AlertDraft({required this.symbol, required this.operator, required this.threshold, required this.direction, required this.cooldownS, required this.oneShot});
  final String symbol;
  final String operator;
  final double threshold;
  final String direction;
  final int cooldownS;
  final bool oneShot;
}

class _AlertDraftSheet extends ConsumerStatefulWidget {
  const _AlertDraftSheet({required this.symbol, required this.price});

  final String symbol;
  final double price;

  @override
  ConsumerState<_AlertDraftSheet> createState() => _AlertDraftSheetState();
}

class _AlertDraftSheetState extends ConsumerState<_AlertDraftSheet> {
  late String _symbol = widget.symbol;
  late String _direction = 'price';
  late String _operator = '>';
  late final TextEditingController _threshold = TextEditingController(text: widget.price > 0 ? widget.price.toStringAsFixed(2) : '');
  int _cooldown = 900;
  bool _oneShot = false;
  String? _error;

  @override
  void dispose() {
    _threshold.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('New alert', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        final picked = await showSymbolPicker(context, selected: _symbol);
                        if (picked != null && picked.isNotEmpty) setState(() => _symbol = picked);
                      },
                      icon: const Icon(Icons.swap_horiz, size: 16),
                      label: Text(_symbol, style: const TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'price', label: Text('Price')),
                        ButtonSegment(value: 'pct_change', label: Text('24h %')),
                        ButtonSegment(value: 'signal', label: Text('AI')),
                      ],
                      selected: {_direction},
                      showSelectedIcon: false,
                      style: SegmentedButton.styleFrom(textStyle: const TextStyle(fontSize: 10.5)),
                      onSelectionChanged: (value) => setState(() => _direction = value.first),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  for (final op in const ['>', '<', '>=', '<='])
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(op),
                        selected: _operator == op,
                        onSelected: (_) => setState(() => _operator = op),
                        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _threshold,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: _direction == 'price' ? 'Trigger price (USDT)' : 'Trigger percent',
                  helperText: _direction == 'price' && widget.price > 0 ? 'last ${fmtPrice(widget.price)}' : null,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(child: Text('Cooldown ${_cooldown}s', style: const TextStyle(fontSize: 11.5))),
                  Expanded(
                    child: Slider(
                      value: _cooldown.toDouble(),
                      min: 60,
                      max: 86400,
                      divisions: 20,
                      onChanged: (value) => setState(() => _cooldown = value.round()),
                    ),
                  ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                value: _oneShot,
                onChanged: (value) => setState(() => _oneShot = value),
                title: const Text('Trigger once', style: TextStyle(fontSize: 12.5)),
              ),
              if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.down, fontSize: 11)),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: () {
                  final value = double.tryParse(_threshold.text.trim());
                  if (value == null || value <= 0) {
                    setState(() => _error = 'Enter a number greater than zero');
                    return;
                  }
                  Navigator.pop(
                    context,
                    _AlertDraft(
                      symbol: _symbol,
                      operator: _operator,
                      threshold: value,
                      direction: _direction,
                      cooldownS: _cooldown,
                      oneShot: _oneShot,
                    ),
                  );
                },
                child: const Text('Arm alert'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
