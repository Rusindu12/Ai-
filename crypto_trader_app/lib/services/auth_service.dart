import 'dart:async';

import '../core/errors.dart';
import '../core/storage.dart';
import '../models/app_user.dart';
import 'api_client.dart';
import 'backend_api.dart';

/// Owns the session: who is signed in, the JWT pair, silent refresh, and the
/// 15-minute idle lock that the security spec requires.
///
/// Refresh tokens are rotated by the backend on every use, so the newest pair is
/// always written back to the encrypted store here.
class AuthService {
  AuthService({
    required BackendApi Function() apiFactory,
    required SecureStore secure,
    required LocalStore local,
    this.onSessionExpired,
  })  : _apiFactory = apiFactory,
        _secure = secure,
        _local = local {
    _idleTimer = Timer.periodic(const Duration(minutes: 1), (_) => _checkIdle());
  }

  // Resolved lazily: ApiClient needs this service for its token callbacks, and
  // this service needs ApiClient for its calls. A factory breaks that cycle.
  final BackendApi Function() _apiFactory;
  late final BackendApi _api = _apiFactory();
  final SecureStore _secure;
  final LocalStore _local;
  final Future<void> Function()? onSessionExpired;

  final StreamController<AuthState> _controller = StreamController<AuthState>.broadcast();
  Timer? _idleTimer;
  AppUser? _user;
  String? _accessToken;
  bool _locked = false;
  bool _restored = false;
  String? _deviceId;

  Stream<AuthState> get changes => _controller.stream;
  AppUser? get user => _user;
  bool get isSignedIn => _accessToken != null && _accessToken!.isNotEmpty && !_locked;
  bool get isLocked => _locked;
  bool get restored => _restored;
  String? get accessToken => _accessToken;
  int get userId => _user?.id ?? 0;

  Future<String> deviceId() async => _deviceId ??= await _secure.deviceId();

  /// Called from the ApiClient when a 401 happened: rotate once.
  Future<List<String>?> rotateTokens() async {
    final refresh = await _secure.refreshToken;
    if (refresh == null || refresh.isEmpty) return null;
    try {
      final pair = await _api.refreshSession(refresh, deviceId: await deviceId());
      await _secure.saveSession(access: pair.accessToken, refresh: pair.refreshToken);
      _accessToken = pair.accessToken;
      return [pair.accessToken, pair.refreshToken];
    } on AppException catch (e) {
      if (e.isAuth) {
        await _expire();
      }
      return null;
    }
  }

  Future<String?> currentToken() async => _accessToken ??= await _secure.accessToken;

  /// Bootstrap: restore a stored session, then verify it against /auth/me.
  Future<AuthState> restore() async {
    _restored = true;
    final token = await _secure.accessToken;
    if (token == null || token.isEmpty) {
      _emit();
      return AuthState(
        status: AuthStatus.signedOut,
        savedEmail: await _secure.savedEmail,
      );
    }
    _accessToken = token;
    try {
      _user = await _api.me();
      await _local.setLastUserId(_user!.id);
      _emit();
      return AuthState(status: AuthStatus.signedIn, user: _user, savedEmail: _user?.email);
    } on AppException catch (e) {
      if (e.isAuth) {
        final rotated = await rotateTokens();
        if (rotated != null) {
          _user = await _api.me();
          _emit();
          return AuthState(status: AuthStatus.signedIn, user: _user, savedEmail: _user?.email);
        }
        await _expire();
      }
      _emit();
      return AuthState(status: AuthStatus.signedOut, savedEmail: await _secure.savedEmail, error: e.message);
    } on Exception catch (e) {
      // Offline start: keep the token, the app will retry in the background.
      _emit();
      return AuthState(status: AuthStatus.signedIn, user: _user, savedEmail: _user?.email, error: e.toString());
    }
  }

  Future<AppUser> emailLogin({required String email, required String password, String? totpCode}) async {
    final session = await _api.login(email: email, password: password, totpCode: totpCode, deviceId: await deviceId());
    await _adopt(session);
    return session.user;
  }

  Future<AppUser> register({required String email, required String password, required String name}) async {
    final session = await _api.signup(email: email, password: password, name: name, deviceId: await deviceId());
    await _adopt(session);
    return session.user;
  }

  Future<AppUser> googleLogin(String idToken) async {
    final session = await _api.loginWithGoogle(idToken: idToken, deviceId: await deviceId());
    await _adopt(session);
    return session.user;
  }

  Future<AppUser> firebaseLogin(String firebaseToken, {String? fcmToken}) async {
    final session = await _api.loginWithFirebase(
      firebaseToken: firebaseToken,
      fcmToken: fcmToken,
      deviceId: await deviceId(),
    );
    await _adopt(session);
    return session.user;
  }

  /// Fast path after a successful biometric prompt.
  Future<bool> biometricUnlock() async {
    final id = _user?.id ?? _local.lastUserId;
    if (id == null || id == 0) return false;
    try {
      final pair = await _api.biometricUnlock(userId: id, deviceId: await deviceId());
      await _secure.saveSession(access: pair.accessToken, refresh: pair.refreshToken);
      _accessToken = pair.accessToken;
      _locked = false;
      _user = await _api.me();
      _local.touch();
      _emit();
      return true;
    } on AppException {
      await _secure.clearSession();
      _accessToken = null;
      _emit();
      return false;
    }
  }

  Future<void> _adopt(Session session) async {
    await _secure.saveSession(
      access: session.tokens.accessToken,
      refresh: session.tokens.refreshToken,
      email: session.user.email,
    );
    _accessToken = session.tokens.accessToken;
    _user = session.user;
    _locked = false;
    await _local.setLastUserId(session.user.id);
    await _local.touch();
    _emit();
  }

  Future<void> logout() async {
    final refresh = await _secure.refreshToken;
    try {
      await _api.logout(refreshToken: refresh);
    } on Exception {
      // Best effort - the local session is dropped either way.
    }
    _accessToken = null;
    _user = null;
    await _secure.clearSession();
    await _local.clearLastUserId();
    _emit();
  }

  Future<void> logoutEverywhere() async {
    try {
      await _api.logoutEverywhere();
    } on Exception {
      // ignore
    }
    await logout();
  }

  void lock() {
    if (_accessToken == null) return;
    _locked = true;
    _emit();
  }

  void noteActivity() {
    _local.touch();
  }

  void _checkIdle() {
    if (_locked || _accessToken == null) return;
    final limit = const Duration(minutes: 15);
    final last = _local.lastSeenAt;
    if (last != null && DateTime.now().difference(last) > limit) {
      lock();
    }
  }

  Future<void> _expire() async {
    _accessToken = null;
    _user = null;
    await _secure.clearSession();
    _emit();
    await onSessionExpired?.call();
  }

  void _emit() {
    if (_controller.isClosed) return;
    _controller.add(AuthState(
      status: _accessToken == null
          ? AuthStatus.signedOut
          : _locked
              ? AuthStatus.locked
              : AuthStatus.signedIn,
      user: _user,
      savedEmail: _user?.email,
    ));
  }

  Future<void> dispose() async {
    _idleTimer?.cancel();
    await _controller.close();
  }
}

enum AuthStatus { signedOut, signedIn, locked }

class AuthState {
  const AuthState({required this.status, this.user, this.savedEmail, this.error});
  final AuthStatus status;
  final AppUser? user;
  final String? savedEmail;
  final String? error;

  bool get signedIn => status == AuthStatus.signedIn;
  bool get locked => status == AuthStatus.locked;
}
