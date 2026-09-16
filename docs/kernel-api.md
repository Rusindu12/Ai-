# Dahat OS — kernel API

Everything an app may touch goes through one function: `bus.call(name, args, ctx)`.
That single choke point is where capability checks, auditing and accounting happen,
so there is no second door. The app never imports a kernel module — it gets a
facade (`ctx.api`) built on that call.

## The shape of a syscall

```js
// os/js/kernel/syscalls.js
bus.register('fs.read', async ({ path }, ctx) => {
  const p = await gate(ctx.appId, path);              // sandbox + capability check
  return { path: p, data: vfs.read(p, cwdOf(ctx)) };
}, { desc: 'read a file' });
```

`ctx` is `{ pid, appId, cwd, trust }`, filled in by `bus.call` and not by the app —
a process cannot claim to be somebody else, because `appId` is bound when the
window manager builds the facade.

## The 57 syscalls

Generated from the running registry (`node tools/syscall-doc.mjs`), so this table
cannot drift from the code. `—` in the capability column means the check happens
inside the handler: the filesystem needs `storage` only for `/sdcard`, `settings.set`
needs `settings` only for callers that are not part of the system image, and
`app.setAlarm` needs `alarm`.

| syscall | capability | what it does |
| --- | --- | --- |
| `app.cancelAlarm` | — | cancel an alarm this app armed |
| `app.closeSelf` | — | ask the shell to close this window |
| `app.dial` | `phone` | dial a phone number |
| `app.info` | — | what the window manager knows about this pid |
| `app.open` | `process` | open another app |
| `app.openUrl` | `network` | open an external link |
| `app.setAlarm` | — | arm an alarm (host bridge when available) |
| `app.share` | — | share text out of the OS |
| `caps.list` | — | every capability the OS knows |
| `caps.request` | — | ask the user for one capability |
| `caps.reset` | — | forget an app’s grants (shell only) |
| `caps.status` | — | this app’s granted / denied capabilities |
| `clip.get` | `clipboard` | read the clipboard |
| `clip.set` | `clipboard` | copy to the clipboard |
| `fs.df` | — | quota and usage |
| `fs.ls` | — | list a directory |
| `fs.mkdir` | — | create a folder |
| `fs.move` | — | move or rename |
| `fs.read` | — | read a file |
| `fs.rm` | — | delete a file |
| `fs.stat` | — | stat one path |
| `fs.tree` | — | recursive listing |
| `fs.write` | — | write a file |
| `notif.badge` | — | unread count for one app |
| `notif.clear` | — | dismiss notifications |
| `notif.list` | — | this app’s notification log |
| `notif.post` | `notifications` | Show you a notification |
| `pm.available` | — | what the Bazaar index offers |
| `pm.clearData` | `process` | wipe an app’s sandbox |
| `pm.info` | — | one manifest |
| `pm.install` | `process` | install a new package |
| `pm.list` | — | installed packages |
| `pm.pin` | `process` | pin an app to a home page |
| `pm.setLayout` | `settings` | rewrite the home layout |
| `pm.uninstall` | `process` | remove a package |
| `power.info` | — | battery source of truth |
| `power.status` | — | battery + screen state |
| `power.wake` | `wakelock` | keep the screen awake |
| `settings.get` | — | read a setting (private keys need OS trust) |
| `settings.list` | — | public settings, or all of them for the shell |
| `settings.set` | — | change system settings |
| `store.del` | — | drop one app-private key |
| `store.get` | — | read app-private key/value |
| `store.set` | — | write app-private key/value |
| `sys.dmesg` | `settings` | read the whole kernel log |
| `sys.info` | — | one-shot system summary |
| `sys.kill` | `process` | stop another app |
| `sys.log` | — | read the kernel log |
| `sys.perf` | — | frame clock + jank counter |
| `sys.procs` | `process` | list running processes |
| `sys.stats` | — | bus + storage counters |
| `sys.time` | — | clock, zone and locale |
| `sys.uname` | — | name, version, build of this OS |
| `sys.uptime` | — | time since boot |
| `ui.haptic` | `vibrate` | short haptic pulse |
| `ui.sfx` | — | play a synthesised UI sound |
| `ui.toast` | — | transient message in the shell |

_57 syscalls — regenerate with `node tools/syscall-doc.mjs`._

## Topics the shell answers

| topic | direction | payload |
| --- | --- | --- |
| `wm.close` | kernel → shell | `{ pid }` |
| `win.title` | app → shell | `{ pid, title }` |
| `ui.toast` | app → shell | `{ message, ms }` |
| `notif.heads` | kernel → shell | the notification (heads-up banner) |
| `theme.change` | config → shell | `{ theme, accent, wp, scale, blur }` |
| `volume` | Quick Settings → audio, piano | `{ v }` 0..1 |
| `fs.change` | vfs → Files, Gallery | `{ path }` |
| `proc.stalled` | scheduler → shell | `{ pid, appId }` (missed 5 s of heartbeats) |
| `alarm.fire` | host bridge → Clock | `{ key, appId, label }` |
| `net.change`, `power.save`, `screen.*`, `caps.change`, `pm.change` | kernel → anyone | state deltas |

## The app contract

```js
export default {
  id: 'myapp',
  async create(ctx) {
    // build DOM, subscribe to what you need
    return {
      el,                          // required: the root node the shell mounts
      onCreate() {},             // right after mount
      onResume() {}, onPause() {},      // focus in/out (background pids are suspended)
      onResize() {},             // window resized / snapped / rotation
      onParams(p) {},            // re-opened with new params
      onBack() { return false }, // true = I consumed the back key
      destroy(reason) {},        // timer/listener/wakelock cleanup — mandatory
    };
  },
};
```

`ctx` carries `pid, appId, pkg, params, api, bus, t, bi, lang(), icon()`, plus
`toast, haptic, sfx, close, setTitle, setMode, requestCap, openApp, root, size(),
prompt, confirm, sheet`.

Two rules keep the OS honest:

1. **Only `ctx.api.*`.** System apps (`settings`, `monitor`, `terminal`, `assistant`)
   may import kernel modules directly because they ship inside the system image;
   anything installable may not.
2. **`destroy()` must undo everything.** The headless smoke test
   (`tools/appsmoke.mjs`) fails an app that leaves an interval or an animation frame
   running after destroy, because a launcher that leaks a loop per launch is a
   battery leak.

## Writing a new app in five minutes

```bash
$EDITOR os/js/apps/hello.js     # export default { id, create(ctx) }
# then add it to LOADERS in os/js/apps/registry.js and to PKGS in kernel/packages.js
node tools/check.mjs && node tools/appsmoke.mjs hello
```

Bilingual strings go through `i18n.bi({ en, si })` (`B()` in most apps); a missing
Sinhala string falls back to English instead of showing a key.
