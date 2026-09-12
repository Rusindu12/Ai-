import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/env.dart';
import '../core/logger.dart';
import '../core/storage.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/backend_api.dart';
import '../services/binance_key_vault.dart';
import '../services/biometric_service.dart';
import '../services/trade_auth_gate.dart';
import '../services/push_service.dart';
import '../services/websocket_service.dart';

/// ---------------------------------------------------------------------------
/// Dependency graph (Riverpod).
///
/// `authServiceProvider` is deliberately *lazy* about the API it calls, because
/// `ApiClient` needs the auth service for its token callbacks - the factory
/// breaks that cycle without a second HTTP client.
/// ---------------------------------------------------------------------------

/// Overridden in `main()` once SharedPreferences has been awaited.
final localStoreProvider = Provider<LocalStore>((ref) {
  throw UnimplementedError('localStoreProvider must be overridden in main()');
});

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final pushServiceProvider = Provider<PushService>((ref) {
  final service = PushService();
  ref.onDispose(service.dispose);
  return service;
});

final biometricProvider = Provider<BiometricService>((ref) => BiometricService());

final authServiceProvider = Provider<AuthService>((ref) {
  final service = AuthService(
    apiFactory: () => ref.read(backendApiProvider),
    secure: ref.read(secureStoreProvider),
    local: ref.read(localStoreProvider),
    onSessionExpired: () async {
      // The socket must stop the moment the JWT is gone.
      if (ref.exists(realtimeProvider)) {
        ref.read(realtimeProvider).stop();
      }
    },
  );
  ref.onDispose(service.dispose);
  return service;
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final auth = ref.watch(authServiceProvider);
  final secure = ref.watch(secureStoreProvider);
  final client = ApiClient(
    baseUrl: AppConfig.restRoot,
    tokenProvider: auth.currentToken,
    refreshProvider: auth.rotateTokens,
    onTokensRefreshed: (access, refresh) => secure.saveSession(access: access, refresh: refresh),
    onSessionExpired: auth.logout,
    deviceIdProvider: auth.deviceId,
    timeout: const Duration(seconds: 25),
  );
  ref.onDispose(client.close);
  return client;
});

final backendApiProvider = Provider<BackendApi>((ref) => BackendApi(ref.watch(apiClientProvider)));

final keyVaultProvider = Provider<BinanceKeyVault>((ref) => BinanceKeyVault(ref.watch(backendApiProvider)));

final realtimeProvider = Provider<RealtimeService>((ref) {
  final service = RealtimeService(
    tokenProvider: () async => ref.read(authServiceProvider).currentToken(),
    onAuthFailed: () async => ref.read(authServiceProvider).lock(),
  );
  if (ref.read(authServiceProvider).isSignedIn) service.start();
  ref.onDispose(() {
    service.stop();
    service.dispose();
  });
  return service;
});

/// Ring buffer of app events, surfaced in Settings -> Diagnostics and mirrored to
/// the backend audit log for anything trade/security related.
final logProvider = Provider<AppLog>((ref) => AppLog());

/// Biometric (+ optional 2FA) confirmation before any order is sent.
final tradeAuthGateProvider = Provider<Future<bool> Function({required String reason})>((ref) {
  final gate = TradeAuthGate(
    biometrics: ref.watch(biometricProvider),
    api: ref.watch(backendApiProvider),
    auth: ref.watch(authServiceProvider),
    secure: ref.watch(secureStoreProvider),
    log: ref.watch(logProvider),
  );
  return ({required String reason}) => gate.confirm(reason: reason);
});
