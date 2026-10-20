# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's "Report a vulnerability" (private security
advisories) on this repository, or email the maintainer listed on the GitHub profile. Expect an
acknowledgement within 7 days.

## Security model

- RecentDock runs inside GNOME Shell with your user's privileges and needs no extra
  permissions. It makes no network connections.
- It never runs a shell or builds command lines from file names, URLs or settings. Items are
  opened through Gio (`launch_default_for_uri`, `DesktopAppInfo`) and the standard
  `org.freedesktop.FileManager1` D-Bus interface.
- Configured web addresses must be `http`/`https`. Other schemes (`file:`, `javascript:`, …)
  are rejected.
- History (`~/.local/state/recentdock/history.json`) is created with mode 0600 and contains only
  paths, timestamps and source names.
- The D-Bus object `/io/github/legitforce/RecentDock` on the Shell's session-bus name offers
  `Activate` (runs your configured left-click action) and `GetStatus` (counts and states, no
  paths). Only processes in your own session can reach it.

Interesting areas for reports: path handling of unusual file names, URL validation, and
anything that could make the Shell launch something other than what the user configured.
