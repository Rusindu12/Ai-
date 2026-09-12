import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../core/env.dart';

/// Firebase Cloud Messaging wiring.
///
/// Firebase is **optional**: if `firebase_options.dart` still holds the
/// placeholder values (or init fails), we log and carry on - the app keeps
/// receiving alerts over the WebSocket instead, which is the primary channel.
class PushService {
  PushService({FirebaseMessaging? messaging}) : _messaging = messaging;

  FirebaseMessaging? _messaging;
  final StreamController<RemoteMessage> _messages = StreamController<RemoteMessage>.broadcast();
  String? _token;
  bool _ready = false;
  String? _lastError;

  Stream<RemoteMessage> get messages => _messages.stream;
  String? get token => _token;
  bool get ready => _ready;
  String? get lastError => _lastError;

  Future<void> init() async {
    if (!AppConfig.hasFirebase) {
      _lastError = 'Firebase not configured (FIREBASE_PROJECT_ID empty) - using WebSocket alerts';
      return;
    }
    try {
      // No options argument: on Android the plugin reads android/app/google-services.json.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      _messaging ??= FirebaseMessaging.instance;
      await _messaging!.requestPermission(alert: true, badge: true, sound: true);
      _token = await _messaging!.getToken();
      _messaging!.onMessage.listen(_messages.add);
      _messaging!.onMessageOpenedApp.listen(_messages.add);
      _messaging!.onTokenRefresh.listen((t) => _token = t);
      await _messaging!.setForegroundNotificationPresentationOption(alert: true);
      _ready = true;
    } on Exception catch (e) {
      _lastError = 'Firebase init failed: $e (push disabled, WS alerts still work)';
      _ready = false;
    }
  }

  Future<void> deleteToken() async {
    try {
      await _messaging?.deleteToken();
    } on Exception {
      // ignore
    }
  }

  Future<String?> topic(String name, {bool subscribe = true}) async {
    try {
      if (subscribe) {
        await _messaging?.subscribeToTopic(name);
      } else {
        await _messaging?.unsubscribeFromTopic(name);
      }
    } on Exception catch (e) {
      return e.toString();
    }
    return null;
  }

  Future<void> dispose() async {
    await _messages.close();
  }
}
