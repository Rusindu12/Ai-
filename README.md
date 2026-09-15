# AuraOS (Next-Gen Mobile OS Experience & Custom Launcher APK)

AuraOS යනු ඔබගේ සාමාන්‍ය Android අත්දැකීම සම්පූර්ණයෙන්ම වෙනස් කර නවීන Futuristic OS එකක හැඩය, අතුරුමුහුණත (UI), විශේෂාංග සහ Shell Terminal එක්ක නිමවා ඇති Custom Mobile OS & Launcher ව්‍යාපෘතියකි.

---

## 📱 විශේෂාංග (Features)

1. **Futuristic Dynamic OS Interface**:
   - Dynamic Island Notification bar (Music & System alerts).
   - Smart Clock & Live Weather widget.
   - Gesture Pill Navigation.

2. **Built-in Micro Apps**:
   - ⚡ **Aura Terminal / Shell**: Kernel status, commands (`help`, `status`, `fetch`, etc.).
   - 🧠 **Aura Neural Assistant**: Built-in Sinhala/English conversational AI.
   - ⚙️ **OS Settings**: Wi-Fi, Bluetooth, Performance Mode, Dark Theme toggles.
   - 🛍️ **Aura App Hub**: Custom store for system add-ons.
   - 🎧 **Music Player**: Audio player with spatial synthesizer mockup.

---

## 📲 දුරකථනයට Install කරගන්නේ කෙසේද? (2 Methods)

### ක්‍රමය 1: PWA (1-Click Install - පහසුම ක්‍රමය)
1. ඔබගේ Android දුරකථනයේ **Google Chrome** හරහා මෙම Live Preview ලින්ක් එක විවෘත කරන්න.
2. Chrome ඉහළ දකුණු කෙළවරේ ඇති තිත් 3 (Menu ⋮) ඔබන්න.
3. **"Install app"** හෝ **"Add to Home screen"** තෝරන්න.
4. දැන් ඔබගේ Phone Home Screen එකට AuraOS Native App එකක් ලෙස ස්ථාපනය වේ!

---

### ක්‍රමය 2: Standalone Android APK (.apk) එකක් Build කරගැනීම

ඔබට මෙය **සම්පූර්ණ Android Launcher APK එකක්** ලෙස compile කරගැනීමට අවශ්‍ය නම්:

1. **Android Studio** විවෘත කරන්න.
2. **New Project** -> **Empty Views Activity** තෝරන්න.
3. `AndroidManifest.xml` ගොනුවට පහත Launcher Intent Filter එක්කරන්න:
   ```xml
   <intent-filter>
       <action android:name="android.intent.action.MAIN" />
       <category android:name="android.intent.category.HOME" />
       <category android:name="android.intent.category.DEFAULT" />
   </intent-filter>
   ```
4. `MainActivity` එක තුළ Fullscreen WebView එකකින් AuraOS asset load කරන්න:
   ```java
   webView.getSettings().setJavaScriptEnabled(true);
   webView.getSettings().setDomStorageEnabled(true);
   webView.loadUrl("file:///android_asset/index.html");
   ```
5. **Build > Build Bundle(s) / APK(s) > Build APK(s)** ක්ලික් කරන්න.
6. සෑදුණු `app-debug.apk` ගොනුව ඔබගේ Phone එකට දමා Install කරගන්න!

---

## 💻 Local සංවර්ධනය (Run Locally)

```bash
cd src
npm install
node server.js
```
බ්‍රවුසරයෙන් `http://localhost:3000` වෙත යන්න.
