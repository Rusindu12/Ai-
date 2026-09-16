/* Dahat OS — kernel/packages.js
 * The package index: everything the OS ships plus the Bazaar catalogue.
 * A "package" is metadata only — code lives in js/apps and is loaded lazily.
 *
 * kind: system      — part of the OS, cannot be uninstalled
 *       preinstalled— ships on the home screen, uninstallable
 *       bazaar      — installable from Bazaar
 */
export const PKGS = [
  {
    id: 'settings', icon: 'settings', color: ['#5b6b80', '#232b36'], round: false, kind: 'system',
    entry: 'settings', version: '1.0.0', size: 148 * 1024, caps: ['settings', 'process', 'storage', 'notifications', 'clipboard'],
    name: { en: 'Settings', si: 'සැකසුම්' },
    desc: { en: 'Device, display, apps, security and developer options.', si: 'උපාංගය, තිරය, ඇප්, ආරක්ෂාව සහ සංවර්ධක විකල්ප.' },
    cat: 'System',
  },
  {
    id: 'files', icon: 'folder', color: ['#f2b134', '#7a4c07'], kind: 'system', entry: 'files', version: '1.0.0', size: 96 * 1024,
    caps: ['storage'], name: { en: 'Files', si: 'ගොනු' },
    desc: { en: 'Browse /sdcard, edit text, import and export.', si: '/sdcard ගොනු බලන්න, වචන සංස්කරණය කරන්න, ආයත/පිටතට යවන්න.' }, cat: 'System',
  },
  {
    id: 'notes', icon: 'notes', color: ['#12b7a2', '#065248'], kind: 'system', entry: 'notes', version: '1.0.0', size: 64 * 1024,
    caps: ['storage', 'notifications'], name: { en: 'Notes', si: 'සටහන්' },
    desc: { en: 'Fast markdown notes saved straight to the filesystem.', si: 'ගොනු පද්ධතියටම සුරකින ඉක්මන් සටහන්.' }, cat: 'Productivity',
  },
  {
    id: 'terminal', icon: 'terminal', color: ['#22303c', '#05090c'], kind: 'system', entry: 'terminal', version: '1.0.0', size: 88 * 1024,
    caps: ['storage', 'process', 'network', 'clipboard'], name: { en: 'Terminal', si: 'ටර්මිනලය' },
    desc: { en: 'A shell over the kernel: ls, ps, dmesg, pm, df…', si: 'කර්නලය මත ක්‍රියාත්මක ෂෙල් එකක්.' }, cat: 'Developer',
  },
  {
    id: 'calculator', icon: 'calculator', color: ['#8b7bff', '#2b2350'], kind: 'system', entry: 'calculator', version: '1.0.0', size: 40 * 1024,
    caps: ['clipboard'], name: { en: 'Calculator', si: 'ගණක යන්ත්‍රය' },
    desc: { en: 'Expression engine with history and units memory.', si: 'ඉතිහාසය සහිත ගණනය යන්ත්‍රයක්.' }, cat: 'Utilities',
  },
  {
    id: 'clock', icon: 'clock', color: ['#4cc4ff', '#0c3a54'], kind: 'system', entry: 'clock', version: '1.0.0', size: 52 * 1024,
    caps: ['notifications', 'vibrate', 'alarm'], name: { en: 'Clock', si: 'නාලිකාව' },
    desc: { en: 'Alarm, stopwatch, timer and world clock.', si: 'ඇලාරම්, වේග ඔරලෝසුව, ටයිමරය, ලෝක ඔරලෝසුව.' }, cat: 'Utilities',
  },
  {
    id: 'phone', icon: 'phone', color: ['#37c978', '#0a4a29'], kind: 'preinstalled', entry: 'phone', version: '1.0.0', size: 36 * 1024,
    caps: ['phone', 'clipboard'], name: { en: 'Phone', si: 'දුරකථනය' },
    desc: { en: 'Dial pad and call log. Calls hand off to the system dialer.', si: 'අංක ඵලකය සහ ඇමතුම් ලඝුපොත.' }, cat: 'Communication',
  },
  {
    id: 'camera', icon: 'camera', color: ['#ff7a59', '#5c1b0e'], kind: 'preinstalled', entry: 'camera', version: '1.0.0', size: 72 * 1024,
    caps: ['camera', 'storage'], name: { en: 'Camera', si: 'කැමරාව' },
    desc: { en: 'Capture to /sdcard/DCIM with a Dahat watermark mode.', si: 'ඡායාරූප /sdcard/DCIM වෙත සුරකින්න.' }, cat: 'Photography',
  },
  {
    id: 'gallery', icon: 'image', color: ['#ff5fa2', '#4b0f33'], kind: 'preinstalled', entry: 'gallery', version: '1.0.0', size: 44 * 1024,
    caps: ['storage'], name: { en: 'Gallery', si: 'ඡායාගාලරිය' },
    desc: { en: 'Everything in DCIM, with a fullscreen viewer.', si: 'DCIM හි සියලු රූප.' }, cat: 'Photography',
  },
  {
    id: 'monitor', icon: 'monitor', color: ['#f5626c', '#4d1119'], kind: 'system', entry: 'monitor', version: '1.0.0', size: 58 * 1024,
    caps: ['process', 'settings'], name: { en: 'System Monitor', si: 'පද්ධති නිරීක්ෂකය' },
    desc: { en: 'Live process table, syscall counters, kernel log.', si: 'ක්‍රියාවලීන්, syscall ගණන් කරන්නන්, කර්නල් ලඝුපොත.' }, cat: 'Developer',
  },
  {
    id: 'bazaar', icon: 'store', color: ['#b8e986', '#20450f'], kind: 'system', entry: 'bazaar', version: '1.0.0', size: 60 * 1024,
    caps: ['process', 'storage'], name: { en: 'Bazaar', si: 'බාසාරය' },
    desc: { en: 'Install and remove Dahat apps. No account needed.', si: 'Dahat ඇප් ස්ථාපනය/ඉවත් කිරීම.' }, cat: 'System',
  },
  {
    id: 'assistant', icon: 'assistant', color: ['#4cc4ff', '#8b7bff'], round: true, kind: 'system', entry: 'assistant', version: '1.0.0', size: 84 * 1024,
    caps: ['process', 'network', 'mic', 'notifications', 'storage', 'clipboard'], name: { en: 'Sahan', si: 'සහන්' },
    desc: { en: 'On-device assistant: open apps, write notes, run shell commands.', si: 'ඇප් විවෘත කිරීම, සටහන් ලිවීම, විධාන ධාවනය.' }, cat: 'System',
  },
  {
    id: 'todo', icon: 'todo', color: ['#12b7a2', '#0a3d38'], kind: 'bazaar', entry: 'todo', version: '1.2.0', size: 30 * 1024,
    caps: ['notifications', 'storage'], name: { en: 'Tasks', si: 'කාර්යයන්' },
    desc: { en: 'Today / Upcoming / Someday lists with due reminders.', si: 'අද / ඉදිරිය / සිදුවන දවසක — ලැයිස්තු තුනක්.' }, cat: 'Productivity',
    author: 'Dahat Labs',
  },
  {
    id: 'game2048', icon: 'game', color: ['#f2b134', '#8a5a06'], kind: 'bazaar', entry: 'game2048', version: '1.0.1', size: 34 * 1024,
    caps: [], name: { en: 'Thala 2048', si: 'තල 2048' },
    desc: { en: 'Swipe to merge tiles. Keyboard and touch.', si: 'ඉටි පැදුරු ඒකාබද්ධ කරන්න.' }, cat: 'Games', author: 'Dahat Labs',
  },
  {
    id: 'snake', icon: 'game', color: ['#37c978', '#0b3d24'], kind: 'bazaar', entry: 'snake', version: '1.0.0', size: 26 * 1024,
    caps: ['vibrate'], name: { en: 'Snake', si: 'සර්පයා' },
    desc: { en: 'The classic, running as a scheduled process.', si: 'සම්ප්‍රදායික සර්පයා.' }, cat: 'Games', author: 'Retro Port'
  },
  {
    id: 'paint', icon: 'paint', color: ['#ff5fa2', '#3b0d24'], kind: 'bazaar', entry: 'paint', version: '1.1.0', size: 42 * 1024,
    caps: ['storage'], name: { en: 'Sketchpad', si: 'සිතුවම්' },
    desc: { en: 'Finger painting, exports PNG straight to Gallery.', si: 'PNG ලෙස ගැලරියට යවන්න.' }, cat: 'Creativity', author: 'Dahat Labs'
  },
  {
    id: 'converter', icon: 'converter', color: ['#8b7bff', '#241d43'], kind: 'bazaar', entry: 'converter', version: '1.0.0', size: 28 * 1024,
    caps: [], name: { en: 'Converter', si: 'මාපක හුවමාරුව' },
    desc: { en: 'Length, mass, area, data, currency (manual rate).', si: 'දිග, ස්කන්ධය, වර්ගඵලය, දත්ත, මුදල්.' }, cat: 'Utilities', author: 'Dahat Labs'
  },
  {
    id: 'piano', icon: 'piano', color: ['#4cc4ff', '#08324a'], kind: 'bazaar', entry: 'piano', version: '1.0.0', size: 38 * 1024,
    caps: [], name: { en: 'Keerthi Synth', si: 'කීර්ති සින්ත් එක' },
    desc: { en: 'WebAudio synth with 4 waveforms and a recorder.', si: 'WebAudio සින්ත් එකක්.' }, cat: 'Music', author: 'Dahat Labs'
  },
  {
    id: 'memo', icon: 'mic', color: ['#f5626c', '#3d0d12'], kind: 'bazaar', entry: 'memo', version: '1.0.0', size: 33 * 1024,
    caps: ['mic', 'storage'], name: { en: 'Voice Memo', si: 'හඬ සටහන' },
    desc: { en: 'Record, name and keep memos in /sdcard/Music.', si: 'හඬ පටගෙන Music යට සුරකින්න.' }, cat: 'Utilities', author: 'Dahat Labs'
  },
];

export const byId = (id) => PKGS.find((p) => p.id === id);
export const ofKind = (k) => PKGS.filter((p) => p.kind === k);
export const CORE_IDS = PKGS.filter((p) => p.kind !== 'bazaar').map((p) => p.id);
export const nameOf = (p, lang = 'en') => (typeof p.name === 'string' ? p.name : p.name[lang] || p.name.en);
