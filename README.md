# Dahat OS · දහත් OS

A mobile operating system environment — boot sequence, lock screen, launcher,
window manager, userspace kernel (VFS, IPC bus, capability permissions, process
scheduler, packages), 19 apps, bilingual English/සිංහල — written as plain ES
modules with no build step, **and shipped as a real installable Android `.apk`**
that can become your home screen.

දහත් (*dahat*) = pure, clean. The rule for the whole project: nothing you see in
the UI is fake, and anything the OS cannot do is said out loud in the app that
tries to do it.

```bash
# run it as a web OS (any static server — no npm install, no bundler)
cd os && python3 -m http.server 8130 --bind 0.0.0.0     # → http://localhost:8130/
```

Then, in Chrome on the phone: menu ▸ **Install app**. With a service worker,
localStorage and the Wake Lock API it behaves like an installed OS — offline
after first load, including the Sinhala fonts.

## The APK

```
CI builds it: Actions ▸ "build Dahat OS" ▸ Run workflow
artefacts:   DahatOS.apk · DahatOS-debug.apk · DahatOS.aab · CHECKSUMS.txt
install:     adb install -r DahatOS.apk
then:        press Home ▸ pick "Dahat OS" ▸ Always
```

`android/` holds the host: one activity, one WebView served from the APK's own
assets (no network, no server), plus a deliberately small `DahatBridge` so the OS
can reach battery, haptics, notifications, share sheet, dialer, wallpaper, screen
wake-lock and — through `AlarmManager` — alarms that still fire when the OS is
closed. `os/` is mirrored into the APK at build time by a Gradle task, so the
launcher can never ship a stale OS and the repo never stores the code twice.

Full details, the bridge table and signing notes: [`docs/android-launcher.md`](docs/android-launcher.md).

## Tests

```bash
node tools/check.mjs       # every module parses, every relative import resolves
node tools/selftest.mjs    # 36 kernel cases + a sweep of all 57 syscalls
node tools/appsmoke.mjs    # every app mounted, every control clicked, unmounted
node tools/syscall-doc.mjs # regenerate docs/kernel-api.md's syscall table
```

`tools/appsmoke.mjs` runs the real UI code in a headless DOM stub
(`tools/domstub.mjs`): it mounts each app, clicks every button/row/switch it can
find, fires keyboard, pointer and touch events, walks the lifecycle
(`onCreate → onResume → onParams → onResize → onPause → onBack → destroy`) and
fails an app that leaks an interval or an animation frame. Both languages are
exercised (en + si). No browser is needed and no test mocks the kernel.

## Layout

```
os/index.html            #device > #screen > #wallpaper + #layers
os/js/kernel/            storage log caps bus vfs packages pm sched notify power config syscalls api
os/js/shell/             boot theme dialogs statusbar shade wm launcher lock onboarding heads-up main
os/js/apps/              registry kit + 19 apps (settings files notes terminal monitor bazaar …)
os/js/ui/                dom.js (hyperscript, icons) · i18n.js · audio.js (synthesised UI sound)
os/styles/               one token file + one component file; Noto Sans Sinhala bundled
android/                 launcher APK (Gradle sources; CI builds and signs)
docs/                    architecture · kernel-api · permissions · apps · android-launcher · roadmap-real-os
tools/                   the four tests above + icon generator
```

Read in this order: [`docs/architecture.md`](docs/architecture.md) →
[`docs/kernel-api.md`](docs/kernel-api.md) →
[`docs/permissions.md`](docs/permissions.md) →
[`docs/apps.md`](docs/apps.md).

## Three things that are design decisions, not accidents

* **One entry point for every app privilege.** Apps do not import kernel modules;
  they call `bus.call(name, args, ctx)` through a generated facade, and the
  capability check sits inside that choke point. A denial throws `EACCES`, is
  cached, and is audited to `dmesg`.
* **The filesystem is jailed by path.** `/apps/<you>` is private, `/tmp` is
  scratch, `/sdcard/**` needs the `storage` capability, `/system` is read-only
  *even for OS-signed apps*, and one 96 MiB quota is enforced at write time.
* **Processes get a frame budget.** The scheduler charges syscall time to the
  calling pid, suspends background windows and marks a process that misses five
  seconds of heartbeats `unresponsive` — which is exactly what the switcher's
  "Force stop" and the Monitor's red row act on.

## What this is not

Not an AOSP fork. There is no kernel, no HAL, no RIL, no verified-boot chain and
no device tree here: Android still runs underneath, and Dahat replaces the
environment on top of it — launcher, window manager, apps, permissions, storage,
settings, lock screen. Inside a single JS realm the sandbox is an honour system
(see the last section of `docs/permissions.md`). The step-by-step distance to a
real fork, with what each phase actually costs, is
[`docs/roadmap-real-os.md`](docs/roadmap-real-os.md).

Fonts: Noto Sans Sinhala (SIL OFL), bundled so the glyphs render offline.
