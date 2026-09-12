import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/errors.dart';
import '../core/formatters.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../models/trading.dart';
import '../providers/app_state.dart';
import '../providers/providers.dart';
import 'common.dart';

/// The buy/sell form. Enforces the whole safety chain before an order leaves the
/// device:
///
///   validate -> server preview (risk + fees) -> biometric -> confirm -> submit
class TradePanel extends ConsumerStatefulWidget {
  const TradePanel({
    super.key,
    required this.symbol,
    this.initialSide = 'BUY',
    this.referencePrice,
    this.compact = false,
    this.presetQty,
    this.onClose,
  });

  final String symbol;
  final String initialSide;
  final double? referencePrice;
  final bool compact;
  final double? presetQty;
  final VoidCallback? onClose;

  @override
  ConsumerState<TradePanel> createState() => _TradePanelState();
}

class _TradePanelState extends ConsumerState<TradePanel> {
  final _qtyController = TextEditingController();
  final _priceController = TextEditingController();
  final _tpController = TextEditingController();
  final _slController = TextEditingController();

  bool _isBuy = true;
  bool _marketOrder = true;
  bool _quoteAmount = true; // qty entered in USDT rather than base coin
  bool _busy = false;
  String? _error;
  OrderPreview? _preview;
  double _riskPct = 1.0; // % of free cash to deploy

  @override
  void initState() {
    super.initState();
    _isBuy = widget.initialSide.toUpperCase() != 'SELL';
    if (widget.presetQty != null && widget.presetQty! > 0) {
      _quoteAmount = false;
      _qtyController.text = widget.presetQty!.toStringAsFixed(6);
    }
  }

  @override
  void dispose() {
    _qtyController.dispose();
    _priceController.dispose();
    _tpController.dispose();
    _slController.dispose();
    super.dispose();
  }

  double get _price {
    final entered = double.tryParse(_priceController.text.trim());
    if (!_marketOrder && entered != null && entered > 0) return entered;
    final ticker = ref.read(tickerTableProvider).valueOrNull?[widget.symbol];
    return ticker?.price ?? widget.referencePrice ?? 0;
  }

  double get _quantity {
    final raw = double.tryParse(_qtyController.text.trim()) ?? 0;
    if (raw <= 0) return 0;
    if (!_quoteAmount) return raw;
    final price = _price;
    return price <= 0 ? 0 : raw / price;
  }

  double get _notional => _quantity * _price;

  void _applyRiskPct(double pct) {
    setState(() {
      _riskPct = pct;
      final account = ref.read(accountProvider).valueOrNull;
      final cash = account?.cashUsd ?? 0;
      final target = cash * (pct / 100);
      _quoteAmount = true;
      _qtyController.text = target <= 0 ? '' : target.toStringAsFixed(2);
      _preview = null;
    });
  }

  Future<void> _applyAiPlan() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final signal = await ref
          .read(backendApiProvider)
          .signal(widget.symbol, interval: ref.read(selectedIntervalProvider));
      if (!mounted) return;
      final plan = signal.tradePlan;
      setState(() {
        if (plan.hasLevels) {
          _tpController.text = plan.takeProfit.toStringAsFixed(plan.takeProfit > 100 ? 2 : 6);
          _slController.text = plan.stopLoss.toStringAsFixed(plan.stopLoss > 100 ? 2 : 6);
        }
        if (plan.suggestedQty > 0) {
          _quoteAmount = false;
          _qtyController.text = plan.suggestedQty.toStringAsFixed(6);
        }
        _preview = null;
      });
      ref.read(logProvider).info('applied AI plan for ${widget.symbol}: ${signal.action} ${signal.confidence.round()}%');
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _previewOrder() async {
    setState(() {
      _busy = true;
      _error = null;
      _preview = null;
    });
    try {
      final preview = await ref.read(backendApiProvider).previewOrder(_payload(dryRun: true));
      if (!mounted) return;
      setState(() => _preview = preview);
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Map<String, dynamic> _payload({required bool dryRun}) => {
        'symbol': widget.symbol,
        'side': _isBuy ? 'BUY' : 'SELL',
        'order_type': _marketOrder ? 'MARKET' : 'LIMIT',
        'quantity': _quantity,
        if (_quoteAmount) 'quoted_qty': double.tryParse(_qtyController.text.trim()) ?? 0,
        if (!_marketOrder) 'price': double.tryParse(_priceController.text.trim()) ?? _price,
        'time_in_force': 'GTC',
        if (_tpController.text.trim().isNotEmpty) 'take_profit': double.tryParse(_tpController.text.trim()),
        if (_slController.text.trim().isNotEmpty) 'stop_loss': double.tryParse(_slController.text.trim()),
        'dry_run': dryRun,
      };

  Future<void> _submit() async {
    final account = ref.read(accountProvider).valueOrNull;
    final live = account != null && !account.paperTrading && !widget.compact;

    // Biometric gate: mandatory for live orders, optional for paper trading.
    final requireAuth = live || ref.read(localStoreProvider).biometricEnabled;
    if (requireAuth) {
      final passed = await ref.read(tradeAuthGateProvider)(
        reason: live
            ? 'Confirm LIVE order: ${_isBuy ? 'buy' : 'sell'} ${widget.symbol}'
            : 'Confirm paper order: ${_isBuy ? 'buy' : 'sell'} ${widget.symbol}',
      );
      if (!passed) {
        if (mounted) setState(() => _error = 'Authentication required before sending an order');
        return;
      }
    }

    final confirmed = await _confirmSheet(live);
    if (confirmed != true || !mounted) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(tradeSubmitProvider.notifier).submit(_payload(dryRun: false));
      if (!mounted) return;
      ref.read(authServiceProvider).noteActivity();
      if (result != null) {
        _showResult(result);
        setState(() {
          _preview = null;
          _qtyController.clear();
        });
      }
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showResult(OrderResult result) {
    final colour = result.filled ? AppColors.up : AppColors.ai;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: colour,
        duration: const Duration(seconds: 5),
        content: Text(
          result.filled
              ? '${result.side} ${fmtQty(result.quantity)} ${result.symbol} @ ${fmtPrice(result.price)} '
                  '• fee ${fmtUsd(result.feeUsd)}${result.paper ? ' • paper' : ''}'
              : '${result.side} ${result.symbol} submitted — status ${result.status}',
          style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  Future<bool?> _confirmSheet(bool live) {
    final preview = _preview;
    return showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(live ? Icons.warning_amber_rounded : Icons.science_outlined, color: live ? AppColors.down : AppColors.ai),
                  const SizedBox(width: 8),
                  Text(
                    live ? 'Confirm LIVE order' : 'Confirm paper order',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              InfoRow(label: 'Symbol', value: widget.symbol, bold: true),
              InfoRow(label: 'Side', value: _isBuy ? 'BUY' : 'SELL', color: _isBuy ? AppColors.up : AppColors.down, bold: true),
              InfoRow(label: 'Type', value: _marketOrder ? 'MARKET' : 'LIMIT'),
              InfoRow(label: 'Quantity', value: fmtQty(_quantity)),
              InfoRow(label: 'Notional', value: fmtUsd(_notional), bold: true),
              if (preview != null) ...[
                InfoRow(label: 'Est. fee', value: fmtUsd(preview.estFee)),
                InfoRow(
                  label: 'Risk check',
                  value: preview.risk.allowed ? 'approved' : 'blocked: ${preview.risk.reason}',
                  color: preview.risk.allowed ? AppColors.up : AppColors.down,
                  bold: true,
                ),
                if (preview.risk.adjustedQty > 0 && (preview.risk.adjustedQty - _quantity).abs() > 1e-8)
                  InfoRow(label: 'Adjusted qty', value: '${fmtQty(preview.risk.adjustedQty)} (exchange filters)', color: AppColors.ai),
                for (final warning in preview.risk.warnings)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('⚠ $warning', style: const TextStyle(fontSize: 11, color: AppColors.ai)),
                  ),
              ],
              if (_tpController.text.trim().isNotEmpty) InfoRow(label: 'Take profit', value: _tpController.text.trim(), color: AppColors.up),
              if (_slController.text.trim().isNotEmpty) InfoRow(label: 'Stop loss', value: _slController.text.trim(), color: AppColors.down),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel'))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: _isBuy ? AppColors.up : AppColors.down,
                        foregroundColor: Colors.black87,
                      ),
                      onPressed: () => Navigator.pop(context, true),
                      child: Text(_isBuy ? 'Buy now' : 'Sell now'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final account = ref.watch(accountProvider).valueOrNull;
    final ticker = ref.watch(tickerTableProvider).valueOrNull?[widget.symbol];
    final submitting = ref.watch(tradeSubmitProvider).isLoading;
    final lastError = ref.watch(tradeSubmitProvider).error;
    final price = _price;
    final step = 0.0001;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'BUY', label: Text('Buy'), icon: Icon(Icons.arrow_upward, size: 16)),
                  ButtonSegment(value: 'SELL', label: Text('Sell'), icon: Icon(Icons.arrow_downward, size: 16)),
                ],
                selected: {_isBuy ? 'BUY' : 'SELL'},
                showSelectedIcon: false,
                style: SegmentedButton.styleFrom(
                  selectedBackgroundColor: _isBuy ? AppColors.up : AppColors.down,
                  selectedForegroundColor: Colors.black87,
                ),
                onSelectionChanged: (value) => setState(() => _isBuy = value.first == 'BUY'),
              ),
            ),
            if (widget.onClose != null)
              IconButton(onPressed: widget.onClose, icon: const Icon(Icons.close, size: 18), tooltip: 'Close'),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _MiniToggle(label: 'Market', active: _marketOrder, onTap: () => setState(() => _marketOrder = true)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MiniToggle(label: 'Limit', active: !_marketOrder, onTap: () => setState(() => _marketOrder = false)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _MiniToggle(
                label: _quoteAmount ? 'Amount in USDT' : 'Amount in ${widget.symbol.substring(0, widget.symbol.length - 4)}',
                active: true,
                onTap: () => setState(() {
                  _quoteAmount = !_quoteAmount;
                  _preview = null;
                }),
              ),
            ),
          ],
        ),
        if (!_marketOrder) ...[
          const SizedBox(height: 10),
          TextField(
            controller: _priceController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: 'Limit price',
              helperText: 'last ${fmtPrice(ticker?.price ?? price)}',
              suffixText: 'USDT',
              suffixStyle: const TextStyle(fontSize: 11),
            ),
            onChanged: (_) => setState(() => _preview = null),
          ),
        ],
        const SizedBox(height: 10),
        TextField(
          controller: _qtyController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: _quoteAmount ? 'Amount (USDT)' : 'Quantity',
            helperText: _quoteAmount
                ? '≈ ${fmtQty(_quantity)} ${_base(widget.symbol)}'
                : '≈ ${fmtUsd(_notional)}',
            suffixText: _quoteAmount ? 'USDT' : _base(widget.symbol),
            suffixStyle: const TextStyle(fontSize: 11),
          ),
          onChanged: (_) => setState(() => _preview = null),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            for (final pct in const [25.0, 50.0, 75.0, 100.0]) ...[
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _applyRiskPct(pct),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    side: BorderSide(color: (_riskPct - pct).abs() < 0.01 ? AppColors.info : theme.dividerColor),
                  ),
                  child: Text('${pct.round()}%', style: const TextStyle(fontSize: 12)),
                ),
              ),
              if (pct != 100.0) const SizedBox(width: 6),
            ],
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: Text(
                'Available ${fmtUsd(account?.cashUsd ?? 0)} • ${account?.paperTrading ?? true ? 'paper' : 'live'}',
                style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5),
              ),
            ),
            TextButton.icon(
              onPressed: _applyAiPlan,
              icon: const Icon(Icons.auto_awesome, size: 14),
              label: const Text('AI plan', style: TextStyle(fontSize: 11.5)),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _tpController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() => _preview = null),
                decoration: const InputDecoration(labelText: 'Take profit (optional)', isDense: true),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: _slController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() => _preview = null),
                decoration: const InputDecoration(labelText: 'Stop loss (optional)', isDense: true),
              ),
            ),
          ],
        ),
        if (step > 0) const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: IconButton.tonal(
                onPressed: () => _nudge(-step),
                icon: const Icon(Icons.remove, size: 16),
                tooltip: 'Decrease',
                style: IconButton.styleFrom(minimumSize: const Size(38, 30)),
              ),
            ),
            Expanded(
              child: IconButton.tonal(
                onPressed: () => _nudge(step),
                icon: const Icon(Icons.add, size: 16),
                tooltip: 'Increase',
                style: IconButton.styleFrom(minimumSize: const Size(38, 30)),
              ),
            ),
            Expanded(
              child: TextButton(onPressed: _previewOrder, child: const Text('Preview & fees', style: TextStyle(fontSize: 11.5))),
            ),
          ],
        ),
        if (_preview != null) _previewSummary(_preview!),
        if (_error != null || lastError != null)
          Container(
            margin: const EdgeInsets.only(top: 8),
            padding: const EdgeInsets.all(9),
            decoration: BoxDecoration(
              color: AppColors.down.withOpacity(0.12),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.down.withOpacity(0.4)),
            ),
            child: Text(
              _error ?? describeError(lastError!),
              style: const TextStyle(fontSize: 11.5, color: AppColors.down),
            ),
          ),
        const SizedBox(height: 10),
        FilledButton(
          onPressed: (_busy || submitting || _quantity <= 0) ? null : _submit,
          style: FilledButton.styleFrom(
            backgroundColor: _isBuy ? AppColors.up : AppColors.down,
            foregroundColor: Colors.black87,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (_busy || submitting)
                const Padding(
                  padding: EdgeInsets.only(right: 8),
                  child: SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black54)),
                )
              else
                const Padding(padding: EdgeInsets.only(right: 6), child: Icon(Icons.verified_user_outlined, size: 16)),
              Text(
                '${_isBuy ? 'Buy' : 'Sell'} ${_base(widget.symbol)}  •  ${fmtUsd(_notional)}',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Text(
          'Orders are sent to your backend over TLS with a JWT. The backend holds the Binance key, applies the risk limits, and signs the request.',
          style: theme.textTheme.bodySmall?.copyWith(fontSize: 9.5),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _previewSummary(OrderPreview preview) {
    final risk = preview.risk;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Theme.of(context).dividerColor.withOpacity(0.25),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          InfoRow(label: 'Est. fill price', value: fmtPrice(preview.estPrice)),
          InfoRow(label: 'Est. notional', value: fmtUsd(preview.estNotional)),
          InfoRow(label: 'Est. fee (0.1%)', value: fmtUsd(preview.estFee)),
          InfoRow(
            label: 'Risk gate',
            value: risk.allowed ? 'approved' : 'blocked',
            color: risk.allowed ? AppColors.up : AppColors.down,
            bold: true,
          ),
          if (!risk.allowed) Text(risk.reason, style: const TextStyle(fontSize: 11, color: AppColors.down)),
          if (risk.adjustedQty > 0 && (risk.adjustedQty - preview.quantity).abs() > 1e-8)
            Text('quantity adjusted to ${fmtQty(risk.adjustedQty)} (filters)', style: const TextStyle(fontSize: 10.5, color: AppColors.ai)),
        ],
      ),
    );
  }

  void _nudge(double delta) {
    final price = _price <= 0 ? 1 : _price;
    final current = double.tryParse(_qtyController.text.trim()) ?? 0;
    final base = _quoteAmount ? price : 1;
    final next = (current + delta * base * (price > 1000 ? 1 : 100)).clamp(0, double.infinity).toDouble();
    setState(() {
      _qtyController.text = _quoteAmount ? next.toStringAsFixed(2) : next.toStringAsFixed(6);
      _preview = null;
    });
  }

  static String _base(String symbol) {
    if (symbol.length <= 4) return symbol;
    for (final quote in const ['USDT', 'BUSD', 'USDC', 'FDUSD']) {
      if (symbol.endsWith(quote)) return symbol.substring(0, symbol.length - quote.length);
    }
    return symbol;
  }
}

class _MiniToggle extends StatelessWidget {
  const _MiniToggle({required this.label, required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: active ? AppColors.info.withOpacity(0.16) : Colors.transparent,
          border: Border.all(color: active ? AppColors.info.withOpacity(0.5) : Theme.of(context).dividerColor),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: active ? AppColors.info : null),
        ),
      ),
    );
  }
}
