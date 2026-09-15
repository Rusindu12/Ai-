# Android APK Generator & Installation for AuraOS

AuraOS Ultra (Android + iOS + macOS Fusion) යනු ඕනෑම Android දුරකථනයක Native Launcher එකක් මෙන්ම Standalone App එකක් ලෙස ධාවනය වන පරිදි නිර්මාණය කරන ලද නවීන මෙහෙයුම් පද්ධති අතුරුමුහුණතකි.

---

## 📲 විකල්ප 1: APK බාගත කිරීමකින් තොරව තත්පර 5න් Phone එකට Install කරගැනීම (PWA Native App)

මෙය Android පද්ධතිය විසින්ම සපයන නිල **PWA (Progressive Web App)** තාක්ෂණයයි:
1. ඔබගේ Android Phone එකෙහි **Google Chrome** විවෘත කරන්න.
2. මෙම Live Preview සබැඳියට පිවිසෙන්න.
3. ඉහළ දකුණු කෙළවරේ ඇති තිත් 3 (Menu `⋮`) ඔබන්න.
4. **"Install app"** හෝ **"Add to Home screen"** ක්ලික් කරන්න.
5. ඔබගේ දුරකථනයේ Home Screen එකෙහි **AuraOS** නමින් Native App එකක් ලෙස ස්ථාපනය වේ! (එය සම්පූර්ණ Fullscreen ලෙස ක්‍රියාත්මක වේ).

---

## 🛠️ විකල්ප 2: Android Studio මගින් Direct `.apk` ගොනුවක් සකස් කරගැනීම (Official APK Source)

මෙම Repository එකෙහි සම්පූර්ණ Android Native Java/Gradle Project එක (`android-project`) ඇතුළත් කර ඇත.

### පියවර:
1. ඔබගේ පරිගණකයේ [Android Studio](https://developer.android.com/studio) ස්ථාපනය කරගන්න.
2. `Open Project` ක්ලික් කර මෙම repo එකෙහි ඇති `android-project` ෆෝල්ඩරය තෝරන්න.
3. Android Studio මගින් අවශ්‍ය Gradle dependencies ස්වයංක්‍රීයව download වනු ඇත.
4. ඉහළ මෙනුවේ **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)** ක්ලික් කරන්න.
5. තත්පර කිහිපයකින් `android-project/app/build/outputs/apk/debug/app-debug.apk` ගොනුව සෑදේ.
6. එම `.apk` ගොනුව ඔබගේ Phone එකට Copy කරගෙන Install (Sideload) කරගන්න!

---

## 🚀 Launcher එකක් ලෙස Default Set කිරීම:
- මෙම App එකෙහි `AndroidManifest.xml` තුළ `CATEGORY_HOME` අඩංගු කර ඇති බැවින්, Phone එකේ Settings > Default Apps > Home App වෙත ගොස් **AuraOS** තේරූ විට ඔබගේ Phone එක සම්පූර්ණ Android + iOS + macOS Fusion මෙහෙයුම් පද්ධතියක් බවට පත්වේ!
