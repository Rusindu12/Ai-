import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'providers/app_state.dart';
import 'providers/providers.dart';
import 'screens/booted_shell.dart';
import 'screens/splash_screen.dart';

class CryptoTraderApp extends ConsumerStatefulWidget {
  const CryptoTraderApp({super.key});

  @override
  ConsumerState<CryptoTraderApp> createState() => _CryptoTraderAppState();
}

class _CryptoTraderAppState extends ConsumerState<CryptoTraderApp> {
  @override
  void initState() {
    super.initState();
    // Register the push token with the backend once the session exists.
    Future.microtask(() async {
      final push = ref.read(pushServiceProvider);
      if (push.ready && push.token != null) {
        try {
          await ref.read(backendApiProvider).registerPush(push.token);
          await ref.read(secureStoreProvider).saveFcmToken(push.token!);
        } on Exception {
          // non-fatal
        }
      }
    });
  }

  Brightness _brightness(ThemeMode mode, Brightness platform) => switch (mode) {
        ThemeMode.light => Brightness.light,
        ThemeMode.dark => Brightness.dark,
        ThemeMode.system => platform,
      };

  @override
  Widget build(BuildContext context) {
    final themePreference = ref.watch(themeModeProvider);
    final platformBrightness = MediaQuery.platformBrightnessOf(context);
    final locale = ref.watch(appLocaleProvider);
    final auth = ref.watch(authStateProvider);

    return MaterialApp(
      title: 'CryptoTrader AI',
      debugShowCheckedModeBanner: false,
      themeMode: themePreference,
      theme: buildTheme(brightness: Brightness.light),
      darkTheme: buildTheme(brightness: _brightness(themePreference, platformBrightness) == Brightness.light ? Brightness.light : Brightness.dark),
      locale: locale,
      localeResolutionCallback: (device, supported) => locale,
      home: auth.isLoading
          ? const SplashScreen()
          : (auth.valueOrNull?.signedIn ?? false)
              ? const BootedShell()
              : SplashScreen(error: auth.valueOrNull?.error, locked: auth.valueOrNull?.locked ?? false),
      builder: (context, child) {
        // Any tap is activity: it resets the 15-minute idle lock timer.
        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (_) => ref.read(authServiceProvider).noteActivity(),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
