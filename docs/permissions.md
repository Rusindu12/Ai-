# Dahat OS — permissions and the filesystem jail

Two mechanisms, both enforced in the kernel rather than in the UI:

* **capabilities** — a per-app yes/no on each sensitive action (`kernel/caps.js`)
* **the path jail** — what a given `appId` may touch in the VFS (`kernel/vfs.js`)

## Capabilities

| capability | guards | notes |
| --- | --- | --- |
| `storage` | `fs.*` under `/sdcard` | private `/apps/<id>` and `/tmp` never need it |
| `network` | `app.openUrl` | links leave through the host, never silently |
| `phone` | `app.dial` | hands the number to the Android dialer; Dahat holds no call permission |
| `camera` / `mic` | `camera.*`, `assistant` voice | in the APK these map to real Android runtime permissions |
| `notifications` | `notif.post` | mirrored into Android's shade when the bridge exists |
| `settings` | `settings.set`, `sys.dmesg`, `pm.setLayout` | reading is free for public keys, private keys need OS trust |
| `process` | `app.open`, `sys.kill`, `sys.procs`, `pm.install/uninstall/clearData`, `caps.reset` | the "control other apps" family |
| `wakelock` | `power.wake` | `FLAG_KEEP_SCREEN_ON` in the APK, Wake Lock API in a browser |
| `clipboard` | `clip.set` / `clip.get` | read is the sensitive half |
| `vibrate` | `ui.haptic` | |
| `alarm` | `app.setAlarm` | the only capability that reaches `AlarmManager` |

Eleven capabilities, and every one of them is a *syscall-level* check, not a UI
convenience. The list is defined once (`CAPS` in `kernel/caps.js`) and the same
table drives Settings ▸ Permissions, the prompt dialog and the Terminal's
`caps` command.

### How a decision is reached

```
app calls bus('fs.write', {path:'/sdcard/Notes/x.md'})
  └─ gate(appId, path, {write:true})
       ├─ path starts with /apps/<other>      → EPERM  (no capability buys you this)
       ├─ path is /system, /, /apps           → EROFS  (read-only volumes)
       ├─ path under /sdcard                  → caps.check(appId, 'storage')
       │     ├─ already granted                → allow (cached)
       │     ├─ already denied                 → EACCES (cached, no re-prompt)
       │     └─ unknown                        → caps.prompter(appId, cap, why)
       │                                        → grant|deny cached + audited to dmesg
       └─ quota check (96 MiB)                 → ENOSPC
```

`trust: true` on a registration, `appId === 'system'`, or a package whose
`kind === 'system'` in the package index skips the prompt — the equivalent of an
app signed with the platform key. Third-party packages (anything from the
Bazaar) always answer a prompt the first time, and Settings ▸ Permissions ▸
*app* ▸ Reset revokes it. The kernel log line for a denial is deliberately
loud: `caps: snake asked for storage → denied`.

Two rules that are easy to get wrong and are covered by the self-test:

* **A denial is enforced, not decorative.** `caps.check` returning false must
  make the syscall throw `EACCES`. (It didn't at first — the test caught it.)
* **Prompts are cached per (app, capability)** so an app cannot nag the user
  into accepting by retrying.

## The filesystem jail

```
/                 read-only root (EROFS)
/system           the image: os-release, build.prop, fonts  → read-only for everyone,
                  including the shell's own apps
/apps/<id>        this app's home, always writable, invisible to other apps
/tmp              scratch, per-boot, shared (no capability needed)
/sdcard           shared with the user: DCIM, Documents, Notes, Music, Pictures, Inbox, Download
                  → needs the `storage` capability
```

* One quota, enforced at write time: 96 MiB (`vfs.QUOTA_BYTES`), visible in
  Settings ▸ Storage and `fs.df`.
* Files inside `/apps/<id>` are addressed as absolute paths by the app but the
  kernel stores them namespaced, so a typo can't escape into another app.
* Reads of `/system` are open to all — a browser engine needs to see its own
  fonts; writes are refused even for OS-signed packages, because "read-only
  partition" should mean something when the user is looking (the self-test
  asserts a system app cannot write `/system` either).

## Attack notes (what this model does *not* stop)

All apps run in one JS realm, so an app that ignores `ctx.api` and imports
`kernel/bus.js` can call `bus.call('fs.write', …, { appId: 'settings' })` — the
kernel trusts the caller's claimed `appId` in that case. The real boundary is the
Android one (a separate UID, no filesystem access to other apps, no `MANAGE_*`
permissions), and inside the OS this is an *honour-system sandbox* — the same
trade-off every "OS inside a browser" project makes, written down instead of
hand-waved. `tools/selftest.mjs` locks the parts that can be locked in-realm:
path jail, read-only volumes, cross-app `/apps` isolation, denial enforcement
and the notification namespace.
