import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../core/formatters.dart';
import '../../core/logger.dart';
import '../../core/theme.dart';
import '../../main.dart' show buildTargetSummary;
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../widgets/common.dart';
import '../../widgets/pickers.dart';
import '../auth/api_key_screen.dart';

/// Screen 7 — Settings: account, trading limits, security, notifications,
/// connection/backend info and diagnostics.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _busy = false;
  String? _notice;
  final _totp = TextEditingController();

  @override
  void dispose() {
    _totp.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action, String doneMessage) async {
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await action();
      if (mounted) setState(() => _notice = doneMessage);
    } on AppException catch (e) {
      if (mounted) setState(() => _notice = e.message);
    } on Exception catch (e) {
      if (mounted) setState(() => _notice = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsProvider).valueOrNull;
    final user = ref.watch(authStateProvider).valueOrNull?.user;
    final config = ref.watch(serverConfigProvider).valueOrNull;
    final account = ref.watch(accountProvider).valueOrNull;
    final keyStatus = ref.watch(keyStatusProvider).valueOrNull;
    final themeMode = ref.watch(themeModeProvider);
    final locale = ref.watch(appLocaleProvider);
    final theme = Theme.of(context);

    final trading = (settings?['trading'] as Map?)?.cast<String, dynamic>() ?? const {};
    final security = (settings?['security'] as Map?)?.cast<String, dynamic>() ?? const {};
    final notif = (settings?['notifications'] as Map?)?.cast<String, dynamic>() ?? const {};
    final app = (settings?['app'] as Map?)?.cast<String, dynamic>() ?? const {};

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 6, 14, 30),
        children: [
          // ------------------------------------------------------------- profile
          SectionCard(
            title: user?.email ?? 'account',
            subtitle: '${user?.name ?? ''} · user #${user?.id ?? 0} · role ${user?.role ?? 'user'}',
            trailing: IconButton(
              tooltip: 'Refresh',
              onPressed: () => ref.invalidate(settingsProvider),
              icon: const Icon(Icons.refresh, size: 18),
            ),
            child: Column(
              children: [
                KeyValueGrid(rows: [
                  InfoRow(label: 'Risk level', value: '${trading['risk_level'] ?? user?.riskLevel ?? '—'}'),
                  InfoRow(label: 'Max trade', value: fmtUsd((trading['max_trade_size_usd'] as num?)?.toDouble() ?? 0, decimals: 0)),
                  InfoRow(label: 'Daily loss limit', value: fmtUsd((trading['daily_loss_limit_usd'] as num?)?.toDouble() ?? 0, decimals: 0)),
                  InfoRow(label: 'Paper trading', value: '${trading['paper_trading'] ?? true ? 'on' : 'OFF (LIVE)'}'),
                ]),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => ref.read(authServiceProvider).logout(),
                  icon: const Icon(Icons.logout, size: 16),
                  label: const Text('Sign out of this device'),
                ),
                const SizedBox(height: 6),
                TextButton(
                  onPressed: () async {
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Sign out everywhere?'),
                        content: const Text('Every refresh token is revoked server-side. You will have to log in again on all devices.'),
                        actions: [
                          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out all')),
                        ],
                      ),
                    );
                    if (confirmed == true) await ref.read(authServiceProvider).logoutEverywhere();
                  },
                  child: const Text('Sign out of all devices', style: TextStyle(fontSize: 11.5, color: AppColors.down)),
                ),
              ],
            ),
          ),
          const SectionTitle(text: 'Trading', icon: Icons.tune),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: account?.paperTrading ?? true,
                  onChanged: _busy
                      ? null
                      : (value) => _run(() async {
                            await ref.read(backendApiProvider).saveSettings(paperTrading: value);
                            ref.invalidate(accountProvider);
                            ref.invalidate(settingsProvider);
                          }, value ? 'Paper trading enabled' : 'LIVE trading enabled — real orders will be sent'),
                  title: const Text('Paper trading', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: Text(
                    value_off(account?.paperTrading ?? true),
                    style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5),
                  ),
                  activeColor: AppColors.up,
                ),
                const SizedBox(height: 6),
                RiskLevelSelector(
                  value: user?.riskLevel ?? 'moderate',
                  onChanged: (value) => _run(() async {
                    await ref.read(backendApiProvider).saveSettings(riskLevel: value);
                    ref.invalidate(settingsProvider);
                    ref.invalidate(accountProvider);
                  }, 'Risk profile: $value'),
                ),
                const SizedBox(height: 12),
                _limitSlider(
                  label: 'Max size per trade',
                  value: (trading['max_trade_size_usd'] as num?)?.toDouble() ?? 250,
                  min: 10,
                  max: 5000,
                  format: (v) => fmtUsd(v, decimals: 0),
                  onSave: (v) => _run(() async {
                    await ref.read(backendApiProvider).saveSettings(maxTradeSizeUsd: v);
                    ref.invalidate(settingsProvider);
                  }, 'Max trade size ${fmtUsd(v, decimals: 0)}'),
                ),
                _limitSlider(
                  label: 'Daily loss limit',
                  value: (trading['daily_loss_limit_usd'] as num?)?.toDouble() ?? 500,
                  min: 10,
                  max: 10000,
                  format: (v) => fmtUsd(v, decimals: 0),
                  onSave: (v) => _run(() async {
                    await ref.read(backendApiProvider).saveSettings(dailyLossLimitUsd: v);
                    ref.invalidate(settingsProvider);
                  }, 'Daily loss limit ${fmtUsd(v, decimals: 0)}'),
                ),
              ],
            ),
          ),
          const SectionTitle(text: 'Security', icon: Icons.shield_outlined),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: ref.watch(localStoreProvider).biometricEnabled,
                  onChanged: (value) async {
                    ref.read(localStoreProvider).setBiometric(value);
                    await ref.read(backendApiProvider).saveSettings(biometricEnabled: value);
                    ref.invalidate(settingsProvider);
                  },
                  title: const Text('Biometric trade confirmation', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: const Text('Fingerprint/device credential before every order', style: TextStyle(fontSize: 10.5)),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: ref.watch(executeFromSignalProvider),
                  onChanged: (value) => ref.read(executeFromSignalProvider.notifier).state = value,
                  title: const Text('Allow "Execute" from the AI card', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: const Text('Still requires the biometric gate and the server risk check', style: TextStyle(fontSize: 10.5)),
                ),
                const Divider(height: 18),
                InfoRow(label: 'Auto-lock', value: '${security['auto_logout_minutes'] ?? config?.autoLogoutMinutes ?? 15} minutes idle'),
                InfoRow(label: '2FA', value: asText(security['two_factor_enabled']) ? 'enabled' : 'not enabled', color: asText(security['two_factor_enabled']) ? AppColors.up : AppColors.ai),
                InfoRow(label: 'Keys stored on device', value: asText(security['keys_on_device']) ? 'YES — fix this' : 'no (backend vault)', color: asText(security['keys_on_device']) ? AppColors.down : AppColors.up),
                InfoRow(label: 'Key encryption', value: '${security['key_provider'] ?? config?.keyProvider ?? 'local'} · AES-256-GCM + AAD(user id)'),
                InfoRow(label: 'Play Integrity', value: '${security['integrity_mode'] ?? config?.integrityMode ?? 'disabled'}'),
                InfoRow(label: 'SSL pinning', value: AppConfig.pinnedCertHashes.isEmpty ? 'not built in' : '${AppConfig.pinnedCertHashes.length} pins'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _enable2fa(),
                        icon: const Icon(Icons.lock_outline, size: 16),
                        label: const Text('Set up 2FA', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () async {
                          await ref.read(secureStoreProvider).clearSession(keepCredentials: false);
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Local tokens wiped')));
                          }
                        },
                        icon: const Icon(Icons.cleaning_services_outlined, size: 16),
                        label: const Text('Wipe tokens', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SectionTitle(text: 'Binance key', icon: Icons.vpn_key_outlined),
          SectionCard(
            title: keyStatus?.configured ?? false ? 'Connected: ${keyStatus!.active!.label}' : 'Not connected',
            subtitle: keyStatus?.configured ?? false
                ? '${keyStatus!.active!.maskedKey} · ${keyStatus.isTestnet ? 'testnet' : 'mainnet'} · ${keyStatus.provider}'
                : 'Demo/paper mode works without any key',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                FilledButton.tonalIcon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ApiKeyScreen())),
                  icon: const Icon(Icons.add_link, size: 16),
                  label: Text(keyStatus?.configured ?? false ? 'Replace / add a key' : 'Add a Binance API key'),
                ),
                if (keyStatus?.configured ?? false) ...[
                  const SizedBox(height: 6),
                  TextButton(
                    onPressed: () async {
                      await ref.read(keyVaultProvider).remove(keyStatus!.active!.id);
                      ref.invalidate(keyStatusProvider);
                      ref.invalidate(accountProvider);
                    },
                    child: const Text('Remove key', style: TextStyle(fontSize: 11.5, color: AppColors.down)),
                  ),
                ],
              ],
            ),
          ),
          const SectionTitle(text: 'Notifications', icon: Icons.notifications_outlined),
          SectionCard(
            child: Column(
              children: [
                for (final entry in const [
                  ('price_alerts', 'Price alerts'),
                  ('ai_signals', 'AI signals'),
                  ('trade_confirmations', 'Order fills'),
                  ('portfolio_updates', 'Portfolio summary'),
                  ('market_summary_daily', 'Daily recap'),
                ])
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    value: asText(notif[entry.$1]),
                    onChanged: (value) => _run(() async {
                      await ref.read(backendApiProvider).saveSettings(notificationPrefs: {entry.$1: value});
                      ref.invalidate(settingsProvider);
                    }, '${entry.$2} ${value ? 'on' : 'off'}'),
                    title: Text(entry.$2, style: const TextStyle(fontSize: 12.5)),
                  ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'FCM: ${ref.read(pushServiceProvider).ready ? "registered" : (ref.read(pushServiceProvider).lastError ?? "not configured")}',
                        style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5),
                      ),
                    ),
                    TextButton(onPressed: () => ref.invalidate(notificationsProvider), child: const Text('Reload inbox', style: TextStyle(fontSize: 11))),
                  ],
                ),
              ],
            ),
          ),
          const SectionTitle(text: 'Appearance & language', icon: Icons.palette_outlined),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SegmentedButton<ThemeMode>(
                  segments: const [
                    ButtonSegment(value: ThemeMode.dark, label: Text('Dark'), icon: Icon(Icons.dark_mode, size: 15)),
                    ButtonSegment(value: ThemeMode.light, label: Text('Light'), icon: Icon(Icons.light_mode, size: 15)),
                    ButtonSegment(value: ThemeMode.system, label: Text('System'), icon: Icon(Icons.brightness_auto, size: 15)),
                  ],
                  selected: {themeMode},
                  showSelectedIcon: false,
                  onSelectionChanged: (value) => ref.read(themeModeProvider.notifier).set(value.first),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  children: [
                    for (final code in const ['en', 'es', 'ar', 'si'])
                      ChoiceChip(
                        label: Text(code.toUpperCase()),
                        selected: locale.languageCode == code,
                        onSelected: (_) => ref.read(appLocaleProvider.notifier).set(code),
                        labelStyle: const TextStyle(fontSize: 11),
                      ),
                  ],
                ),
                Text('العربية enables right-to-left. සිංහල · Español · English', style: theme.textTheme.bodySmall?.copyWith(fontSize: 10)),
              ],
            ),
          ),
          const SectionTitle(text: 'Backend', icon: Icons.dns_outlined),
          SectionCard(
            title: AppConfig.apiBaseUrl,
            subtitle: 'target: ${AppConfig.summary}',
            child: Column(
              children: [
                InfoRow(label: 'Environment', value: '${app['environment'] ?? config?.environment ?? '—'}'),
                InfoRow(label: 'Backend version', value: '${app['backend_version'] ?? config?.backendVersion ?? '—'}'),
                InfoRow(label: 'Demo mode', value: '${app['demo_mode'] ?? config?.demoMode}'),
                InfoRow(label: 'Min order', value: fmtUsd(app['min_order_notional_usd'] as num? != null ? (app['min_order_notional_usd'] as num).toDouble() : config?.minNotionalUsd ?? 10, decimals: 2)),
                InfoRow(label: 'Markets', value: '${(app['markets'] as List?)?.length ?? config?.markets.length ?? 0} pairs'),
                InfoRow(label: 'Token TTL', value: '${config?.accessTokenMinutes ?? 60} min (refresh rotates)'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : () => _run(() async {
                              final status = await ref.read(backendApiProvider).status();
                              throw AppException('Backend ${status['version'] ?? '?'} · uptime ${status['uptime_s'] ?? '?'}s', code: 'info');
                            }, 'health checked'),
                        icon: const Icon(Icons.monitor_heart_outlined, size: 16),
                        label: const Text('Health check', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => showDialog<void>(context: context, builder: (_) => const _DiagnosticsDialog()),
                        icon: const Icon(Icons.bug_report_outlined, size: 16),
                        label: const Text('Diagnostics', style: TextStyle(fontSize: 11.5)),
                      ),
                    ),
                  ],
                ),
                if (_notice != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(_notice!, style: const TextStyle(fontSize: 11, color: AppColors.info)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            (settings?['legal'] as Map?)?['disclaimer']?.toString() ??
                'Trading cryptocurrencies carries the risk of losing all of your capital. This software is provided as-is, without warranty, and nothing in it is financial advice.',
            style: theme.textTheme.bodySmall?.copyWith(fontSize: 9.5, height: 1.5),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Center(child: Text(buildTargetSummary, style: theme.textTheme.bodySmall?.copyWith(fontSize: 9))),
        ],
      ),
    );
  }

  String value_off(bool paper) => paper
      ? 'Orders are simulated against live prices. Turn off to trade with real money.'
      : 'LIVE: every order goes to your Binance account. Use the kill switch in the AI tab if something looks wrong.';

  bool asText(Object? value) => value == true || value == 'true' || value == 1;

  Future<void> _enable2fa() async {
    try {
      final setup = await ref.read(backendApiProvider).setup2fa();
      if (!mounted) return;
      final secret = '${setup['secret'] ?? ''}';
      final uri = '${setup['otpauth_uri'] ?? ''}';
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Two-factor authentication'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Add this secret to Google Authenticator / Aegis / Authy, then confirm the 6-digit code.', style: TextStyle(fontSize: 12)),
                const SizedBox(height: 10),
                SelectableText(secret, style: const TextStyle(fontFamily: 'monospace', fontSize: 13, letterSpacing: 1.2)),
                if (uri.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  SelectableText(uri, style: const TextStyle(fontSize: 9.5)),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _totp,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  decoration: const InputDecoration(labelText: 'Code from your app', counterText: ''),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                final code = _totp.text.trim();
                Navigator.pop(context);
                await _run(() async {
                  await ref.read(backendApiProvider).enable2fa(code);
                  ref.invalidate(settingsProvider);
                }, '2FA enabled — keep your recovery codes safe');
              },
              child: const Text('Enable'),
            ),
          ],
        ),
      );
    } on AppException catch (e) {
      if (mounted) setState(() => _notice = e.message);
    }
  }

  Widget _limitSlider({
    required String label,
    required double value,
    required double min,
    required double max,
    required String Function(double) format,
    required void Function(double) onSave,
  }) {
    var draft = value;
    return StatefulBuilder(
      builder: (context, setStateLocal) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(label, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600))),
              Text(format(draft), style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w800, color: AppColors.info)),
            ],
          ),
          Slider(
            value: draft.clamp(min, max),
            min: min,
            max: max,
            divisions: 25,
            onChanged: (v) => setStateLocal(() => draft = v),
            onChangeEnd: (_) => onSave(draft),
          ),
        ],
      ),
    );
  }
}

class _DiagnosticsDialog extends ConsumerWidget {
  const _DiagnosticsDialog();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final log = ref.read(logProvider);
    final realtime = ref.read(realtimeProvider);
    final entries = log.recent;
    return AlertDialog(
      title: const Text('Diagnostics'),
      content: SizedBox(
        width: 520,
        height: 360,
        child: ListView(
          children: [
            InfoRow(label: 'Socket', value: '${realtime.currentState.label} · ${realtime.eventsReceived} events · ${realtime.reconnects} reconnects'),
            InfoRow(label: 'Channels', value: realtime.channels.join(', ')),
            InfoRow(label: 'Build', value: buildTargetSummary),
            const Divider(height: 18),
            if (entries.isEmpty) const Padding(padding: EdgeInsets.all(12), child: Text('No log lines yet.')),
            for (final entry in entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 60, child: Text(entry.label, style: const TextStyle(fontSize: 9.5, fontFamily: 'monospace'))),
                    Expanded(
                      child: Text(
                        entry.message,
                        style: TextStyle(
                          fontSize: 10,
                          fontFamily: 'monospace',
                          color: switch (entry.level) {
                            LogLevel.error => AppColors.down,
                            LogLevel.warn => AppColors.ai,
                            _ => null,
                          },
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => log.clear(), child: const Text('Clear')),
        FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    );
  }
}
