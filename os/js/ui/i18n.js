/* Dahat OS — ui/i18n.js
 * Shell strings in English + සිංහල. Apps may also use bi() for inline
 * { en, si } objects, which keeps first-party apps short.
 */
import { config } from '../kernel/config.js';

export const LANGS = { en: 'English', si: 'සිංහල' };

const EN = {
  'app.settings': 'Settings', 'os.name': 'Dahat OS', 'os.tagline': 'clean by design',
  'boot.kernel': 'starting dahat kernel 1.0.0', 'boot.mount': 'mounting /sdcard (dahat-fs)',
  'boot.press': 'tap anywhere to continue',
  'home.search': 'Search apps, files and actions', 'home.allApps': 'All apps', 'home.close': 'Close',
  'home.addHome': 'Add to home screen', 'home.removeHome': 'Remove from home screen',
  'home.appInfo': 'App info', 'home.forceStop': 'Force stop', 'home uninstall': 'Uninstall',
  'lock.swipe': 'Swipe up to open', 'lock.enter': 'Enter PIN', 'lock.wrong': 'Wrong PIN — try again',
  'lock.emergency': 'Emergency call', 'lock.locked': 'Locked',
  'shade.edit': 'Edit tiles', 'shade.notifs': 'Notifications', 'notif.none': 'No notifications',
  'notif.clearAll': 'Clear all', 'notif.readAll': 'Mark all read',
  'qs.dnd': 'Focus', 'qs.dark': 'Dark', 'qs.wifi': 'Wi-Fi', 'qs.bt': 'Bluetooth',
  'qs.torch': 'Torch', 'qs.airplane': 'Airplane', 'qs.save': 'Power save', 'qs.doze': 'Doze',
  'qs.rotate': 'Auto-rotate', 'qs.cast': 'Cast', 'qs.haptics': 'Haptics', 'qs.sound': 'Sound',
  'perm.title': '{app} wants to', 'perm.allow': 'Allow', 'perm.deny': 'Deny', 'perm.body': 'You can change this any time in Settings → Apps.',
  'onb.welcome': 'Welcome to Dahat', 'onb.lang': 'Language', 'onb.langSub': 'You can change this later in Settings.',
  'onb.trust': 'Yours, not theirs', 'onb.trustSub': 'Apps ask for one capability at a time, in the foreground, and you can revoke it with two taps. No accounts, no analytics, no ad IDs.',
  'onb.pin': 'Set a screen PIN', 'onb.pinSkip': 'Not now', 'onb.pinSet': 'Use this PIN',
  'onb.done': 'Finish setup', 'onb.offline': 'Everything works offline', 'onb.offlineSub': 'Files, notes and settings live in this device’s storage layer.',
  'wm.recents': 'Recent', 'wm.pip': 'Picture in picture', 'wm.split': 'Split screen', 'wm.close': 'Close',
  'wm.clearAll': 'Clear all', 'wm.nWindows': (n) => n === 1 ? '1 app open' : `${n} apps open`,
  'err.perm': 'Permission denied by the kernel',
  'common.ok': 'OK', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.delete': 'Delete',
  'common.rename': 'Rename', 'common.share': 'Share', 'common.copy': 'Copy', 'common.close': 'Close',
  'common.done': 'Done', 'common.back': 'Back', 'common.retry': 'Try again', 'common.search': 'Search',
  'common.new': 'New', 'common.empty': 'Nothing here yet', 'common.yes': 'Yes', 'common.no': 'No',
  'common.install': 'Install', 'common.open': 'Open', 'common.uninstall': 'Uninstall',
  'common.granted': 'Allowed', 'common.denied': 'Denied', 'common.prompt': 'Ask next time',
};

const SI = {
  'os.name': 'දහත් OS', 'os.tagline': 'දහත්ව සිතන්න',
  'home.search': 'ඇප්, ගොනු සහ ක්‍රියා සොයන්න', 'home.allApps': 'සියලු ඇප්', 'home.close': 'වසන්න',
  'home.addHome': 'මුල් තිරයට එක් කරන්න', 'home.removeHome': 'මුල් තිරයෙන් ඉවත් කරන්න',
  'home.appInfo': 'ඇප් තොරතුරු', 'home.forceStop': 'බලෙන් නවත්වන්න',
  'lock.swipe': 'අරින්න', 'lock.enter': 'පින් අංකය', 'lock.wrong': 'පින් අංකය වැරදියි',
  'lock.emergency': 'හදිසි ඇමතුම', 'lock.locked': 'අගුළු දමා ඇත',
  'shade.edit': 'ටයිල් සංස්කරණය', 'shade.notifs': 'දැනුම්දීම්', 'notif.none': 'දැනුම්දීම් නැත',
  'notif.clearAll': 'සියල්ල මකන්න', 'notif.readAll': 'කියවූ ලෙස සලකුණු කරන්න',
  'qs.dnd': 'අවධානය', 'qs.dark': 'අඳුරු', 'qs.wifi': 'වායිෆයි', 'qs.bt': 'බ්ලූටූත්',
  'qs.torch': 'දීප්තිය', 'qs.airplane': 'ගුවන්', 'qs.save': 'බල ශක්චය', 'qs.doze': 'නිදාගැනීම',
  'qs.rotate': 'කැරකීම', 'qs.cast': 'කැස්ට්', 'qs.haptics': 'කම්පන', 'qs.sound': 'ශබ්දය',
  'perm.title': '{app} ඉල්ලා සිටින්නේ', 'perm.allow': 'අවසර දෙන්න', 'perm.deny': 'ප්‍රතික්ෂේප',
  'perm.body': 'සැකසුම් → ඇප් යටදී මෙය වෙනස් කළ හැක.',
  'onb.welcome': 'දහත් වෙත සාදරයෙන්', 'onb.lang': 'භාෂාව', 'onb.langSub': 'පසුව සැකසුම් වලින් වෙනස් කළ හැක.',
  'onb.trust': 'මෙය ඔබේ උපාංගයයි', 'onb.trustSub': 'ඇප්පක් එක වරකට එක් අයිතිවාසිකමක් පමණක් ඉල්ලයි. අවසරය ඕනෑම වේලාවක අහෝසි කළ හැක.',
  'onb.pin': 'තිර අගුළු පින් අංකයක්', 'onb.pinSkip': 'දැන් නැත', 'onb.pinSet': 'මෙම පින් අංකය යොදන්න',
  'onb.done': 'සම්පූර්ණ කරන්න', 'onb.offline': 'සියල්ල නොබැඳිව ක්‍රියා කරයි',
  'onb.offlineSub': 'ඔබේ ගොනු, සටහන් සහ සැකසුම් මෙම උපාංගයේම රැඳේ.',
  'wm.recents': 'මෑත', 'wm.pip': 'පින්තූරය තුළ පින්තූරය', 'wm.split': 'තිර බෙදීම', 'wm.close': 'වසන්න',
  'wm.clearAll': 'සියල්ල වසන්න',
  'err.perm': 'කර්නලය විසින් අවසරය ප්‍රතික්ෂේප කෙරිණි',
  'common.ok': 'හරි', 'common.cancel': 'අවලංගු', 'common.save': 'සුරකින්න', 'common.delete': 'මකන්න',
  'common.rename': 'නම වෙනස්', 'common.share': 'බෙදාගන්න', 'common.copy': 'පිටපත්', 'common.close': 'වසන්න',
  'common.done': 'අවසාන', 'common.back': 'ආපසු', 'common.retry': 'නැවත උත්සාහ', 'common.search': 'සොයන්න',
  'common.new': 'නව', 'common.empty': 'තවම කිසිවක් නැත', 'common.yes': 'ඔව්', 'common.no': 'නෑ',
  'common.install': 'ස්ථාපනය', 'common.open': 'විවෘත කරන්න', 'common.uninstall': 'ඉවත් කරන්න',
  'common.granted': 'අවසර ලත්', 'common.denied': 'ප්‍රතික්ෂේපිත', 'common.prompt': 'ඊළඟ වරට අසන්න',
};

const DICT = { en: EN, si: SI };
const extra = { en: {}, si: {} };

export const i18n = {
  get lang() { return config.get('ui.lang') || 'en'; },
  set lang(l) { config.set('ui.lang', DICT[l] ? l : 'en'); },
  /** register app-local strings: i18n.extend({ si: {...}, en: {...} }) */
  extend(patch) {
    for (const [l, map] of Object.entries(patch || {})) {
      if (!extra[l]) extra[l] = {};
      Object.assign(extra[l], map);
    }
  },
  t(key, vars) {
    const l = this.lang;
    let s = extra[l]?.[key] ?? DICT[l]?.[key] ?? extra.en?.[key] ?? DICT.en[key] ?? key;
    if (typeof s === 'function') s = s(vars?.n ?? vars);
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    return s;
  },
  /** inline bilingual value */
  bi(obj) {
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    return obj[this.lang] ?? obj.en ?? Object.values(obj)[0] ?? '';
  },
  get isSi() { return this.lang === 'si'; },
};
export const t = (k, v) => i18n.t(k, v);
export const bi = (o) => i18n.bi(o);
