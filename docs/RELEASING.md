# Releasing

1. Make sure CI is green on `main` and that `tests/run.sh` and `tools/nested-test.sh` pass
   locally on at least one supported GNOME version. Note results in `docs/COMPATIBILITY.md`.
2. Bump `version-name` in `src/metadata.json` and add a section to `CHANGELOG.md`.
3. If settings changed, add only new keys (never rename or retype keys). If a conversion is
   needed, bump `schema-version` and handle it in `lib/config.js` / `lib/history.js`.
4. Commit, then tag: `git tag -s v0.2.0 -m "RecentDock 0.2.0"` and `git push --tags`.
5. Create a GitHub release from the tag. Attach the zip from `tools/pack.sh`, which is for
   people who use `gnome-extensions install`. Note that the dock icon itself comes from
   `install.sh`.
6. Mark a release **stable** only when CI passed and the end-to-end tests were run on that
   tag. Otherwise mark it as a pre-release.
