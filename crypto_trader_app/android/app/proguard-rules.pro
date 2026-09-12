# ---- Flutter ----
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class com.dexterous.** { *; }          # flutter_secure_storage

# ---- Flutter plugin registration (reflective) ----
-keep class * extends io.flutter.plugin.common.MethodChannel$MethodCallHandler
-keep class com.ai.cryptotrader.MainActivity { *; }

# ---- Firebase Auth / Google sign-in ----
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class com.google.android.gms.tasks.** { *; }
-keep class com.google.android.gms.fido.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# ---- OkHttp / Play Services optional deps ----
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn org.jetbrains.annotations.**

# ---- Kotlin coroutines ----
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**

# ---- Enum / ModelBean safety for JSON round-tripping ----
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclassmembers enum * { public static **[] values(); public static ** valueOf(java.lang.String); }

# ---- Strip logs in release (keeps symbols + sizes down) ----
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
