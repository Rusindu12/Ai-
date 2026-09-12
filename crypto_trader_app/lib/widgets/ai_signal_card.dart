import 'package:flutter/material.dart';

import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/ai.dart';
import 'common.dart';

/// The AI verdict card: action + confidence gauge + the exact reasons that
/// produced it (rule votes, model outputs) + the ATR-based trade plan.
class AiSignalCard extends StatelessWidget {
  const AiSignalCard({
    super.key,
    required this.signal,
    this.onExecute,
    this.executing = false,
    this.compact = false,
    this.showPlan = true,
  });

  final AiSignal signal;
  final VoidCallback? onExecute;
  final bool executing;
  final bool compact;
  final bool showPlan;

  Color get _colour => AppColors.forAction(signal.action);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_colour.withOpacity(0.20), _colour.withOpacity(0.04)],
        ),
        border: Border.all(color: _colour.withOpacity(0.45)),
      ),
      padding: EdgeInsets.all(compact ? 12 : 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _Gauge(value: signal.confidence, colour: _colour, size: compact ? 46 : 58),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          signal.action.toUpperCase(),
                          style: TextStyle(fontSize: compact ? 19 : 23, fontWeight: FontWeight.w900, color: _colour, letterSpacing: 1),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: _colour.withOpacity(0.18), borderRadius: BorderRadius.circular(6)),
                          child: Text('${signal.confidence.round()}%', style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: _colour)),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      signal.reason,
                      maxLines: compact ? 2 : 4,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(height: 1.35),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${signal.symbol} • ${signal.interval} • score ${signal.score.toStringAsFixed(2)} • ${signal.modelVersion}',
                      style: theme.textTheme.bodySmall?.copyWith(fontSize: 10, color: _colour.withOpacity(0.9)),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (signal.warnings.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                children: [
                  for (final warning in signal.warnings)
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.warning_amber_rounded, size: 14, color: AppColors.ai),
                        const SizedBox(width: 6),
                        Expanded(child: Text(warning, style: const TextStyle(fontSize: 11, color: AppColors.ai))),
                      ],
                    ),
                ],
              ),
            ),
          if (!compact) ...[
            const SizedBox(height: 12),
            _RuleVotes(rules: signal.rules),
            const SizedBox(height: 10),
            _ModelRow(models: signal.models),
            if (showPlan && signal.tradePlan.hasLevels) ...[
              const SizedBox(height: 10),
              _PlanRow(plan: signal.tradePlan, price: signal.price),
            ],
          ],
          if (onExecute != null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: executing ? null : onExecute,
                    style: FilledButton.styleFrom(backgroundColor: _colour, foregroundColor: Colors.black87),
                    icon: Icon(executing ? Icons.hourglass_top : Icons.bolt, size: 18),
                    label: Text(executing ? 'Placing…' : 'Execute with AI plan'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _Gauge extends StatelessWidget {
  const _Gauge({required this.value, required this.colour, required this.size});

  final double value;
  final Color colour;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: TweenAnimationBuilder(
        tween: Tween<double>(begin: 0, end: (value.clamp(0, 100)) / 100),
        duration: const Duration(milliseconds: 700),
        builder: (context, animated, _) => Stack(
          alignment: Alignment.center,
          children: [
            SizedBox.expand(
              child: CircularProgressIndicator(
                value: animated,
                strokeWidth: 4,
                backgroundColor: colour.withOpacity(0.18),
                valueColor: AlwaysStoppedAnimation(colour),
              ),
            ),
            Icon(Icons.smart_toy_outlined, size: size * 0.34, color: colour),
          ],
        ),
      ),
    );
  }
}

class _RuleVotes extends StatelessWidget {
  const _RuleVotes({required this.rules});

  final List<SignalRule> rules;

  @override
  Widget build(BuildContext context) {
    if (rules.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Why (rule votes)', style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 10.5, letterSpacing: 0.6)),
        const SizedBox(height: 6),
        for (final rule in rules)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: Row(
              children: [
                Icon(
                  rule.vote > 0 ? Icons.keyboard_arrow_up : rule.vote < 0 ? Icons.keyboard_arrow_down : Icons.remove,
                  size: 15,
                  color: rule.vote > 0 ? AppColors.up : rule.vote < 0 ? AppColors.down : AppColors.hold,
                ),
                SizedBox(width: 4),
                SizedBox(width: 68, child: Text(rule.name, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600))),
                Expanded(
                  child: Text(
                    rule.detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 10.5, color: Theme.of(context).textTheme.bodySmall?.color),
                  ),
                ),
                Text(
                  '${rule.vote > 0 ? '+' : ''}${rule.vote}×${rule.weight.toStringAsFixed(1)}',
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ModelRow extends StatelessWidget {
  const _ModelRow({required this.models});

  final ModelOutputs models;

  @override
  Widget build(BuildContext context) {
    final probs = models.classifierProbs;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).dividerColor.withOpacity(0.25),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.psychology_alt, size: 14, color: AppColors.ai),
              const SizedBox(width: 6),
              Text('Neural models', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Theme.of(context).textTheme.bodyMedium?.color)),
              const Spacer(),
              if (!models.healthy)
                Text('fallback: rules only', style: TextStyle(fontSize: 10, color: AppColors.ai.withOpacity(0.9))),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: InfoRow(
                  label: 'LSTM 12-bar return',
                  value: fmtPct(models.lstmPredReturn * 100, decimals: 3),
                  color: models.lstmPredReturn >= 0 ? AppColors.up : AppColors.down,
                  bold: true,
                ),
              ),
              Expanded(
                child: InfoRow(
                  label: 'LSTM P(up)',
                  value: '${(models.lstmDirectionProb * 100).toStringAsFixed(1)}%',
                  bold: true,
                ),
              ),
              Expanded(
                child: InfoRow(
                  label: 'Classifier',
                  value: '${models.classifierAction.isEmpty ? 'n/a' : models.classifierAction} ${models.classifierConfidence.round()}%',
                  color: AppColors.forAction(models.classifierAction),
                  bold: true,
                ),
              ),
            ],
          ),
          if (probs.isNotEmpty) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: SizedBox(
                height: 9,
                child: Row(
                  children: [
                    for (final entry in probs.entries)
                      Expanded(
                        flex: (entry.value * 100).round().clamp(1, 100),
                        child: Tooltip(
                          message: '${entry.key} ${(entry.value * 100).toStringAsFixed(1)}%',
                          child: Container(
                            color: AppColors.forAction(entry.key).withOpacity(0.75),
                            child: Center(
                              child: Text(entry.key, style: const TextStyle(fontSize: 7, color: Colors.black87, fontWeight: FontWeight.w800)),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PlanRow extends StatelessWidget {
  const _PlanRow({required this.plan, required this.price});

  final TradePlan plan;
  final double price;

  @override
  Widget build(BuildContext context) {
    final rr = plan.rewardRisk;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.ai.withOpacity(0.4)),
        color: AppColors.ai.withOpacity(0.07),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.flag, size: 13, color: AppColors.ai),
              const SizedBox(width: 6),
              Text('Suggested plan (ATR based)', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Theme.of(context).textTheme.bodyMedium?.color)),
              const Spacer(),
              Text(
                'R:R ${rr <= 0 ? '—' : rr.toStringAsFixed(2)}',
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: rr >= 1.5 ? AppColors.up : AppColors.ai),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(child: InfoRow(label: 'Entry', value: fmtPrice(plan.entry == 0 ? price : plan.entry))),
              Expanded(child: InfoRow(label: 'Take profit', value: fmtPrice(plan.takeProfit), color: AppColors.up, bold: true)),
              Expanded(child: InfoRow(label: 'Stop loss', value: fmtPrice(plan.stopLoss), color: AppColors.down, bold: true)),
            ],
          ),
          if (plan.suggestedQty > 0)
            InfoRow(label: 'Suggested size', value: '${fmtQty(plan.suggestedQty)} (~${fmtUsd(plan.suggestedNotional)})'),
        ],
      ),
    );
  }
}
