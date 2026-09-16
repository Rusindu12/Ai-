# Roadmap — what a real Dahat OS would take

Written so that nobody has to guess where the line is. Everything in this
repository is an OS *environment* running as a userspace application on top of
Android (or in a browser). That is a legitimate thing to build — it is what
Android itself was for its first few years on some devices, what KaiOS is, what
every "desktop in the browser" project is — but it is not a phone stack you can
flash. This document is the honest distance between the two.

## Where this repo already is

| layer | today | real depth |
| --- | --- | --- |
| Apps & userspace | 19 apps, capability-gated syscalls, VFS with quota, packages, process table with frame budgets | already the shape of a real one |
| Framework | none — the "framework" is `api.js` + `kit.js` (300 lines of facade over a promise bus) | Android's is ~2.5 M lines of Java/Kotlin + binder |
| System UI | boot, lock, launcher, WM with split/PIP, shade, heads-up, onboarding | comparable in *behaviour*, not in surface |
| Host | one WebView activity, ~700 lines of Java, ~15 bridge methods | the useful part of a real HAL |
| Kernel / HAL / RIL | absent | everything below is the actual "operating system" |

## Phase 1 — a real app sandbox (weeks, still no AOSP fork)

Today one JS realm holds kernel and apps; an in-OS app could bypass `ctx.api`.
The fix is architectural and mostly already drawn:

1. Give each app its own `iframe`/Worker realm and make the facade a *proxy* over
   `postMessage` — a boundary a compromised app cannot import across.
2. Move `caps.check` and the VFS gate into a **separate process** (the host
   activity), so the policy engine and the policy subject are no longer in the
   same address space. In Android terms: the WebView becomes the app, `MainActivity`
   becomes the service, the bridge becomes a real AIDL interface.
3. Sign app packages (a manifest hash in `packages.js`, verified at install) so the
   Bazaar cannot serve code that claims a capability it should not have.

Deliverable: `dahat-sandbox` — same 19 apps, one realm per app, and the self-test
gains "an app cannot reach the bus directly" as an assertion.

## Phase 2 — a proper framework (months)

* **Binder-shaped IPC.** Replace promise-bus call semantics with a
  transactional, parcel-based transport so *native* processes can register
  services. Keep the syscall names — they are the API, the transport is not.
* **A real SDK.** Today writing an app means an ES module and two registry edits.
  Phase 2 is `dahat-sdk`: a manifest format, a permissions DSL, a resource
  compiler, and a `<activity>`-free app model that still supports cold starts
  under 400 ms.
* **Account/user model.** `/sdcard` is single-user; multi-user needs per-uid
  mounts and a lock-screen that knows which user is active.

## Phase 3 — AOSP fork (the honest "real OS")

Order of work, with the parts people underestimate first:

1. **Device bring-up before anything fun.** `dmesg`, then the vendor blob
   mixers: `dahat-<device>.mk`, `device/`, kernel defconfig, DTBO, and getting
   `fastboot boot` to a shell. On a modern phone this is where projects die, because
   the SoC's GPU/modem/ISP firmware is proprietary and the board files are the only
   glue. Treble helps — QSSI + vendor image separation means you can replace the
   framework without touching HALs, which is why a Phase-3 fork should target
   AOSP-treble-compatible devices (Pixel, some Motorola/Fairphone models) and not
   "any phone".
2. **Boot chain.** LK/U-Boot → AVB (verified boot chain with your own root of trust
   = bricking risk, so start with an unlocked bootloader and `fastboot flash`),
   ramdisk, `init.rc`/`init` services, SELinux enforcing. You inherit the kernel;
   writing one is a different, longer project.
3. **HALs you must own to call it an OS:** `healthd`/battery, `vibrator`,
   `lights`/backlight, thermal, and — the hard ones — RIL (telephony), audio HAL +
   AudioFlinger policy, camera HAL3 + HAL provider. Each needs a device-specific
   implementation or a vendor HAL reimplementation.
4. **Framework surgery.** `SystemServer` starts your services instead of
   ` WindowManager`'s: port `wm.js`, `sched.js`, `caps.js` to Java/Kotlin AIDL
   services so the policy engine sits in `system_server`, where a real OS keeps it.
   The JS syscalls become thin client-side stubs.
5. **Apps.** Either keep running the JS apps in a WebView shell per app (the
   pragmatic path, and what the OS already does) or port them to the SDK from
   Phase 2.
6. **Update and security.** A/B partitions + `update_engine`, a recovery you can
   sign, `apksigner`/OTA keys, and a patch cadence against Android Security
   Bulletins — otherwise a "real" fork is a *less* secure OS on day 40.

Realistic sizing for 1 engineer, evenings and weekends: Phase 1 a few weeks;
Phase 2 a year; Phase 3 booting a forked framework on a Pixel without RIL ~6-12
months; a phone you would hand to your mother, with camera + calls working on one
device, is a multi-year team effort (that is what `lineageOS` — an existing fork
with a decade of accumulated device trees — represents).

## What I would do next in this repo, in order

1. Phase 1 item 1 (iframe/Worker per app) — it is the only change that makes the
   permission model real rather than exemplary.
2. Real `adb`-installable app packaging: APK per in-OS app, signed, installed via
   `pm install` — the Bazaar then talks to a real store, not a fixture.
3. Notifications: `NotificationListenerService` so the OS shade can show and act on
   *Android's* notifications, not only its own — this is a genuine feature no
   launcher-shell project has, and it needs only the user's explicit "notification
   access" grant.
4. Alarms: exact-alarm permission flow, `USE_EXACT_ALARM` for the Clock, a widget
   on the Android home screen that is really the Dahat clock widget.
5. Camera: `CameraX` behind a `camera.*` syscall so photos get real HDR/flash and
   land in MediaStore (visible to other apps) with a user-visible toggle.
6. Then, and only then, a device tree.

## Non-goals

Root, bootloader unlocking tricks, SELinux policy bypasses, IMEI/SMS spoofing,
"de-Googling" as a marketing claim, or shipping an image that quietly loses
verified boot. If a step needs any of those, that step is where this project
should stop being an app and start being a fork — with all the work that implies.
