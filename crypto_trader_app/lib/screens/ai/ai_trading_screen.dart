import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/formatters.dart';
import '../../core/theme.dart';
import '../../models/ai.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/ai_signal_card.dart';
import '../../widgets/charts_extras.dart';
import '../../widgets/common.dart';
import '../../widgets/pickers.dart';

/// Screen 4 — AI Auto-Trading: the model, the batch signals, the autopilot
/// switch with its kill switch, the live decision log and the backtest lab.
class AiTradingScreen extends ConsumerStatefulWidget {
  const AiTradingScreen({super.key});

  @override
  ConsumerState<AiTradingScreen> createState() => _AiTradingScreenState();
}

class _AiTradingScreenState extends ConsumerState<AiTradingScreen> {
  bool _busy = false;
  String? _error;
  bool _training = false;

  Future<void> _toggleAuto(bool enabled) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final status = ref.read(autoStatusProvider).valueOrNull;
      await ref.read(backendApiProvider).saveAutoConfig(
            enabled: enabled,
            symbols: status?.symbols.isNotEmpty ?? false ? status!.symbols : const ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
            riskLevel: status?.riskLevel ?? 'moderate',
            maxTradeSizeUsd: status?.maxTradeSizeUsd ?? 250,
            dailyLossLimitUsd: status?.dailyLossLimitUsd ?? 500,
            minConfidencePct: status?.minConfidencePct ?? 65,
            intervalS: status?.intervalS ?? 300,
          );
      ref.invalidate(autoStatusProvider);
      ref.invalidate(autoLogProvider);
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _kill(bool flatten) async {
    setState(() => _busy = true);
    try {
      await ref.read(backendApiProvider).killSwitch(flatten: flatten, reason: 'kill switch from app');
      ref.invalidate(autoStatusProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(flatten ? 'Autopilot stopped and positions flattened' : 'Autopilot stopped (positions kept)')),
        );
      }
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _train() async {
    setState(() {
      _training = true;
      _error = null;
    });
    try {
      await ref.read(backendApiProvider).train();
      ref.invalidate(modelsProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Retrain job finished — the model registry was updated')));
      }
    } on AppException catch (e) {
      if (mounted) setState(() => _error = 'Retrain failed: ${e.message}');
    } finally {
      if (mounted) setState(() => _training = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final symbol = ref.watch(selectedSymbolProvider);
    final interval = ref.watch(selectedIntervalProvider);
    final signalAsync = ref.watch(aiSignalProvider((symbol, interval)));
    final status = ref.watch(autoStatusProvider).valueOrNull;
    final batch = ref.watch(aiSignalsBatchProvider).valueOrNull ?? const [];
    final log = ref.watch(autoLogProvider).valueOrNull ?? const [];
    final models = ref.watch(modelsProvider).valueOrNull;
    final perf = ref.watch(autoPerformanceProvider).valueOrNull;
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 90),
      children: [
        // ------------------------------------------------------- model status
        SectionCard(
          title: 'Model',
          subtitle: models == null ? 'loading registry…' : '${models.version} · ${models.hasModels ? 'trained' : 'rules only'}',
          trailing: IconButton(
            tooltip: 'Refresh',
            onPressed: () => ref.invalidate(modelsProvider),
            icon: const Icon(Icons.refresh, size: 18),
          ),
          child: models == null
              ? const LoadingBox(height: 60)
              : Column(
                  children: [
                    InfoRow(label: 'LSTM', value: models.artifacts?['lstm'] == true ? 'loaded (numpy, 32×1 hidden)' : 'missing'),
                    InfoRow(label: 'Classifier', value: models.artifacts?['classifier'] == true ? 'loaded (MLP + calibrated)' : 'missing'),
                    InfoRow(label: 'Features', value: '${models.nFeatures} · look-back ${models.lookBack}'),
                    InfoRow(
                      label: 'Last trained',
                      value: models.trainedAgoS <= 0 ? 'never' : fmtRelative(Duration(seconds: models.trainedAgoS)),
                      color: models.needsRetrain ? AppColors.ai : AppColors.up,
                    ),
                    InfoRow(label: 'Val metrics', value: _metricsLine(models)),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: _training ? null : _train,
                            icon: _training ? const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.model_training, size: 16),
                            label: Text(_training ? 'Training…' : 'Retrain now'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => showDialog<void>(
                              context: context,
                              builder: (_) => const _ModelExplainDialog(),
                            ),
                            icon: const Icon(Icons.info_outline, size: 16),
                            label: const Text('How it decides'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
        ),
        const SectionTitle(text: 'Live signal for the focused pair', icon: Icons.auto_awesome),
        signalAsync.when(
          loading: () => const LoadingBox(height: 150, message: 'Computing $symbol $interval…'),
          error: (error, _) => ErrorView(error: error, onRetry: () => ref.invalidate(aiSignalProvider((symbol, interval)))),
          data: (signal) => AiSignalCard(
            signal: signal,
            onExecute: () => showDialog<void>(
              context: context,
              builder: (dialogContext) => AlertDialog(
                title: Text('Execute ${signal.action} ${signal.symbol}?'),
                content: Text(
                  'Confidence ${signal.confidence.round()}%\n'
                  '${signal.tradePlan.hasLevels ? 'Plan: entry ${fmtPrice(signal.tradePlan.entry)} · TP ${fmtPrice(signal.tradePlan.takeProfit)} · SL ${fmtPrice(signal.tradePlan.stopLoss)} (R:R ${signal.tradePlan.rewardRisk.toStringAsFixed(2)})\n' : 'No ATR plan available.\n'}'
                  'This goes through the same risk gates as a manual order.',
                ),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
                  FilledButton(
                    onPressed: () async {
                      Navigator.pop(dialogContext);
                      try {
                        final result = await ref.read(backendApiProvider).executeSignal(signal.symbol, interval: interval);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('${result.side} ${fmtQty(result.quantity)} ${result.symbol} @ ${fmtPrice(result.price)}')),
                          );
                        }
                      } on AppException catch (e) {
                        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: 'Blocked: ${e.message}'));
                      }
                    },
                    child: const Text('Execute'),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        // ----------------------------------------------------------- autopilot
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(
              colors: status != null && status.enabled
                  ? [AppColors.up.withOpacity(0.20), AppColors.up.withOpacity(0.04)]
                  : [theme.dividerColor.withOpacity(0.4), Colors.transparent],
            ),
            border: Border.all(color: status != null && status.enabled ? AppColors.up.withOpacity(0.45) : theme.dividerColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(status != null && status.enabled ? Icons.robo_hotel : Icons.smart_toy_outlined, color: status != null && status.enabled ? AppColors.up : AppColors.hold),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Autopilot', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900)),
                        Text(
                          status == null
                              ? 'reading engine state…'
                              : status.enabled
                                  ? 'running every ${status.intervalS}s on ${status.symbols.length} pairs'
                                  : 'paused — signals only, no orders',
                          style: theme.textTheme.bodySmall?.copyWith(fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  Switch(
                    value: status?.enabled ?? false,
                    onChanged: _busy ? null : _toggleAuto,
                  ),
                ],
              ),
              if (status != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: StatTile(label: 'Cycles', value: '${status.cycles}', secondary: '${status.executed} executed', dense: true)),
                    const SizedBox(width: 6),
                    Expanded(child: StatTile(label: 'Rejected', value: '${status.rejected}', secondary: 'risk gates', dense: true)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: StatTile(
                        label: 'Today PnL',
                        value: fmtSignedUsd(status.todayRealizedPnl),
                        secondary: '${status.todayOrders} orders',
                        color: status.todayRealizedPnl >= 0 ? AppColors.up : AppColors.down,
                        dense: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: FilledButton.tonalIcon(
                        onPressed: _busy ? null : () async {
                          await ref.read(backendApiProvider).runCycle();
                          ref.invalidate(autoStatusProvider);
                          ref.invalidate(autoLogProvider);
                        },
                        icon: const Icon(Icons.play_arrow, size: 16),
                        label: const Text('Run one cycle now'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton.icon(
                        style: FilledButton.styleFrom(backgroundColor: AppColors.down, foregroundColor: Colors.white),
                        onPressed: _busy ? null : () => _kill(false),
                        icon: const Icon(Icons.power_settings_new, size: 16),
                        label: const Text('KILL SWITCH'),
                      ),
                    ),
                  ],
                ),
                TextButton.icon(
                  onPressed: _busy ? null : () => _kill(true),
                  icon: const Icon(Icons.dangerous_outlined, size: 15, color: AppColors.down),
                  label: const Text('Kill + flatten every open position', style: TextStyle(fontSize: 11.5, color: AppColors.down)),
                ),
              ],
              if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.down, fontSize: 11.5)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        // ------------------------------------------------------- config editor
        _AutoConfigCard(onSaved: () {
          ref.invalidate(autoStatusProvider);
          ref.invalidate(autoLogProvider);
        }),
        const SectionTitle(text: 'Signals across the watchlist', icon: Icons.bolt_outlined),
        SectionCard(
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
          child: batch.isEmpty
              ? const EmptyState(icon: Icons.radar, title: 'No batch signals yet', message: 'The backend computes them on an interval; pull to refresh.', compact: true)
              : Column(
                  children: [
                    for (final row in batch)
                      ListTile(
                        dense: true,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
                        leading: SizedBox(width: 66, child: Text(row.symbol.replaceAll(RegExp(r'(USDT|BUSD|USDC)$'), ''), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5))),
                        title: Row(
                          children: [
                            SignalActionChip(action: row.action, size: 0.85),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(row.reason, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10.5)),
                            ),
                          ],
                        ),
                        subtitle: Text('${fmtPrice(row.price)} · score ${row.score.toStringAsFixed(2)}', style: const TextStyle(fontSize: 10)),
                        trailing: Text('${row.confidence.round()}%', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.ai)),
                        onTap: () {
                          ref.read(selectedSymbolProvider.notifier).state = row.symbol;
                          ref.read(localStoreProvider).setDefaultSymbol(row.symbol);
                        },
                      ),
                  ],
                ),
        ),
        const SectionTitle(text: 'Decision log', icon: Icons.history),
        SectionCard(
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          child: log.isEmpty
              ? const EmptyState(icon: Icons.fact_check_outlined, title: 'No decisions recorded', message: 'Run a cycle or wait for the autopilot.', compact: true)
              : Column(
                  children: [
                    for (final entry in log.take(12))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: 44, child: Text(fmtTime(entry.when), style: const TextStyle(fontSize: 10, fontFamily: 'monospace'))),
                            SizedBox(width: 56, child: Text(entry.symbol.replaceAll(RegExp(r'(USDT|BUSD)$'), ''), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800))),
                            Expanded(
                              child: Text(
                                '${entry.decision}${entry.executed ? ' → ordered' : ''} · ${entry.reason}',
                                style: TextStyle(fontSize: 10.5, color: entry.executed ? AppColors.up : theme.textTheme.bodySmall?.color, height: 1.3),
                              ),
                            ),
                            Text('${entry.confidence.round()}%', style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: AppColors.ai)),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        if (perf != null && perf.trades > 0) ...[
          const SectionTitle(text: 'Autopilot performance', icon: Icons.insights),
          Row(
            children: [
              Expanded(child: StatTile(label: 'Trades', value: '${perf.trades}', secondary: '${perf.wins}W / ${perf.losses}L')),
              const SizedBox(width: 6),
              Expanded(child: StatTile(label: 'Win rate', value: '${perf.winRate.toStringAsFixed(1)}%', color: perf.winRate >= 50 ? AppColors.up : AppColors.down)),
              const SizedBox(width: 6),
              Expanded(child: StatTile(label: 'Total PnL', value: fmtSignedUsd(perf.totalPnl), color: perf.totalPnl >= 0 ? AppColors.up : AppColors.down)),
              const SizedBox(width: 6),
              Expanded(child: StatTile(label: 'Sharpe', value: perf.sharpe.toStringAsFixed(2), secondary: 'max DD ${fmtUsd(perf.maxDrawdown)}')),
            ],
          ),
        ],
        const SectionTitle(text: 'Backtest lab', icon: Icons.experiment),
        const _BacktestCard(),
        const SizedBox(height: 8),
        Center(
          child: Text(
            'Signals are computed from the same indicators the model was trained on. Confidence below the profile minimum never becomes an order.',
            style: theme.textTheme.bodySmall?.copyWith(fontSize: 9.5),
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }

  String _metricsLine(ModelInfo models) {
    final mse = models.metrics['lstm_val_mse'];
    final acc = models.metrics['classifier_val_accuracy'];
    final dir = models.metrics['lstm_direction_accuracy'];
    final parts = <String>[
      if (dir != null) 'LSTM dir ${(dir * 100).toStringAsFixed(1)}%',
      if (acc != null) 'clf ${(acc * 100).toStringAsFixed(1)}%',
      if (mse != null) 'mse ${mse.toStringAsFixed(6)}',
    ];
    return parts.isEmpty ? 'not available' : parts.join(' · ');
  }
}

class _AutoConfigCard extends ConsumerStatefulWidget {
  const _AutoConfigCard({required this.onSaved});

  final VoidCallback onSaved;

  @override
  ConsumerState<_AutoConfigCard> createState() => _AutoConfigCardState();
}

class _AutoConfigCardState extends ConsumerState<_AutoConfigCard> {
  String? _risk;
  double? _maxSize;
  double? _lossLimit;
  double? _minConf;
  int? _interval;
  List<String>? _symbols;
  bool _saving = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(autoStatusProvider).valueOrNull;
    if (status == null) return const SizedBox.shrink();
    final risk = _risk ?? status.riskLevel;
    final maxSize = _maxSize ?? status.maxTradeSizeUsd;
    final lossLimit = _lossLimit ?? status.dailyLossLimitUsd;
    final minConf = _minConf ?? status.minConfidencePct;
    final interval = _interval ?? status.intervalS;
    final symbols = _symbols ?? (status.symbols.isEmpty ? const ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] : status.symbols);

    return SectionCard(
      title: 'Autopilot settings',
      subtitle: 'every limit below is also enforced server side',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          RiskLevelSelector(
            value: risk,
            onChanged: (value) => setState(() => _risk = value),
          ),
          const SizedBox(height: 12),
          _sliderRow(
            label: 'Max size per trade',
            value: maxSize,
            min: 10,
            max: 2000,
            format: (v) => fmtUsd(v, decimals: 0),
            onChanged: (v) => setState(() => _maxSize = v),
          ),
          _sliderRow(
            label: 'Daily loss limit (hard stop)',
            value: lossLimit,
            min: 20,
            max: 2000,
            format: (v) => fmtUsd(v, decimals: 0),
            onChanged: (v) => setState(() => _lossLimit = v),
          ),
          _sliderRow(
            label: 'Min AI confidence',
            value: minConf,
            min: 40,
            max: 95,
            format: (v) => '${v.round()}%',
            onChanged: (v) => setState(() => _minConf = v),
          ),
          _sliderRow(
            label: 'Cycle interval',
            value: interval.toDouble(),
            min: 30,
            max: 1800,
            format: (v) => '${v.round()}s',
            onChanged: (v) => setState(() => _interval = v.round()),
          ),
          const SizedBox(height: 10),
          InkWell(
            onTap: () async {
              final picked = await showMultiSymbolPicker(context, initial: symbols);
              if (picked != null && picked.isNotEmpty) setState(() => _symbols = picked);
            },
            child: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Theme.of(context).dividerColor),
              ),
              child: Row(
                children: [
                  const Icon(Icons.category_outlined, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${symbols.length} pairs: ${symbols.take(6).map((s) => s.replaceAll(RegExp(r'(USDT|BUSD)$'), '')).join(', ')}${symbols.length > 6 ? '…' : ''}',
                      style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const Icon(Icons.edit_outlined, size: 14),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          FilledButton(
            onPressed: _saving
                ? null
                : () async {
                    setState(() {
                      _saving = true;
                      _error = null;
                    });
                    try {
                      await ref.read(backendApiProvider).saveAutoConfig(
                            enabled: status.enabled,
                            symbols: symbols,
                            riskLevel: risk,
                            maxTradeSizeUsd: maxSize,
                            dailyLossLimitUsd: lossLimit,
                            minConfidencePct: minConf,
                            intervalS: interval,
                          );
                      widget.onSaved();
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Autopilot configuration saved')));
                      }
                    } on AppException catch (e) {
                      if (mounted) setState(() => _error = e.message);
                    } finally {
                      if (mounted) setState(() => _saving = false);
                    }
                  },
            child: Text(_saving ? 'Saving…' : 'Save configuration'),
          ),
          if (_error != null) Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: const TextStyle(color: AppColors.down, fontSize: 11.5)),
          ),
        ],
      ),
    );
  }

  Widget _sliderRow({
    required String label,
    required double value,
    required double min,
    required double max,
    required String Function(double) format,
    required ValueChanged<double> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600))),
            Text(format(value), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.info)),
          ],
        ),
        Slider(
          value: value.clamp(min, max),
          min: min,
          max: max,
          divisions: 20,
          onChanged: onChanged,
        ),
      ],
    );
  }
}

class _BacktestCard extends ConsumerStatefulWidget {
  const _BacktestCard();

  @override
  ConsumerState<_BacktestCard> createState() => _BacktestCardState();
}

class _BacktestCardState extends ConsumerState<_BacktestCard> {
  String _strategy = 'ai_hybrid';
  int _bars = 500;
  bool _ran = false;

  @override
  Widget build(BuildContext context) {
    final symbol = ref.watch(selectedSymbolProvider);
    final cfg = {'symbol': symbol, 'interval': '1h', 'bars': _bars, 'strategy': _strategy};
    final result = _ran ? ref.watch(backtestProvider(cfg)).valueOrNull : null;
    final busy = _ran && ref.watch(backtestProvider(cfg)).isLoading;

    return SectionCard(
      title: 'Walk-forward backtest',
      subtitle: 'same engine the retrain job uses',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _strategy,
                  isDense: true,
                  decoration: const InputDecoration(labelText: 'Strategy'),
                  items: const [
                    DropdownMenuItem(value: 'ai_hybrid', child: Text('AI hybrid (models + rules)')),
                    DropdownMenuItem(value: 'rsi_mean_reversion', child: Text('RSI mean reversion')),
                    DropdownMenuItem(value: 'macd_trend', child: Text('MACD trend')),
                    DropdownMenuItem(value: 'bollinger_breakout', child: Text('Bollinger breakout')),
                    DropdownMenuItem(value: 'buy_hold', child: Text('Buy & hold (benchmark)')),
                  ],
                  onChanged: (value) => setState(() {
                    _strategy = value ?? 'ai_hybrid';
                    _ran = false;
                  }),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<int>(
                  value: _bars,
                  isDense: true,
                  decoration: const InputDecoration(labelText: 'Bars'),
                  items: const [
                    DropdownMenuItem(value: 240, child: Text('240')),
                    DropdownMenuItem(value: 500, child: Text('500')),
                    DropdownMenuItem(value: 1000, child: Text('1000')),
                  ],
                  onChanged: (value) => setState(() {
                    _bars = value ?? 500;
                    _ran = false;
                  }),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: busy
                ? null
                : () {
                    setState(() => _ran = true);
                    // The provider itself performs the request; invalidating it
                    // re-runs the backtest with the current configuration.
                    ref.invalidate(backtestProvider(cfg));
                  },
            icon: busy ? const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.play_arrow, size: 16),
            label: Text(busy ? 'Running…' : 'Run backtest on $symbol'),
          ),
          if (result != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: StatTile(label: 'Strategy', value: fmtPct(result.metrics.totalReturnPct, decimals: 2), color: result.metrics.totalReturnPct >= 0 ? AppColors.up : AppColors.down, dense: true)),
                const SizedBox(width: 6),
                Expanded(child: StatTile(label: 'Buy & hold', value: fmtPct(result.metrics.buyHoldReturnPct, decimals: 2), dense: true)),
                const SizedBox(width: 6),
                Expanded(child: StatTile(label: 'Alpha', value: fmtPct(result.metrics.alphaPct, decimals: 2), color: result.metrics.alphaPct >= 0 ? AppColors.up : AppColors.down, dense: true)),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(child: StatTile(label: 'Sharpe', value: result.metrics.sharpe.toStringAsFixed(2), secondary: 'sortino ${result.metrics.sortino.toStringAsFixed(2)}', dense: true)),
                const SizedBox(width: 6),
                Expanded(child: StatTile(label: 'Max DD', value: fmtPct(result.metrics.maxDrawdownPct, decimals: 2), color: AppColors.down, dense: true)),
                const SizedBox(width: 6),
                Expanded(child: StatTile(label: 'Win rate', value: '${result.metrics.winRatePct.toStringAsFixed(1)}%', secondary: '${result.metrics.trades} trades', dense: true)),
              ],
            ),
            const SizedBox(height: 10),
            EquityCurve(points: result.equityCurve, height: 130, baseline: result.startEquity),
            const SizedBox(height: 6),
            Text(
              'Fees ${fmtUsd(result.metrics.feesPaid)} · exposure ${result.metrics.exposurePct.toStringAsFixed(1)}% · profit factor ${result.metrics.profitFactor.toStringAsFixed(2)}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10),
            ),
          ],
        ],
      ),
    );
  }
}

class _ModelExplainDialog extends StatelessWidget {
  const _ModelExplainDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('How the AI decides'),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              Text('1 · Indicators — RSI, MACD, Bollinger, EMA 20/50/200, VWAP, ATR, ADX, Stochastic, CCI, OBV, MFI, volume profile POC and S/R levels are computed from the same candles the app charts.', style: TextStyle(fontSize: 12.5, height: 1.5)),
              SizedBox(height: 10),
              Text('2 · Votes — each rule casts −1 / 0 / +1 with a weight. The weighted score becomes the rule component of confidence.', style: TextStyle(fontSize: 12.5, height: 1.5)),
              SizedBox(height: 10),
              Text('3 · Models — a 32-unit LSTM predicts the next 12-bar return; a softmax MLP classifies BUY/SELL/HOLD over 23 engineered features. The MLP is temperature-calibrated so "72% confident" really means ~72% hit-rate.', style: TextStyle(fontSize: 12.5, height: 1.5)),
              SizedBox(height: 10),
              Text('4 · Fusion — model and rule outputs are averaged with a bias toward the classifier when it agrees with the trend. If the models are missing or stale, the signal falls back to rules and says so in `warnings`.', style: TextStyle(fontSize: 12.5, height: 1.5)),
              SizedBox(height: 10),
              Text('5 · Plan — ATR sizes the take-profit and stop-loss (2× / 1.5× by default) and the position size from your risk profile, before the risk manager clamps it to exchange filters.', style: TextStyle(fontSize: 12.5, height: 1.5)),
              SizedBox(height: 10),
              Text('The model never sees your money: it predicts the market; the risk manager decides whether trading that prediction is prudent.', style: TextStyle(fontSize: 12.5, height: 1.5, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
      actions: [FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    );
  }
}
