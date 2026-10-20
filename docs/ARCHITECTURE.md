# Architecture

## Why a GNOME Shell extension

The requirements are a dock icon whose right-click menu holds dynamic content and whose
left-click runs a custom action. On Ubuntu's GNOME the options were:

| Option | Dynamic right-click menu | Cost | Verdict |
|---|---|---|---|
| Standalone app + `.desktop` actions | No. Desktop actions are static. | none | insufficient |
| Standalone app exporting a Unity quicklist (DBusMenu) | Yes. Ubuntu Dock supports it. | a process running all the time, plus libdbusmenu | heavier, needs a daemon |
| **Shell extension adding items to the icon's menu** | **Yes** | runs inside the Shell, no extra process | **chosen** |

The extension never patches files on disk. At runtime it wraps two methods with GNOME's
`InjectionManager`, and `disable()` restores them:

- `PopupMenu.prototype.open`: when the menu belongs to the `recentdock.desktop` app icon
  (Ubuntu Dock's `DockAppIconMenu` or GNOME's `AppMenu`), RecentDock's items are added at the
  top just before the menu opens. Other menus pay for one string comparison.
- `Shell.App.prototype.activate / activate_full / open_new_window`: when the app is RecentDock,
  the configured left-click action runs in the Shell instead of launching a process.
  `can_open_new_window` returns false for RecentDock, which hides the dock's "New Window" item.

`recentdock.desktop` is a normal user-level desktop entry, so the icon can be pinned, moved and
unpinned like any other app. If it is started while the extension isn't running, its `Exec`
script first asks the extension over D-Bus (`io.github.legitforce.RecentDock.Activate`). If that
fails, it falls back to `launcher.js`, a one-shot GJS process that performs the action or opens
Settings.

## Modules

```
src/
  extension.js        Shell integration: menu injection, activation, D-Bus, lifecycle
  prefs.js            Settings window (GTK 4 / libadwaita)
  launcher.js         one-shot left-click fallback when the extension is not running
  lib/config.js       constants, settings snapshot + validation (pure)
  lib/history.js      entry dedupe/sort/limit (pure) + JSON store with coalesced atomic writes
  lib/model.js        what the menu shows and what left-click does (pure)
  lib/downloads.js    Downloads folder monitor + start-up catch-up
  lib/recentFiles.js  recently-used.xbel reader (debounced, async read)
  lib/fileManager.js  Nautilus OpenLocations watcher (D-Bus property signal)
  lib/paths.js        path/URL validation and display helpers
  lib/actions.js      opening files/folders/URLs/apps through Gio only
  schemas/            GSettings schema
```

The `lib/` modules use only GLib and Gio, so the extension, Settings, the fallback launcher and
the tests all share them.

## Data flow

```
Downloads inotify ─┐
Files D-Bus signal ─┼─► HistoryStore (memory; saved ≤ once per 2 s) ─┐
                    │                                                ├─► model.buildMenuModel ─► menu items
recently-used.xbel ─┴─► RecentFilesSource (parsed on change) ────────┘   (on each menu open)
GSettings ──────────────────────────────────────────────────────────────► readConfig snapshot (on change)
```

- **The menu is built when it opens**, from data already in memory. The only I/O is one
  `stat` per candidate entry (at most a few dozen), so moved or deleted items are skipped, with
  results cached for that one build. Ubuntu Dock rebuilds its own menu on every open too.
- **Settings changes** take effect on the next menu open. Nothing needs to restart.
- **Clearing** history is requested from Settings, which runs in a different process, by
  writing `<section>-cleared-at` (a timestamp) to GSettings. The extension forgets stored
  entries up to that time, and display filtering hides older recent-files entries. Nothing is
  deleted from disk except RecentDock's own history entries.
- **Failure isolation:** each source starts in its own `try` and reports a status string. A
  source that fails yields no entries, and the other sections keep working.

## Configuration and migration

All settings live in the GSettings schema `org.gnome.shell.extensions.recentdock`. Each section
has its own keys: `-enabled`, `-limit` (range 3–5; values other than 3 and 5 are treated as 3),
`-sort` (enum), `-cleared-at`. `section-order` is a string list, and `config.normalizeOrder`
repairs it if it is corrupted, outdated or comes from a newer version (unknown ids are dropped
and missing ones are added back).

`schema-version` and the history file's `version` field are there for future migrations.
GSettings keys are only ever added, never renamed or retyped. Any conversion would happen in
`readConfig` and `parseStore`, which already treat every value as untrusted.

A corrupted history file is renamed to `history.json.corrupt` and replaced with an empty one.

## Security notes

- No shell is ever invoked with user data. Files, folders and URLs go through
  `Gio.AppInfo.launch_default_for_uri_async`, apps through `Gio.DesktopAppInfo.launch`, and
  "show in folder" through the standard `org.freedesktop.FileManager1.ShowItems` D-Bus method.
- Web addresses must be `http`/`https` with a host. `file:`, `javascript:` and other schemes
  are rejected.
- The application setting must look like a desktop-file ID (`[\w.-]+\.desktop`) and is resolved
  through `Gio.DesktopAppInfo`.
- The D-Bus object exports `Activate`, which runs the user's own configured action (any process
  in the session could already do that by launching the app), and `GetStatus`, which returns
  counts and states but no paths.
