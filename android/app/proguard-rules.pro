# The Java side of Dahat OS is small and reflective only in one place:
# WebView calls @JavascriptInterface methods by name, so keep them.
-keepclassmembers class com.dahatos.launcher.DahatBridge {
  @android.webkit.JavascriptInterface <methods>;
}
-keep class com.dahatos.launcher.AlarmReceiver { *; }
