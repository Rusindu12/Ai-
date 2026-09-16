package com.aitradingbot.modules

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * BiometricAuthModule
 * -------------------
 * Wraps androidx.biometric.BiometricPrompt (fingerprint / face / device
 * credential fallback) so the JS layer can gate app access behind the
 * user's biometrics.
 */
class BiometricAuthModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BiometricAuth"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    try {
      val manager = BiometricManager.from(reactContext.applicationContext)
      val result =
          manager.canAuthenticate(
              BiometricManager.Authenticators.BIOMETRIC_STRONG or
                  BiometricManager.Authenticators.DEVICE_CREDENTIAL)
      promise.resolve(result == BiometricManager.BIOMETRIC_SUCCESS)
    } catch (e: Exception) {
      promise.reject("E_BIOMETRIC_CHECK", e.message, e)
    }
  }

  @ReactMethod
  fun authenticate(title: String, subtitle: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity available for biometric prompt")
      return
    }
    activity.runOnUiThread {
      try {
        val fragmentActivity = activity as FragmentActivity
        val executor = ContextCompat.getMainExecutor(reactContext.applicationContext)
        val callback =
            object : BiometricPrompt.AuthenticationCallback() {
              override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                promise.resolve(true)
              }

              override fun onAuthenticationFailed() {
                // Prompt stays open; the user can retry. No-op here.
              }

              override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                // Cancelled / lockout / no biometrics enrolled — report as failure,
                // the JS layer decides the UX fallback.
                promise.resolve(false)
              }
            }
        val prompt = BiometricPrompt(fragmentActivity, executor, callback)
        val promptInfo =
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setConfirmationRequired(false)
                .setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build()
        prompt.authenticate(promptInfo)
      } catch (e: Exception) {
        promise.reject("E_BIOMETRIC_PROMPT", e.message, e)
      }
    }
  }
}
