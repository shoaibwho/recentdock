#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Integration test inside a nested GNOME Shell with a throwaway HOME, so the
# real session, settings and history are not touched. Opens a window briefly.
#   tools/nested-test.sh [--keep]   (--keep leaves the nested shell running)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HOME; HOME="$(mktemp -d /tmp/recentdock-nested-XXXXXX)"
unset XDG_DATA_HOME XDG_CONFIG_HOME XDG_STATE_HOME XDG_CACHE_HOME
mkdir -p "$HOME/.config" "$HOME/Downloads" "$HOME/Documents"
# shellcheck disable=SC2016  # literal $HOME is the user-dirs.dirs syntax
echo 'XDG_DOWNLOAD_DIR="$HOME/Downloads"' > "$HOME/.config/user-dirs.dirs"
exec dbus-run-session -- bash "$ROOT/tools/nested-test-inner.sh" "$@"
