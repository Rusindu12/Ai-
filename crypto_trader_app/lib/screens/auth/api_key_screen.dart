import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../models/app_user.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';

/// Binance API key capture. The whole point of this screen is what it *does
/// not* do: the secret never lands on disk, and keys with withdrawal rights are
/// refused before the request is even sent.
class ApiKeyScreen extends ConsumerStatefulWidget {
  const ApiKeyScreen({super.key, this.onDone});

  final VoidCallback? onDone;

  @override
  ConsumerState<ApiKeyScreen> createState() => _ApiKeyScreenState();
}

class _ApiKeyScreenState extends ConsumerState<ApiKeyScreen> {
  final _key = TextEditingController();
  final _secret = TextEditingController();
  final _label = TextEditingController(text: 'default');
  bool _testnet = true;
  bool _checkedTradeOnly = false;
  bool _checkedIp = false;
  bool _busy = false;
  String? _error;
  String? _ok;

  @override
  void dispose() {
    _key.dispose();
    _secret.dispose();
    _label.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _ok = null;
    });
    try {
      final result = await ref.read(keyVaultProvider).submit(
            apiKey: _key.text,
            apiSecret: _secret.text,
            label: _label.text.trim().isEmpty ? 'default' : _label.text.trim(),
            isTestnet: _testnet,
          );
      if (!mounted) return;
      setState(() {
        _ok = 'Stored. ${result['masked_key'] ?? result['label'] ?? 'Key'} — encrypted server-side.';
        _key.clear();
        _secret.clear();
      });
      ref.invalidate(keyStatusProvider);
      ref.invalidate(accountProvider);
    } on Exception catch (e) {
      if (mounted) setState(() => _error = describeError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(keyStatusProvider).valueOrNull;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Connect Binance')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          SectionCard(
            title: '1 · Create the key in Binance',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final line in const [
                  'Binance → Profile → API Management → Create API key (label it "AI Trader").',
                  'Enable **Spot & Margin Trading** ONLY. Leave withdrawals disabled.',
                  'Add your server\'s IP to the key whitelist (the backend refuses keys without restrictions in production).',
                  'Copy the key and secret here once — we delete them from the phone immediately after upload.',
                ])
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.check_circle_outline, size: 15, color: AppColors.info),
                        const SizedBox(width: 8),
                        Expanded(child: Text(line.replaceAll('**', ''), style: const TextStyle(fontSize: 12, height: 1.4))),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: '2 · Paste & submit',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _key,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'API key', prefixIcon: Icon(Icons.key, size: 18)),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _secret,
                  obscureText: true,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'API secret', prefixIcon: Icon(Icons.password, size: 18)),
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: 10),
                TextField(controller: _label, decoration: const InputDecoration(labelText: 'Label (shown in the app only)')),
                const SizedBox(height: 10),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: _testnet,
                  onChanged: (value) => setState(() => _testnet = value),
                  title: const Text('Binance testnet key', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: const Text('Recommended first: testnet.binance.vision', style: TextStyle(fontSize: 11)),
                ),
                const SizedBox(height: 6),
                _ChecklistTile(label: 'This key cannot withdraw funds', value: _checkedTradeOnly, onChanged: (v) => setState(() => _checkedTradeOnly = v)),
                _ChecklistTile(label: 'This key is IP-restricted', value: _checkedIp, onChanged: (v) => setState(() => _checkedIp = v)),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: (_busy || _key.text.trim().length < 24 || _secret.text.trim().length < 24 || !_checkedTradeOnly)
                      ? null
                      : _submit,
                  child: _busy ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Encrypt & upload to my backend'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 10),
                  Text(_error!, style: const TextStyle(color: AppColors.down, fontSize: 11.5)),
                ],
                if (_ok != null) ...[
                  const SizedBox(height: 10),
                  Text(_ok!, style: const TextStyle(color: AppColors.up, fontSize: 11.5)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Currently configured keys',
            child: status == null
                ? const LoadingBox(height: 48, message: 'Checking…')
                : status.count == 0
                    ? const EmptyState(icon: Icons.vpn_key_off, title: 'No keys yet', message: 'Skip this step to use demo/paper mode.', compact: true)
                    : Column(
                        children: [
                          for (final key in [if (status.active != null) status.active!])
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.lock_outline, size: 18, color: AppColors.up),
                              title: Text('${key.label} · ${key.maskedKey}', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                              subtitle: Text(
                                'trade-only ${key.isTestnet ? '· testnet ' : '· MAINNET '}· ${status.provider}\nfp ${key.fingerprint}',
                                style: const TextStyle(fontSize: 10.5, height: 1.4),
                              ),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline, size: 18),
                                onPressed: () async {
                                  await ref.read(keyVaultProvider).remove(key.id);
                                  ref.invalidate(keyStatusProvider);
                                },
                              ),
                            ),
                          if (status.canWithdraw)
                            const Padding(
                              padding: EdgeInsets.only(top: 6),
                              child: Text('⚠ this key reports withdrawal permission — replace it', style: TextStyle(color: AppColors.down, fontSize: 11)),
                            ),
                        ],
                      ),
          ),
          const SizedBox(height: 16),
          Text(
            'Nothing on this screen is written to storage. Keys are encrypted with AES-256-GCM using a KMS/Vault-managed key, '
            'bound to your user id as additional authenticated data, and only decrypted inside the request that calls Binance.',
            style: theme.textTheme.bodySmall?.copyWith(fontSize: 10, height: 1.5),
          ),
          const SizedBox(height: 14),
          OutlinedButton(
            onPressed: () {
              widget.onDone?.call();
              Navigator.of(context).popUntil((route) => route.isFirst);
            },
            child: const Text('Skip — keep using demo mode'),
          ),
        ],
      ),
    );
  }
}

class _ChecklistTile extends StatelessWidget {
  const _ChecklistTile({required this.label, required this.value, required this.onChanged});

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      controlAffinity: ListTileControlAffinity.leading,
      value: value,
      onChanged: (next) => onChanged(next ?? false),
      title: Text(label, style: const TextStyle(fontSize: 12)),
    );
  }
}
