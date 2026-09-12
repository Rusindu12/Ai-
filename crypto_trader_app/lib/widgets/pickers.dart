import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../providers/app_state.dart';
import '../providers/providers.dart';

/// Bottom sheet used by the Trade/AI/Alert screens to pick a pair.
class SymbolPickerSheet extends ConsumerStatefulWidget {
  const SymbolPickerSheet({super.key, this.selected, this.onPick, this.multiSelect = false, this.initial = const []});

  final String? selected;
  final ValueChanged<String>? onPick;
  final bool multiSelect;
  final List<String> initial;

  @override
  ConsumerState<SymbolPickerSheet> createState() => _SymbolPickerSheetState();
}

class _SymbolPickerSheetState extends ConsumerState<SymbolPickerSheet> {
  final _search = TextEditingController();
  String _query = '';
  late Set<String> _chosen = widget.initial.toSet();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final symbolsAsync = ref.watch(symbolListProvider);
    final tickers = ref.watch(tickerTableProvider).valueOrNull ?? const {};

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.72,
      maxChildSize: 0.94,
      builder: (context, controller) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 6, 14, 8),
            child: TextField(
              controller: _search,
              autofocus: false,
              onChanged: (value) => setState(() => _query = value.trim().toUpperCase()),
              decoration: InputDecoration(
                hintText: 'Search 600+ pairs (BTC, ETH, SOL…)',
                prefixIcon: const Icon(Icons.search, size: 18),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 16),
                        onPressed: () {
                          _search.clear();
                          setState(() => _query = '');
                        },
                      ),
              ),
            ),
          ),
          if (widget.multiSelect)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${_chosen.length} selected${_chosen.length < 5 ? ' (min 5 for auto-trade)' : ''}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  FilledButton(
                    onPressed: _chosen.isEmpty || _chosen.length < 5
                        ? null
                        : () {
                            widget.onPick?.call('');
                            Navigator.pop(context, _chosen.toList()..sort());
                          },
                    child: Text('Use ${_chosen.length}'),
                  ),
                ],
              ),
            ),
          const Divider(height: 1),
          Expanded(
            child: symbolsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator(strokeWidth: 2)),
              error: (error, _) => ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  Text('Pair list unavailable: $error', textAlign: TextAlign.center),
                  const SizedBox(height: 10),
                  Text(
                    'The backend fetches the pair list from Binance exchangeInfo, cached for an hour. '
                    'You can still type a symbol above.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
              data: (symbols) {
                final filtered = _query.isEmpty
                    ? symbols
                    : symbols
                        .where((s) =>
                            s.symbol.contains(_query) || s.base.contains(_query) || s.name.toUpperCase().contains(_query))
                        .toList();
                if (filtered.isEmpty) {
                  return EmptyFallback(query: _query, onUse: () => Navigator.pop(context, _query));
                }
                return ListView.builder(
                  controller: controller,
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final symbol = filtered[index];
                    final ticker = tickers[symbol.symbol];
                    final chosen = _chosen.contains(symbol.symbol);
                    return ListTile(
                      dense: true,
                      leading: widget.multiSelect
                          ? Checkbox(value: chosen, onChanged: (_) => setState(() => chosen ? _chosen.remove(symbol.symbol) : _chosen.add(symbol.symbol)))
                          : CircleAvatar(
                              radius: 12,
                              backgroundColor: (symbol.tracked ? AppColors.info : AppColors.hold).withOpacity(0.18),
                              child: Text(symbol.base.substring(0, 1), style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800)),
                            ),
                      title: Text(
                        symbol.symbol,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
                      ),
                      subtitle: Text(
                        '${symbol.name} • ${symbol.quote}${symbol.minNotional > 0 ? ' • min ${fmtUsd(symbol.minNotional, decimals: 0)}' : ''}',
                        style: const TextStyle(fontSize: 10.5),
                      ),
                      trailing: ticker == null
                          ? null
                          : Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(fmtPrice(ticker.price), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                                PnlPill(value: ticker.changePct, compact: true),
                              ],
                            ),
                      onTap: () {
                        if (widget.multiSelect) {
                          setState(() => chosen ? _chosen.remove(symbol.symbol) : _chosen.add(symbol.symbol));
                          return;
                        }
                        widget.onPick?.call(symbol.symbol);
                        Navigator.pop(context, symbol.symbol);
                      },
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class EmptyFallback extends StatelessWidget {
  const EmptyFallback({super.key, required this.query, required this.onUse});

  final String query;
  final VoidCallback onUse;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('“$query” is not in the cached list', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 8),
          FilledButton(onPressed: onUse, child: Text('Use $query anyway')),
        ],
      ),
    );
  }
}

Future<String?> showSymbolPicker(BuildContext context, {String? selected}) => showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SymbolPickerSheet(selected: selected),
    );

Future<List<String>?> showMultiSymbolPicker(BuildContext context, {List<String> initial = const []}) =>
    showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      builder: (context) => SymbolPickerSheet(multiSelect: true, initial: initial),
    );

/// Compact timeframe selector (1m … 1d).
class IntervalSelector extends ConsumerWidget {
  const IntervalSelector({super.key, this.compact = true, this.intervals});

  final bool compact;
  final List<String>? intervals;

  static const List<String> defaultIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(selectedIntervalProvider);
    final options = intervals ?? defaultIntervals;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final interval in options)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ChoiceChip(
                label: Text(interval),
                selected: current == interval,
                labelStyle: TextStyle(fontSize: compact ? 11 : 12.5, fontWeight: FontWeight.w700),
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                onSelected: (_) {
                  ref.read(selectedIntervalProvider.notifier).state = interval;
                  ref.read(localStoreProvider).setDefaultInterval(interval);
                },
              ),
            ),
        ],
      ),
    );
  }
}

/// Risk profile picker (conservative / moderate / aggressive) with the effect
/// of each profile spelled out, since it changes position sizing.
class RiskLevelSelector extends StatelessWidget {
  const RiskLevelSelector({super.key, required this.value, required this.onChanged, this.showDescriptions = true});

  final String value;
  final ValueChanged<String> onChanged;
  final bool showDescriptions;

  static const Map<String, String> descriptions = {
    'conservative': '0.5% risk/trade • TP 3×ATR • SL 1×ATR • needs 70% confidence',
    'moderate': '1.0% risk/trade • TP 2×ATR • SL 1.5×ATR • needs 62% confidence',
    'aggressive': '2.0% risk/trade • TP 1.5×ATR • SL 1×ATR • needs 55% confidence',
  };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'conservative', label: Text('Conservative'), icon: Icon(Icons.shield, size: 15)),
            ButtonSegment(value: 'moderate', label: Text('Moderate'), icon: Icon(Icons.tune, size: 15)),
            ButtonSegment(value: 'aggressive', label: Text('Aggressive'), icon: Icon(Icons.local_fire_department, size: 15)),
          ],
          selected: {value},
          showSelectedIcon: false,
          onSelectionChanged: (selection) => onChanged(selection.first),
        ),
        if (showDescriptions)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              descriptions[value] ?? '',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10.5),
            ),
          ),
      ],
    );
  }
}
