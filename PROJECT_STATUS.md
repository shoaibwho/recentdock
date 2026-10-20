# RecentDock — Project Status

Status as of 2026-10-21, version 0.1.0 (pre-release).

## Getting started after install

GNOME Shell loads new extensions only at login. After `./install.sh`, **log out and back in**.
On X11 you can instead press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r` and press <kbd>Enter</kbd>.
The installer pins the RecentDock icon to the dock.

To remove it: `./uninstall.sh`, or `./uninstall.sh --purge` to also delete its settings and history.

## How it works

- RecentDock is a GNOME Shell extension plus a normal `recentdock.desktop` dock entry.
- A standalone app can't put live content in the dock's right-click menu without a process
  running all the time. The extension instead adds its items to the top of that icon's
  existing menu. Ubuntu Dock's own items (Pin, App Details) stay below.
- Left-click is handled inside the Shell, so no process is launched.
- There's no daemon, no polling and no network access. Everything is undone when the extension
  is disabled.

Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Where history comes from

| Section | Source |
|---|---|
| Downloaded files and folders | A file watcher on the Downloads folder. Unfinished Chrome-family (`.crdownload`) and Firefox (`.part`) downloads are never listed. |
| Opened files | The desktop's shared recent-files list (`recently-used.xbel`). RecentDock only reads it. |
| Opened folders | Folders visited in Files (Nautilus), plus folders opened through RecentDock or recorded in the recent-files list. |

## What has been tested

| Suite | Result | Covers |
|---|---|---|
| Unit and integration tests (`tests/run.sh`) | 28 of 28 pass | Real file-watcher runs reproducing the Chrome, Firefox, wget and archive-extraction flows; corrupted configuration |
| End-to-end in a nested GNOME Shell (`tools/nested-test.sh`) | 23 of 23 checks pass | The real Ubuntu Dock icon (details below) |
| Settings window (`tools/prefs-test.js`) | 16 of 16 checks pass | Drag-and-drop handlers, arrow buttons, 3/5 limits, web-address validation, clear confirmation |
| Install and uninstall, isolated home folder and session | Pass | Install, reinstall, uninstall, `--purge`, refusing to overwrite foreign files |
| ESLint, ShellCheck, schema validation | Clean | — |

The end-to-end checks cover:

- Settings always first, and the default section order
- toggles, limits and sorting staying independent per section
- re-enabling a section bringing its history back
- clearing one section only, with no files deleted
- deleted items disappearing without errors
- left-click handled with no process launched
- clean disable and re-enable

The Settings tests exercise the real handlers, but the physical mouse drag itself was not
automated.

## Measured performance

Measured in a nested shell, so these numbers are an upper bound on real cost.

| Measurement | Result | Target |
|---|---|---|
| Right-click menu popup (95th percentile) | 10–14 ms | under 100 ms |
| Left-click dispatch (95th percentile) | 0.07 ms | under 50 ms |
| Idle CPU, enabled vs disabled | about 0.8% both ways (no measurable difference) | minimal |
| Memory, enabled vs disabled | difference below measurement noise | minimal |

Full results are in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Known limitations

- Downloads saved outside the Downloads folder aren't tracked.
- A folder created by hand in Downloads counts as a downloaded folder.
- Apps that don't write the shared recent-files list (many terminal apps, some Qt and Electron
  apps) aren't covered.
- File managers other than Nautilus aren't covered.
- Browser behaviour was checked by reproducing each browser's file operations, not by driving
  the browsers themselves.
- Only GNOME 46 on X11 was tested. Wayland and GNOME 45/47 are expected to work but are
  unverified. Ubuntu 22.04 (GNOME 42) is not supported.

See [docs/TRACKING.md](docs/TRACKING.md) and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Before publishing

- [ ] Make the initial commit. The git repository is initialised but nothing is committed.
- [x] Repository URL set to https://github.com/shoaibwho/recentdock.
- [ ] Confirm the extension ID `recentdock@legitforce.github.io`. If your GitHub name differs,
      change it now, because changing it after release breaks existing installs.
- [ ] Test in a real Wayland session and on GNOME 45/47 if possible, and update
      `docs/COMPATIBILITY.md`.
- [ ] Follow [docs/RELEASING.md](docs/RELEASING.md) to tag and publish.
