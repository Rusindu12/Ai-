# AuraOS Android APK Build & Download Guide

මෙම Repository එකෙහි AuraOS Ultra සඳහා අවශ්‍ය **සම්පූර්ණ Android Native APK Project** එක (`android-project`) සාදා සකස් කර ඇත.

---

## 🚀 ක්‍රමය 1: දුරකථනයට කෙළින්ම App එකක් ලෙස Install කරගැනීම (PWA Method - 10 Seconds)
ඔබගේ දුරකථනයට කිසිදු පරිගණකයක් හෝ Build tools නොමැතිව ක්ෂණිකව Native App එකක් ලෙස දමා ගැනීමට:
1. Android දුරකථනයේ **Google Chrome** හරහා මෙම Live Preview සබැඳිය විවෘත කරන්න.
2. Chrome මෙනුව (ඉහළ දකුණු කෙළවරේ තිත් 3 `⋮`) ඔබන්න.
3. **"Install app"** හෝ **"Add to Home screen"** ක්ලික් කරන්න.
4. තත්පර 5කින් ඔබගේ Android Phone එකේ Home Screen එකට AuraOS App එක ස්ථාපනය වේ!

---

## 📦 ක්‍රමය 2: GitHub Actions මගින් නොමිලේ APK එකක් (.apk) Download කරගැනීම
මෙම repo එකෙහි `.github/workflows/build-apk.yml` file එක සකස් කර ඇත.
1. ඔබගේ GitHub repo එකේ **Actions** ටැබ් එකට යන්න.
2. **Build AuraOS Android APK** workflow එක තෝරන්න.
3. **Run workflow** ක්ලික් කරන්න.
4. මිනිත්තු 2කින් GitHub මගින් සෑදූ **`AuraOS-Launcher-Debug-APK`** ගොනුව (Direct .apk) නොමිලේ Download කරගත හැක!

---

## 💻 ක්‍රමය 3: Android Studio මගින් APK එක සාදා ගැනීම (Offline / Local)
1. පරිගණකයේ **Android Studio** විවෘත කර `Open Project` මගින් `android-project` ෆෝල්ඩරය තෝරන්න.
2. ඉහළ මෙනුවේ **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)** ක්ලික් කරන්න.
3. සෑදුණු `app/build/outputs/apk/debug/app-debug.apk` ගොනුව ඔබගේ Android Phone එකට දමා Install කරන්න.
