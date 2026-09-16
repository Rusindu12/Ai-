# Dahat OS — the 19 apps

Everything below is written against the same public syscall surface a third-party
app gets (except the four system-diagnostic apps, which may read kernel modules
directly). "Honest limit" means the app says this out loud in its own UI — I
would rather ship a caveat than a fake capability.

| app | id | what it does | honest limit |
| --- | --- | --- | --- |
| Settings | `settings` | 11 pages: display, sound, network, apps, permissions, security, storage, battery, language, developer, about | changing another app's permissions resets it immediately, but cannot revoke an app already in memory mid-syscall |
| Files | `files` | the VFS with folders, create/rename/move/delete, a text editor, import from the host, download | 96 MiB quota; a photo imported from Android lives in the OS store, not in `/storage/emulated` |
| Notes | `notes` | markdown-ish notes with autosave, search, sort, tag-by-folder | no sync — by design |
| Terminal | `terminal` | real shell over the kernel: `ls`, `cat`, `df`, `dmesg`, `ps`, `kill`, `pm list`, `sys`, `caps`, pipes and redirection | the filesystem is the VFS, not Android's |
| System Monitor | `monitor` | process table, per-pid CPU from syscall accounting, frame clock, jank, syscall counters, dmesg, storage map | counters reset at boot (there is no /proc) |
| Bazaar | `bazaar` | package index with install/uninstall, download progress, permission summary, layout pin | the 8 installable apps are real code, but the index is local — no repo, no signing, no updates |
| Calculator | `calculator` | expression parser (no `eval`), scientific row, memory, history tape | trig is in degrees by default; toggle in the header |
| Clock | `clock` | alarms, stopwatch with laps, countdown, world clock, doze warning | in a browser it only rings while the tab is open; inside the APK `app.setAlarm` arms a real Android alarm with a full-screen intent, and the row says which path is holding it |
| Phone | `phone` | dial pad, `ACTION_DIAL` handoff, call log kept locally, speed dials | calls go through the Android dialer; Dahat holds no call/SMS/contact permission |
| Camera | `camera` | getUserMedia → canvas → `/sdcard/DCIM/*.jpg`, grid, flip, watermark, shutter haptics | photos land in the OS store's DCIM folder; no EXIF, no gallery provider entry |
| Gallery | `gallery` | scans the VFS for images, viewer with prev/next, delete, share, download, *set as wallpaper* | only shows what the OS can read; it will not enumerate Android's media store |
| Sahan (Assistant) | `assistant` | on-device intents: open app, note, find file, install, kill, alarm, run a syscall, dmesg, battery, storage, plus speech input | no account, no cloud, no memory of you; a chat model only appears if *you* configure an endpoint in Settings ▸ Developer |
| Tasks | `todo` | checkboxes, projects, due-today filter, swipe-to-delete, counts in the widget | local only |
| Converter | `converter` | length, mass, volume, area, speed, temperature, data, time, with live reciprocal | no currency (needs network) |
| Keerthi Synth | `piano` | WebAudio piano with sustain, waveform choice, master volume tied to the OS `volume` topic, wake lock while playing | single-voice-ish polyphony; no MIDI in/out |
| Voice Memo | `memo` | MediaRecorder → `/sdcard/Music/*.webm` + a JSON "take" note per recording | no cloud backup; the file lives in the OS store |
| Thala 2048 | `game2048` | swipe/arrow keyboard game, undo, best score in the app sandbox | high score is per-device |
| Snake | `snake` | canvas-free grid game with haptics and a speed curve | pauses when the window loses focus (the scheduler suspends it) |
| Sketchpad | `paint` | pointer drawing, brush size/colour, undo, save to DCIM or download | one layer; no selection tool |

## Shared behaviour

* Every app is bilingual (EN/සිංහල) and re-renders on language change.
* Every app that writes user data writes it through `ctx.api.fs` or
  `ctx.api.store`, so uninstall can actually delete it (`pm.clearData`).
* Bars, rows, switches, segmented controls, empty states and progress bars come
  from `apps/kit.js` — one place, so the OS looks like one OS.
* Haptics and sound go through `actuate(kind)`, which obeys the Settings toggles
  (and the volume slider, via the master gain in `ui/audio.js`).

## Adding your own

Copy the smallest one (`apps/converter.js`, ~90 lines), register it in
`apps/registry.js` + `kernel/packages.js`, then:

```bash
node tools/check.mjs && node tools/appsmoke.mjs myapp
```

`appsmoke` mounts the app, clicks every control it can find, fires keyboard and
pointer events, exercises resume/pause/back/destroy, and fails the app if it
leaks an interval or an animation frame.
