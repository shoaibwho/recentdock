# Performance measurements

Environment: Ubuntu 24.04.5, GNOME Shell 46.0, nested shell (`tools/nested-test.sh`) on an X11
host, 1280×800 virtual monitor, Ubuntu Dock. Measured on 2026-10-21. Numbers from a nested
shell are an upper bound: a real session renders more efficiently.

| Measurement | How | Result | Target |
|---|---|---|---|
| Right-click popup, entire dock menu (dock items + RecentDock) | `icon.popupMenu()` ×100, wall time | p50 8.9–9.2 ms, p95 10.4–13.8 ms, max 15.3 ms (3 runs) | p95 < 100 ms |
| RecentDock's part of the menu build | timed in `_populate()` (Diagnostics page) | p50 4.0–4.7 ms, p95 5.1–7.7 ms | — |
| Left-click dispatch (resolve the action in the Shell) | timed in `activate()` | p50 0.02 ms, p95 0.07 ms (n=21) | < 50 ms |
| Menu model, 5000 recent files + 1000 downloads | `tests/run.js` | p50 7 ms, p95 10.6 ms | — |
| Recent-files re-parse, real 1000-entry/670 KB file | `GLib.BookmarkFile` | 17–21 ms, only after the file changes, debounced 1.5 s | — |
| Idle Shell CPU, extension enabled vs disabled | `/proc/<pid>/stat` over 30 s windows, alternating | 0.73–0.87 % vs 0.77–0.97 % (no measurable difference) | minimal |
| Shell RSS, enabled vs disabled | `VmRSS`, alternating | difference −0.7 to −1.8 MiB (below noise) | minimal |

Notes:

- The idle numbers are the nested compositor's own baseline. During the first ~90 s of a fresh
  nested session, CPU bursts of 25–77 % appeared **with the extension disabled as well**
  (session start-up), so those windows are excluded.
- With no events and no menu open, RecentDock schedules no timers. The only timers are one-shot
  debounces (recent-files re-read 1.5 s, history save 2 s) started by actual changes.
- Disk writes: at most one small JSON write per 2 s, and only when history changed (a download,
  a folder visit, a clear).
- File system access when the menu opens: one `stat` per candidate entry. No directory scans.
  The Downloads folder is listed once per login, asynchronously and without recursion.

Reproduce with:

```sh
tools/nested-test.sh                         # menu/left-click timings
RECENTDOCK_MEASURE=1 tools/nested-test.sh    # idle CPU / RSS (about 3 minutes)
```
