package com.ai.cryptotrader

import android.os.Build
import android.view.WindowManager
import androidx.annotation.NonNull
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Android entry point.
 *
 * Extends [FlutterFragmentActivity] (not FlutterActivity) because the
 * `local_auth` plugin needs a FragmentActivity to display the AndroidX
 * BiometricPrompt used for "unlock the app" and "confirm this trade".
 */
class MainActivity : FlutterFragmentActivity() {

    override fun configureFlutterEngine(@NonNull flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                // Surfaced in the backend audit log and used to decide whether to
                // demand a Play Integrity token for sensitive calls.
                "deviceInfo" -> result.success(
                    mapOf(
                        "model" to Build.MODEL,
                        "manufacturer" to Build.MANUFACTURER,
                        "brand" to Build.BRAND,
                        "osVersion" to Build.VERSION.RELEASE,
                        "sdkInt" to Build.VERSION.SDK_INT,
                        "isEmulator" to (
                            Build.FINGERPRINT.startsWith("generic") ||
                                Build.FINGERPRINT.contains("vbox") ||
                                Build.MODEL.contains("google_sdk") ||
                                Build.MODEL.contains("Emulator") ||
                                Build.PRODUCT == "sdk"
                            ),
                    ),
                )

                // Screen capture prevention while a trade panel is open.
                "setSecureScreen" -> {
                    val secure = call.argument<Boolean>("secure") ?: true
                    if (secure) {
                        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                    result.success(true)
                }

                else -> result.notImplemented()
            }
        }
    }

    companion object {
        private const val CHANNEL = "com.ai.cryptotrader/platform"
    }
}
