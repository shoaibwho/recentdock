# Tracking sources and their limits

Linux has no system-wide, reliable event for "a file was opened", "a folder was visited" or
"a download finished". RecentDock combines a few sources that *are* reliable for what they
cover. This page lists exactly what that is.

## Downloaded files and folders: Downloads folder monitor

**How:** a non-recursive GIO file monitor (inotify) on the XDG Downloads directory
(`xdg-user-dir DOWNLOAD`), with `WATCH_MOVES` so renames arrive as one event.

| Event | Result |
|---|---|
| `name.crdownload` → `name` (Chrome, Chromium, Brave, Edge, Vivaldi) | completed file |
| `name.part` → `name` (Firefox; its empty placeholder `name` is ignored until then) | completed file |
| file created and closed (`CHANGES_DONE`) with no `.part`/`.crdownload` sibling (wget, curl, copy) | completed file |
| file or folder moved into Downloads | file / folder |
| folder created (Extract Here, `unzip`, `mkdir`) | folder |
| hidden temporary folder renamed to a visible name (e.g. `.fr-XXXX` → `Album`) | folder |
| a tracked item renamed inside Downloads | history follows the new name |
| hidden files, `*.crdownload`, `*.part`, `*.partial`, `*.download`, `*.tmp`, `*~`, `*.!qB`, … | ignored |

The browser flows above are tested by reproducing each browser's file operations against a
real inotify monitor (`tests/run.js`, `tools/nested-test.js`). They were not tested by driving
the browsers themselves, so please report any browser that behaves differently.

Only the top level of Downloads is watched. Files *inside* a downloaded folder are not separate
downloads, and archives and their extracted folders are recorded as separate items.

**Catch-up:** when the extension starts (at login), it lists the top level of Downloads once,
asynchronously, and adds items modified since it last stopped. On the very first run it seeds
each section with the 5 newest existing items, using their modification time.

**Not covered:**
- Downloads saved to a folder other than Downloads. (Possible future work: a configurable list
  of watched folders.)
- Browser download records (history databases). Reading them would mean accessing browser
  profiles, which this project deliberately avoids.
- "Extract Here" for an archive whose files are not in a single top-level folder puts files
  directly into Downloads, and those are listed as downloaded files.
- A folder created by hand in Downloads is indistinguishable from an extracted one and is
  listed too.
- A partial download that the browser renames to its final name even though it failed (rare)
  is listed.

## Opened files: the recent-files list

**How:** `~/.local/share/recently-used.xbel` (the freedesktop "recently used" specification,
GTK `RecentManager`) is read with `GLib.BookmarkFile`. A file monitor triggers a re-read 1.5 s
after the file changes. The read is asynchronous, and the parse takes about 17 ms for a
1000-entry, 670 KB file. The timestamp used is the latest of visited/modified/added.

**Writers include:** GNOME apps (Text Editor, Document Viewer, Image Viewer, Files, …),
LibreOffice, VS Code, file-chooser dialogs through xdg-desktop-portal (any Flatpak/Snap/GTK app
that opens a file through a dialog), and most GTK applications.

**Not covered:** applications that don't write this list, such as most terminal programs, some
Qt/KDE apps (they use their own recent-files store), and some Electron apps.

Screenshots saved by GNOME Shell are excluded by default (Settings → History → *Ignore
screenshots*), because the Shell records each screenshot it saves even though the user never
opened it.

## Opened folders

Three sources, merged and deduplicated by path:

1. **Files (Nautilus)** exposes the locations shown in its windows as the `OpenLocations`
   property of `org.freedesktop.FileManager1` and signals every change. A location that newly
   appears is recorded as a visit, so it is event-driven with no polling. Only local folders are
   recorded (not `trash://`, network shares, etc.).
2. **Folders opened through RecentDock's menu.**
3. **Folders in the recent-files list** (`inode/directory` entries), for example a folder
   chosen in an "Open Folder" dialog.

**Not covered:** other file managers (Nemo, Dolphin, Thunar), terminals, and navigation inside
IDEs. Visits are only recorded while the extension is running.

## Adding a source

A source either writes entries into `HistoryStore` (as the downloads and Files trackers do) or
exposes lists that `model.sectionCandidates()` merges (as the recent-files source does). It
should be event-driven, start inside its own `try`, and report a `status` string for
Diagnostics.
