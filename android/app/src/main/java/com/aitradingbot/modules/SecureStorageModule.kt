package com.aitradingbot.modules

import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.SecureRandom

/**
 * SecureStorageModule
 * -------------------
 * Encrypted local persistence backed by the Android Keystore.
 *
 * Values are written to EncryptedSharedPreferences which encrypts
 *  - keys   with AES256-SIV (deterministic, Keystore-wrapped master key)
 *  - values with AES256-GCM (256-bit AEAD)
 *
 * The master key itself never leaves the hardware-backed Android Keystore,
 * so credentials at rest are protected by AES-256 encryption on two layers
 * (the JS layer adds a further AES-256 envelope before calling setItem).
 */
class SecureStorageModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SecureStorage"

  private val prefs: SharedPreferences by lazy {
    val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
    EncryptedSharedPreferences.create(
        "aitb_secure_store",
        masterKeyAlias,
        reactContext.applicationContext,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  }

  @ReactMethod
  fun setItem(key: String, value: String, promise: Promise) {
    try {
      prefs.edit().putString(key, value).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_SECURE_SET", e.message, e)
    }
  }

  @ReactMethod
  fun getItem(key: String, promise: Promise) {
    try {
      promise.resolve(prefs.getString(key, null))
    } catch (e: Exception) {
      promise.reject("E_SECURE_GET", e.message, e)
    }
  }

  @ReactMethod
  fun hasItem(key: String, promise: Promise) {
    try {
      promise.resolve(prefs.contains(key))
    } catch (e: Exception) {
      promise.reject("E_SECURE_HAS", e.message, e)
    }
  }

  @ReactMethod
  fun removeItem(key: String, promise: Promise) {
    try {
      prefs.edit().remove(key).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_SECURE_REMOVE", e.message, e)
    }
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      prefs.edit().clear().apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("E_SECURE_CLEAR", e.message, e)
    }
  }

  /** Cryptographically secure random hex string (java.security.SecureRandom). */
  @ReactMethod
  fun randomHex(byteLength: Int, promise: Promise) {
    try {
      val bytes = ByteArray(if (byteLength in 8..128) byteLength else 32)
      SecureRandom().nextBytes(bytes)
      promise.resolve(bytes.joinToString("") { "%02x".format(it) })
    } catch (e: Exception) {
      promise.reject("E_SECURE_RANDOM", e.message, e)
    }
  }
}
