import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/env.dart';
import 'core/logger.dart';
import 'core/storage.dart';
import 'providers/providers.dart';
import 'services/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait: the trading UI is designed as a vertical, thumb-first
  // layout (charts re-flow badly on rotation mid-order).
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Color(0xFF0B1220),
      statusBarIconBrightness: Brightness.light,
    ),
  );

  // Never crash to a grey screen: log + show a retry card instead.
  final log = AppLog(echo: !kReleaseMode);
  FlutterError.onError = (details) {
    log.error('Flutter error', details.exception);
    FlutterError.presentError(details);
  };
  await runZonedGuarded(
    () async => await _bootstrap(log),
    (error, stack) => log.error('Uncaught', '$error\n$stack'),
  );
}

Future<void> _bootstrap(AppLog log) async {
  final local = await LocalStore.open();
  final secure = SecureStore();

  // Firebase is optional. A missing/placeholder google-services.json must not
  // stop the app: alerts fall back to the WebSocket channel.
  final push = PushService();
  try {
    await push.init();
    log.info(push.ready ? 'FCM ready' : 'FCM disabled (${push.lastError})');
  } on Exception catch (e) {
    log.warn('Firebase init skipped: $e');
  }

  runApp(
    ProviderScope(
      overrides: [
        localStoreProvider.overrideWithValue(local),
        pushServiceProvider.overrideWithValue(push),
      ],
      child: const CryptoTraderApp(),
    ),
  );
}

/// Exposed so the integration test + Settings screen can print the build target.
String get buildTargetSummary => 'backend=${AppConfig.apiBaseUrl} pins=${AppConfig.pinnedCertHashes.length} '
    'firebase=${AppConfig.hasFirebase} autoLogout=${AppConfig.autoLogoutSeconds}s';
