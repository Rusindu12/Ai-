import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

/// Fingerprint / face / device-credential gate.
///
/// Used twice: to unlock the app after the idle timeout, and immediately before
/// an order is sent (the backend also requires a fresh `X-Biometric-Session` for
/// live orders, so this is defence in depth, not theatre).
class BiometricService {
  BiometricService({LocalAuthentication? auth}) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  Future<bool> get deviceSupportsBiometrics async {
    try {
      if (!await _auth.canCheckBiometrics) return false;
      final kinds = await _auth.getAvailableBiometrics();
      return kinds.isNotEmpty;
    } on PlatformException {
      return false;
    } on Exception {
      return false;
    }
  }

  Future<BiometricOutcome> authenticate({String reason = 'Confirm your identity'}) async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: false, // allow PIN/pattern fallback
        stickyAuth: true,
        persistent: false,
      );
      return ok ? const BiometricOutcome.success() : const BiometricOutcome.cancelled();
    } on PlatformException catch (e) {
      if (e.code == auth_error.notAvailable || e.code == auth_error.notEnrolled || e.code == auth_error.passcodeNotSet) {
        return BiometricOutcome.unavailable(e.code);
      }
      if (e.code == auth_error.lockedOut || e.code == auth_error.permanentlyLockedOut) {
        return const BiometricOutcome.lockedOut();
      }
      return BiometricOutcome.failed(e.message ?? e.code);
    } on Exception catch (e) {
      return BiometricOutcome.failed(e.toString());
    }
  }
}

class BiometricOutcome {
  const BiometricOutcome.success()
      : status = BiometricStatus.success,
        message = null;
  const BiometricOutcome.cancelled()
      : status = BiometricStatus.cancelled,
        message = null;
  const BiometricOutcome.lockedOut()
      : status = BiometricStatus.lockedOut,
        message = 'Too many attempts - use your device PIN later';
  const BiometricOutcome.unavailable(this.message)
      : status = BiometricStatus.unavailable;
  const BiometricOutcome.failed(this.message)
      : status = BiometricStatus.failed;

  final BiometricStatus status;
  final String? message;

  bool get granted => status == BiometricStatus.success;

  /// No biometric hardware must not lock a user out of paper trading.
  bool get allowFallback => status == BiometricStatus.unavailable;
}

enum BiometricStatus { success, cancelled, unavailable, lockedOut, failed }
