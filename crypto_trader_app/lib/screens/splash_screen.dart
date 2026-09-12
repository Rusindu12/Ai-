import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env.dart';
import '../core/theme.dart';
import '../providers/app_state.dart';
import '../providers/providers.dart';
import 'auth/login_screen.dart';

/// Splash: brand, connection probe, then straight into Login (or the app, when
/// the session restored). Also the place where "backend unreachable" is
/// explained in plain language with a Retry.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key, this.error, this.locked = false});

  final String? error;
  final bool locked;

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);
  String? _probe;
  bool _probing = true;

  @override
  void initState() {
    super.initState();
    unawaited(_probeBackend());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _probeBackend() async {
    setState(() {
      _probing = true;
      _probe = null;
    });
    try {
      final status = await ref.read(backendApiProvider).status().timeout(const Duration(seconds: 8));
      if (!mounted) return;
      setState(() {
        _probe = null;
        _probing = false;
      });
      // Auto-continue when a session already restored.
      if (ref.read(authStateProvider).valueOrNull?.signedIn ?? false) return;
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _probe = e.toString();
        _probing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authStateProvider).valueOrNull;
    if (auth != null && auth.signedIn) {
      return const SizedBox.shrink(); // app.dart swaps to the shell
    }
    final offline = _probe != null;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
          child: Column(
            children: [
              const Spacer(flex: 2),
              FadeTransition(
                opacity: Tween(begin: 0.55, end: 1.0).animate(_controller),
                child: Image.asset('assets/images/logo.png', width: 92, height: 92, errorBuilder: (c, e, s) => const Icon(Icons.candlestick_chart, size: 62, color: AppColors.up)),
              ),
              const SizedBox(height: 16),
              const Text('CryptoTrader', style: TextStyle(fontSize: 27, fontWeight: FontWeight.w900, letterSpacing: -0.6)),
              const Text('AI · Binance · your backend', style: TextStyle(fontSize: 12, color: AppColors.info, fontWeight: FontWeight.w700, letterSpacing: 1.2)),
              const Spacer(),
              if (_probing)
                Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const SizedBox(height: 13, width: 13, child: CircularProgressIndicator(strokeWidth: 2)),
                      const SizedBox(width: 8),
                      Text('Connecting to ${AppConfig.summary}', style: const TextStyle(fontSize: 11)),
                    ])
              else if (offline)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.down.withOpacity(0.10),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.down.withOpacity(0.4)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.wifi_off, size: 16, color: AppColors.down),
                          SizedBox(width: 6),
                          Text('Backend unreachable', style: TextStyle(fontWeight: FontWeight.w800, color: AppColors.down, fontSize: 13)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'App is built for: ${AppConfig.apiBaseUrl}\n'
                        'On the Android emulator the host machine is 10.0.2.2.\n'
                        'Start the backend (docker compose up) or change the URL in the field below.',
                        style: const TextStyle(fontSize: 11, height: 1.4),
                      ),
                      const SizedBox(height: 8),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(onPressed: () => unawaited(_probeBackend()), child: const Text('Retry')),
                      ),
                    ],
                  ),
                )
              else
                const Text('Backend online', style: TextStyle(fontSize: 11, color: AppColors.up, fontWeight: FontWeight.w700)),
              const SizedBox(height: 18),
              if (widget.locked)
                _LockedCard(onUnlock: () async {
                  final ok = await ref.read(authServiceProvider).biometricUnlock();
                  if (!ok && context.mounted) {
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
                  }
                })
              else
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _probing ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                    style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 15)),
                    child: Text((auth?.savedEmail ?? '').isEmpty ? 'Get started' : 'Continue as ${auth!.savedEmail}'),
                  ),
                ),
              const SizedBox(height: 10),
              if ((auth?.savedEmail ?? '').isNotEmpty)
                TextButton(
                  onPressed: () => ref.read(authServiceProvider).biometricUnlock(),
                  child: const Text('Unlock with biometrics', style: TextStyle(fontSize: 12)),
                ),
              const SizedBox(height: 26),
              Text(
                'Trading crypto carries the risk of losing all of your capital. Nothing here is financial advice.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 9.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LockedCard extends StatelessWidget {
  const _LockedCard({required this.onUnlock});

  final Future<void> Function() onUnlock;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            color: AppColors.ai.withOpacity(0.10),
            border: Border.all(color: AppColors.ai.withOpacity(0.4)),
          ),
          child: const Row(
            children: [
              Icon(Icons.lock_clock, size: 18, color: AppColors.ai),
              SizedBox(width: 8),
              Expanded(
                child: Text('Locked after 15 minutes of inactivity', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: () => onUnlock(),
            icon: const Icon(Icons.fingerprint, size: 20),
            label: const Text('Unlock'),
          ),
        ),
      ],
    );
  }
}
