import 'package:firebase_auth/firebase_auth.dart' as fb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../core/env.dart';

/// Google sign-in through Firebase.
///
/// The app ends up holding a Firebase ID token which it trades for **our** JWT
/// at `POST /api/auth/firebase` (or `/api/auth/google`). Backend stays the single
/// source of truth for authorisation, Firebase is just an identity provider.
class FirebaseAuthBridge {
  FirebaseAuthBridge({fb.FirebaseAuth? auth, GoogleSignIn? google})
      : _auth = auth ?? fb.FirebaseAuth.instance,
        _google = google ??
            GoogleSignIn(
              // Required when the backend verifies the Google id token itself.
              serverClientId: AppConfig.googleClientId.isEmpty ? null : AppConfig.googleClientId,
            );

  final fb.FirebaseAuth _auth;
  final GoogleSignIn _google;

  bool get signedIn => _auth.currentUser != null;
  String? get uid => _auth.currentUser?.uid;

  Future<fb.User?> signInWithGoogle() async {
    final account = await _google.signIn();
    if (account == null) return null;
    final authentication = await account.authentication;
    final idToken = authentication.idToken;
    if (idToken == null) {
      throw StateError('Google returned no id token (check the SHA-1 fingerprint in Firebase)');
    }
    final credential = fb.GoogleAuthProvider.credential(idToken: idToken, accessToken: authentication.accessToken);
    final result = await _auth.signInWithCredential(credential);
    return result.user;
  }

  /// Anonymous sign-in is handy for demos and for receiving FCM before signup.
  Future<fb.User?> signInAnonymously() async {
    final result = await _auth.signInAnonymously();
    return result.user;
  }

  Future<void> signOut() async {
    try {
      await _google.signOut();
    } on Exception {
      // ignore
    }
    try {
      await _auth.signOut();
    } on Exception {
      // ignore
    }
  }
}

final firebaseAuthProvider = Provider<FirebaseAuthBridge>((ref) => FirebaseAuthBridge());
