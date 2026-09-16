# Dahat OS — architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Apps (19)          settings files notes terminal monitor bazaar clock …  │
│                     every one of them talks to the kernel through api.js   │
├──────────────────────────────────────────────────────────────────────────┤
│  Shell              boot · lock · launcher · window manager · shade ·      │
│                     status bar · dialogs · heads-up · theme                │
├──────────────────────────────────────────────────────────────────────────┤
│  Kernel (userspace) syscalls · bus (IPC) · caps (permissions) · vfs ·      │
│                     pm (packages) · sched (processes) · notify · power ·   │
│                     config · storage · log                                 │
├──────────────────────────────────────────────────────────────────────────┤
│  Platform           browser / PWA · Android launcher APK (WebView + bridge)│
└──────────────────────────────────────────────────────────────────────────┘
```

Everything is plain ES modules, no bundler, no framework, no transpile step: the
file you read is the file the phone runs. That is a deliberate constraint — it
keeps the whole OS readable in an afternoon and makes the tests below able to
import real OS code instead of a mock.

## Directory map

| path | role |
| --- | --- |
| `os/index.html` | `#device > #screen > #wallpaper + #layers`, one layer per surface |
| `os/styles/app.css` | tokens (`--accent`, `--surface`, `--status-h`…) + every reusable class |
| `os/js/kernel/` | storage, log, caps, bus, vfs, packages, pm, sched, notify, power, config, syscalls, api |
| `os/js/shell/` | boot, theme, dialogs, statusbar, shade, wm, lock, launcher, onboarding, heads-up, main |
| `os/js/apps/` | registry, kit (shared widgets) and the 19 apps |
| `os/js/ui/` | `dom.js` (hyperscript + icons), `i18n.js`, `audio.js` (synthesised UI sound) |
| `android/` | the launcher APK that hosts the same `os/` folder |
| `tools/` | `check`, `selftest`, `appsmoke`, `domstub`, `syscall-doc`, `balance` |

## Layer stack

`#layers` holds, in z-order: home → apps drawer → window root → shade → lock →
boot → dialogs → toasts → status bar → nav bar. Windows are absolutely positioned
inside `#window-root`, which is inset by `--status-h`/`--nav-h`; those two
variables include `env(safe-area-inset-*)`, so the same layout lands below a
notch on a real phone and inside a rounded frame in the browser.

## Boot order (`os/js/shell/boot.js`)

Eight named stages, each of which paints the boot screen (min 1250 ms so the
splash is legible, and `dmesg` shows the real timings):

1. `storage.init()` — pick IndexedDB → localStorage → memory, remember the mode
2. `config.load()` — settings hydrate, then `applyTheme()` + `watchTheme()`
3. `registerSyscalls()` — 57 handlers on the bus; `caps.load()`; install the
   permission prompter (`permPrompt`) and the trust predicate
4. `vfs.mount()` — snapshot inodes out of storage, seed `/system`, `/apps`,
   `/sdcard`, then wire `fs.change` relays
5. `pm.load()`, `notif.load()` — package index + retained notifications
6. shell init: `shade`, `statusbar`, `wm`, `launcher`, `lockscreen`, heads-up
7. `power.init()` — Battery API or the Android bridge, online/offline, doze clock
8. service worker registration + host bridge attach + `window.Dahat` debug handle

The kernel is up before any app code is imported: apps are lazily imported on
first launch (`apps/registry.js`), which is why the shell starts fast on a
low-end phone.

## Processes, not components

`kernel/sched.js` keeps a process table. Launching an app spawns a pid; each
focused window gets a frame budget (`sched.budget`, derived from the display
refresh), background pids are suspended and their timers frozen; every pid
heartbeats (`beat()`) and a process that misses 5 s of heartbeats is marked
`unresponsive` — which is what the "Force stop" button in the app switcher acts
on, and what the Monitor app shows in red.

Syscall time is charged to the calling pid, so `sys.perf` / the Monitor can say
"Snake burned 112 ms of kernel time" instead of hand-waving.

## IPC

`kernel/bus.js` is a registry of named services plus a topic pub/sub. Both are
plain promises, `request()` for services that answer, `on/emit` for events. Every
call is counted per service and per app; `bus.stats()` feeds Settings ▸ Developer
and the Monitor. There is no other communication path: an app that wants
something from the OS calls the bus, and that is where policy lives.

## Storage

`kernel/storage.js` tries IndexedDB (large, async), falls back to
`localStorage`, then to a memory Map (which is what the tests run on). Only the
kernel touches it. The VFS persists a snapshot of its inode table into that
store, so the filesystem, apps' key-value stores, permissions, notification
history and the home layout all survive a reload — on the phone, a reload is the
same as a reboot.

## Why "userspace kernel" and not a joke

There is no privilege separation between the "kernel" and the "apps": they share
one JS realm. What *is* real is the discipline — apps only reach the OS through
`bus.call`, capability checks happen on the way in, filesystem paths are jailed,
and denials are audited. A malicious in-OS app could still call `bus` directly,
exactly like a process with `CAP_SYS_ADMIN` can bypass the VFS; the trust boundary
that actually holds is the one in the Android host (`docs/android-launcher.md`).
Saying this out loud is the difference between an OS demo and a lie.
