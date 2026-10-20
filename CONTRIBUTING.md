# Contributing to RecentDock

Thanks for helping! Bug reports, tested-on reports for other GNOME versions, and pull
requests are all welcome.

## Ground rules

- **Lightweight first.** No polling, no background services, no network access, no new runtime
  dependencies beyond what a stock GNOME desktop ships.
- **Honest tracking.** Only add a tracking source if it is reliable. Document what it covers and
  what it misses in `docs/TRACKING.md`.
- **Privacy.** Don't log or expose file paths. Don't read browser profiles.
- **Safety.** Never pass user data to a shell or build command lines. Use Gio APIs.
- **Settings stay independent.** A change to one section must never affect another.

## Development setup

```sh
./install.sh --no-pin       # install your working copy
tests/run.sh                # unit + integration tests (does not touch your real settings)
tools/nested-test.sh        # end-to-end in a throwaway nested GNOME Shell (opens a window)
npx eslint@9 src tests tools
```

After changing extension code, reload the Shell (X11: <kbd>Alt</kbd>+<kbd>F2</kbd> → `r`;
Wayland: log out and back in) or use the nested shell. Settings (`prefs.js`) changes take
effect the next time the Settings window opens.

Shell logs: `journalctl --user -f -o cat /usr/bin/gnome-shell`.

## Code layout

See `docs/ARCHITECTURE.md`. Keep `src/lib/` free of Shell and GTK imports so it stays testable
with plain `gjs`. Pure logic goes in `config.js`, `history.js` and `model.js`, with tests in
`tests/run.js`.

## Pull requests

- One focused change per PR, with tests for new behaviour.
- `tests/run.sh` and ESLint must pass (CI runs both).
- If you change user-visible behaviour, update the README and docs.
- Use clear commit messages. By contributing you agree that your work is licensed under
  GPL-3.0-or-later.
