# Compatibility

| Environment | Status | Notes |
|---|---|---|
| Ubuntu 24.04 LTS, GNOME Shell 46.0, X11 | **Tested** | Unit tests, nested-shell end-to-end tests, Settings UI tests |
| Ubuntu 24.04 LTS, Wayland | Expected to work | No X11-specific code. The nested test shell runs as a Wayland compositor. Not yet tested in a real Wayland login. |
| GNOME Shell 45 / 47 | Declared in `metadata.json`, untested | Same ESM extension API. Settings uses `Adw.AlertDialog` when available and falls back to `Adw.MessageDialog` (libadwaita 1.4). |
| GNOME Shell 48+ | Not declared | `install.sh --force` lets you try. Please report results. |
| GNOME Shell ≤ 44 (Ubuntu 22.04) | Not supported | Needs the legacy `imports.*` extension format |

## Docks and launchers

- **Ubuntu Dock / Dash to Dock:** full support (`DockAppIconMenu`).
- **GNOME overview dash and app grid:** full support (GNOME `AppMenu`).
- **Dash to Panel and other docks:** the left-click works if they activate apps through
  `Shell.App`. The right-click menu works if their menu is a `PopupMenu` whose `_source.app` or
  `_app` is the app. Untested.

## Session restarts

- **Wayland:** extensions load at login, so after installing or updating, log out and back in.
- **X11:** <kbd>Alt</kbd>+<kbd>F2</kbd> → `r` restarts the Shell and reloads extensions.

RecentDock stores its state on disk, so settings and history survive restarts, logouts and
reboots. Pending history writes are flushed when the extension is disabled, which includes
logout.
