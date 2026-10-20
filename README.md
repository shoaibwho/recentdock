# RecentDock

A small, privacy-friendly GNOME Shell extension that adds a **RecentDock** icon to the
Ubuntu dock:

- **Left-click** runs one action you choose. By default it shows your latest download in its folder.
- **Right-click** lists your recent items in four sections you can turn on or off and reorder:

```
RecentDock Settings            ← always first
── Recent Download Locations
   Downloads
   Documents
── Recent Downloads
   report.pdf
   photo.png
── Recent Files
   notes.txt
── Recent Folders
   Projects
── (the dock's own items: Unpin, App Details…)
```

Everything runs on your computer and works offline. There is no telemetry, no background
service, and no polling.

## Install

```sh
git clone https://github.com/shoaibwho/recentdock.git
cd recentdock
./install.sh
```

Then **log out and log back in**. GNOME Shell only loads newly installed extensions at login.
On X11 you can instead press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r` and press <kbd>Enter</kbd>.

The installer:

- installs for your user only (no `sudo`, no system files, no packages);
- checks for GNOME Shell 45–47 and the standard tools it needs (`gjs`, `gdbus`, `gsettings`,
  `glib-compile-schemas`, all part of a normal Ubuntu desktop);
- enables the extension and pins the RecentDock icon to the dock (use `--no-pin` to skip pinning);
- refuses to overwrite any file it did not create itself.

### What gets installed

| Path | What |
|---|---|
| `~/.local/share/gnome-shell/extensions/recentdock@legitforce.github.io/` | the extension |
| `~/.local/share/applications/recentdock.desktop` | the dock icon's launcher entry |
| `~/.local/share/icons/hicolor/scalable/apps/recentdock.svg` | icon |
| `~/.local/share/recentdock/` | fallback launcher script and install manifest |

### Uninstall

```sh
./uninstall.sh           # removes RecentDock, keeps its settings and history
./uninstall.sh --purge   # also deletes RecentDock's settings and history
```

Uninstalling removes only the files listed in the install manifest. It never touches your
documents, downloads or folders.

## Using RecentDock

- **Left-click the icon** to run your chosen action:
  1. Show the latest downloaded file in its folder (default)
  2. Open the latest downloaded folder
  3. Open the latest visited folder
  4. Open the latest opened file
  5. Open a web address in your default browser (http/https only)
  6. Launch an application you pick
- **Right-click the icon** to see the recent-items menu. Clicking an entry opens it with its
  default application, or in Files for folders. Items that were moved or deleted are left out
  of the menu. If one disappears while the menu is open, clicking it shows a notification
  instead.
- **Settings:** right-click → **RecentDock Settings**. You can also open it from the
  Extensions app.

### Settings

| Page | What you can change |
|---|---|
| General | Turn RecentDock on/off, choose the left-click action, view tracking status, refresh |
| Menu Layout | Drag sections (or use the arrows) to reorder them, turn each one on/off, choose 3 or 5 items |
| Sections | For each section: show/hide, 3 or 5 items, newest or oldest first, what it tracks, clear |
| History | Clear one section or everything, ignore screenshots, see where data is stored |
| Diagnostics | Versions, source status and measured timings, with a privacy-safe copyable report |

Each section's settings are independent. Moving a section, hiding it or changing its limit
does not affect the others. Hiding a section keeps its history, so it comes back when you
show the section again. **Newest/oldest first** only changes the order of the items shown. In
both cases they are the most recent 3 or 5.

## What is tracked, and what isn't

Linux has no universal "file was opened" or "download finished" event. RecentDock uses the
reliable sources below and says plainly what they miss. See
[docs/TRACKING.md](docs/TRACKING.md) for the details.

| Section | Source | Not covered |
|---|---|---|
| Downloaded Files | Watching your **Downloads** folder (inotify via GIO). Recognises Chrome/Chromium/Brave/Edge `.crdownload` and Firefox `.part` temporary files, so unfinished downloads never appear. Files written directly (wget, curl, copies) are recorded when the writer closes them. Downloads a browser saves to **any other folder** are picked up from the recent-files list, where browsers register them. | Non-browser downloads saved outside Downloads. Downloads made while you were logged out are picked up at next login from the folder's contents. |
| Downloaded Folders | The folder each recent download was saved into (e.g. `~/Documents` if you saved an image there), newest first. | Same as Downloaded Files. |
| Opened Files | The desktop's recent-files list (`~/.local/share/recently-used.xbel`), which GNOME/GTK apps, LibreOffice, file choosers and many other apps write to. Read only. | Apps that don't register recent files (many terminal, some Electron/Qt apps). |
| Opened Folders | Folders you visit in **Files (Nautilus)**, through its standard `org.freedesktop.FileManager1` D-Bus interface; folders opened via RecentDock; folders in the recent-files list (e.g. chosen in an "Open Folder" dialog). | Other file managers, terminals (`cd`), and IDE-internal navigation. Visits are recorded only while you are logged in. |

## Privacy

- History stays on this computer and is never sent anywhere. RecentDock makes no network
  connections.
- Only what the menu needs is stored: the path, a timestamp and which source recorded it. Up to
  25 entries are kept per section. No file contents, titles or browsing history.
- RecentDock **does not read browser profiles or databases**. It only looks at the Downloads
  folder.
- **Where data lives:**
  - Settings: GSettings/dconf at `/org/gnome/shell/extensions/recentdock/`
  - RecentDock's history: `~/.local/state/recentdock/history.json` (mode 0600)
  - The desktop recent-files list is only read, never modified.
- **Clearing history** (Settings → History) makes RecentDock forget entries. It never deletes
  files or folders, and it doesn't change the desktop's own recent-files list.
- Diagnostics and logs contain no file names or paths.

## Compatibility

| | Status |
|---|---|
| Ubuntu 24.04 LTS, GNOME Shell 46, X11 | Tested (automated tests in a nested GNOME Shell) |
| Ubuntu 24.04, Wayland session | Expected to work, because nothing depends on X11. The automated tests run the nested shell with `--wayland`. |
| GNOME Shell 45, 47 (e.g. Fedora 39–41, Ubuntu 24.10) | Declared compatible (same extension APIs). Not tested yet. |
| GNOME Shell ≤ 44 (Ubuntu 22.04) | **Not supported**: those versions use a different extension module system. |
| Docks | Ubuntu Dock / Dash to Dock, the GNOME dash in the overview, and the app grid |

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Performance

Measured on Ubuntu 24.04 / GNOME Shell 46 in a nested shell (details in
[docs/PERFORMANCE.md](docs/PERFORMANCE.md)):

| Measurement | Result | Target |
|---|---|---|
| Right-click menu popup, whole dock menu, ×100 | p50 8.9 ms, p95 10.4–13.8 ms | p95 < 100 ms |
| RecentDock's part of the menu build | p50 4.6 ms, p95 5.4–7.7 ms | — |
| Left-click dispatch (in-shell, no process launched) | p50 0.02 ms, p95 0.07 ms | < 50 ms |
| Idle GNOME Shell CPU, enabled vs disabled | no measurable difference (≈0.8% both) | minimal |
| Memory | difference below measurement noise (< 2 MiB) | minimal |
| Recent-files re-parse (1000-entry, 670 KB file) | ≈17 ms, only after the file changes (debounced) | — |

There are no timers or polling while idle. Work happens only when a file event or D-Bus
signal arrives, or when you open the menu.

## Troubleshooting

- **The icon is there but right-click shows only the normal dock menu.** The extension isn't
  running. Log out and back in, then check `gnome-extensions info recentdock@legitforce.github.io`
  (it should say `State: ACTIVE`). Also make sure extensions are switched on in the Extensions app.
- **Left-click opens Settings instead of doing the action.** The extension isn't running, and a
  fallback helper ran instead. See the previous point.
- **"No downloaded file has been recorded yet".** Nothing has been downloaded into the
  Downloads folder since RecentDock started. Downloads saved elsewhere aren't tracked.
- **A section doesn't appear.** Sections with nothing to show are hidden, and so are sections
  you switched off in Menu Layout.
- **Logs:** `journalctl --user -b | grep -i recentdock` (no paths are logged).
- Settings → Diagnostics → **Copy Report** gives a privacy-safe summary to attach to bug reports.

## Development

```sh
tests/run.sh            # unit + integration tests (GJS, private in-memory settings)
tools/nested-test.sh    # end-to-end tests in a throwaway nested GNOME Shell (opens a window)
npx eslint@9 src tests tools
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

"RecentDock" is the project's working name. No trademark search or clearance has been done.
RecentDock is not affiliated with GNOME, Canonical or Ubuntu.
