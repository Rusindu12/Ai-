import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/env.dart';
import '../../core/errors.dart';
import '../../core/theme.dart';
import '../../providers/app_state.dart';
import '../../providers/providers.dart';
import '../../services/auth_service.dart';
import '../../services/firebase_auth_bridge.dart';
import '../../services/push_service.dart';
import '../auth/api_key_screen.dart';

/// Login / Register with email+password, optional 2FA code, Google sign-in and
/// a biometric unlock shortcut.
///
/// The backend accepts either its own credentials or a Firebase/Google token.
/// When Firebase is not configured, the Google button degrades to a message
/// pointing at docs/FIREBASE_SETUP.md instead of failing cryptically.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _totp = TextEditingController();
  bool _registering = false;
  bool _busy = false;
  bool _showPassword = false;
  bool _askTotp = false;
  String? _error;
  String? _notice;

  @override
  void initState() {
    super.initState();
    // Pre-fill whatever the encrypted store still has for this device.
    unawaited(_prefill());
  }

  Future<void> _prefill() async {
    final saved = await ref.read(secureStoreProvider).savedEmail;
    if (saved != null && saved.isNotEmpty && mounted) {
      setState(() => _email.text = saved);
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    _totp.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final auth = ref.read(authServiceProvider);
      if (_registering) {
        await auth.register(email: _email.text.trim(), password: _password.text, name: _name.text.trim());
        if (!mounted) return;
        await ref.read(backendApiProvider).saveSettings(paperTrading: true, theme: 'dark', locale: ref.read(appLocaleProvider).languageCode);
        if (!mounted) return;
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ApiKeyScreen(onDone: null)));
      } else {
        await auth.emailLogin(email: _email.text.trim(), password: _password.text, totpCode: _askTotp ? _totp.text.trim() : null);
      }
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } on AppException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _askTotp = e.code == 'totp_required' || e.code == 'invalid_totp' ? true : _askTotp;
      });
    } on Exception catch (e) {
      if (mounted) setState(() => _error = describeError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _google() async {
    setState(() {
      _error = null;
      _notice = null;
    });
    if (!AppConfig.hasFirebase) {
      setState(() => _notice = 'Google sign-in needs Firebase. Run flutterfire configure and rebuild — see docs/FIREBASE_SETUP.md.');
      return;
    }
    setState(() => _busy = true);
    try {
      // The id token comes from google_sign_in; FirebaseAuth then exchanges it
      // for our backend JWT (so the backend remains the single source of truth).
      final firebaseUser = await ref.read(firebaseAuthProvider).signInWithGoogle();
      if (firebaseUser == null) {
        if (mounted) setState(() => _notice = 'Google sign-in cancelled');
        return;
      }
      final idToken = await firebaseUser.getIdToken() ?? '';
      if (idToken.isEmpty) {
        if (mounted) setState(() => _error = 'Firebase returned no id token');
        return;
      }
      await ref.read(authServiceProvider).googleLogin(idToken);
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } on AppException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on Exception catch (e) {
      if (mounted) setState(() => _error = 'Google sign-in failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _biometric() async {
    setState(() => _error = null);
    final ok = await ref.read(authServiceProvider).biometricUnlock();
    if (!ok && mounted) {
      setState(() => _error = 'No stored session for this device — sign in with your password once');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _registering ? 'Create your account' : 'Welcome back',
                        style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
                      ),
                    ),
                    TextButton(
                      onPressed: () => setState(() {
                        _registering = !_registering;
                        _error = null;
                      }),
                      child: Text(_registering ? 'Sign in' : 'Register', style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ],
                ),
                Text(
                  'Your credentials only ever touch your own backend. Binance keys are stored server-side, encrypted.',
                  style: theme.textTheme.bodySmall?.copyWith(height: 1.4),
                ),
                const SizedBox(height: 18),
                if (_registering) ...[
                  TextFormField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'Display name', prefixIcon: Icon(Icons.person_outline, size: 18)),
                    validator: (value) => (value ?? '').trim().length < 2 ? 'Give yourself a name (2+ characters)' : null,
                  ),
                  const SizedBox(height: 12),
                ],
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.alternate_email, size: 18)),
                  validator: (value) {
                    final text = (value ?? '').trim();
                    if (!text.contains('@') || !text.contains('.') || text.length < 6) return 'Enter a valid email';
                    return null;
                  },
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _password,
                  obscureText: !_showPassword,
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_outline, size: 18),
                    suffixIcon: IconButton(
                      icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility, size: 18),
                      onPressed: () => setState(() => _showPassword = !_showPassword),
                    ),
                    helperText: _registering ? 'Minimum 10 characters, with a number and a symbol' : null,
                  ),
                  validator: (value) {
                    final text = value ?? '';
                    if (text.length < 8) return 'Too short';
                    if (_registering) {
                      final strong = RegExp(r'(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z\d])').hasMatch(text);
                      if (!strong) return 'Needs upper, lower, digit and symbol';
                    }
                    return null;
                  },
                  onFieldSubmitted: (_) => _submit(),
                ),
                if (_askTotp) ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _totp,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(labelText: ' authenticator code', prefixText: '6 ', counterText: ''),
                    validator: (value) => (value ?? '').length == 6 ? null : 'Enter the 6-digit code',
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: AppColors.down.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.down.withOpacity(0.4)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.error_outline, size: 16, color: AppColors.down),
                        const SizedBox(width: 8),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 11.5, color: AppColors.down, height: 1.35))),
                      ],
                    ),
                  ),
                ],
                if (_notice != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: AppColors.ai.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(_notice!, style: const TextStyle(fontSize: 11.5, color: AppColors.ai, height: 1.35)),
                  ),
                ],
                const SizedBox(height: 18),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 15)),
                  child: _busy
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white70))
                      : Text(_registering ? 'Create account' : 'Sign in', style: const TextStyle(fontSize: 15)),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _google,
                  icon: const Icon(Icons.g_mobiledata, size: 26),
                  label: Text(_registering ? 'Register with Google' : 'Continue with Google'),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _biometric,
                  icon: const Icon(Icons.fingerprint, size: 22),
                  label: const Text('Unlock with biometrics'),
                ),
                const SizedBox(height: 22),
                Divider(color: theme.dividerColor),
                const SizedBox(height: 10),
                Text(
                  'Backend: ${AppConfig.apiBaseUrl}\n'
                  'SSL pinning: ${AppConfig.pinnedCertHashes.isEmpty ? 'not configured (build with --dart-define=PIN_SHA256=…)' : '${AppConfig.pinnedCertHashes.length} pin(s)'}',
                  style: theme.textTheme.bodySmall?.copyWith(fontSize: 10),
                  textAlign: TextAlign.center,
                ),
                TextButton(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _DemoNotice())),
                  child: const Text('What happens to my data?', style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DemoNotice extends ConsumerWidget {
  const _DemoNotice();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(serverConfigProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy & demo mode')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            config?.demoMode ?? true
                ? 'Demo mode is ON: the backend is running its own market simulator, so every price, candle and fill you see is synthetic. No Binance account, key or network call is required, and nothing is sent anywhere except your own server.'
                : 'Demo mode is OFF: prices come from Binance through your backend, and orders go to your real account.',
            style: const TextStyle(fontSize: 13, height: 1.5),
          ),
          const SizedBox(height: 14),
          const Text('What the backend stores', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
            '• Your email, display name, hashed password (Argon2)\n'
            '• Refresh-token hashes + revocation list (for logout everywhere)\n'
            '• Your encrypted Binance key material (AES-256-GCM; key from AWS KMS or Vault Transit in production)\n'
            '• Orders, fills, AI signals, alerts and notification receipts — so the app can show history offline',
            style: TextStyle(fontSize: 12, height: 1.6),
          ),
          const SizedBox(height: 14),
          const Text('What is never stored on the phone', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text(
            '• Your Binance API secret (it is wiped from memory right after upload)\n'
            '• Your password (only the JWT pair lives in EncryptedSharedPreferences)',
            style: TextStyle(fontSize: 12, height: 1.6),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () async {
              await ref.read(pushServiceProvider).topic('u_${ref.read(authServiceProvider).userId}', subscribe: false);
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }
}
