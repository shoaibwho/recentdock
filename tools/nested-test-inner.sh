#!/usr/bin/env bash
# Runs on a private session bus; see nested-test.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UUID=recentdock@legitforce.github.io
"$ROOT/install.sh" >/dev/null
cp -r "$ROOT/tools/shell-test-helper" "$HOME/.local/share/gnome-shell/extensions/recentdock-test-helper@localhost"
gsettings set org.gnome.shell enabled-extensions "['$UUID', 'recentdock-test-helper@localhost']"
gsettings set org.gnome.shell disable-user-extensions false

LOG="$HOME/shell.log"
MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x800 gnome-shell --nested --wayland --mode=ubuntu >"$LOG" 2>&1 &
SHELL_PID=$!
# shellcheck disable=SC2317,SC2329  # invoked through trap
cleanup() { kill "$SHELL_PID" 2>/dev/null || true; wait "$SHELL_PID" 2>/dev/null || true; }
[ "${1:-}" = "--keep" ] || trap cleanup EXIT

for _ in $(seq 60); do
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval 'global.context.unsafe_mode' 2>/dev/null | grep -q "true, 'true'" && break
    sleep 0.5
done
export WAYLAND_DISPLAY; WAYLAND_DISPLAY="$(grep -o 'wayland-[0-9]*' "$LOG" | head -1 || true)"
status=0
if [ "${RECENTDOCK_MEASURE:-}" = 1 ]; then gjs -m "$ROOT/tools/measure-idle.js"; exit 0; fi
gjs -m "$ROOT/tools/nested-test.js" || status=1
SHOTS="${RECENTDOCK_SHOTS:-$HOME/shots}"
mkdir -p "$SHOTS"
GDK_BACKEND=wayland GI_TYPELIB_PATH="$(dirname "$(find /usr/lib /usr/lib64 -name 'Shew-*.typelib' 2>/dev/null | head -1)")" LD_LIBRARY_PATH="$(dirname "$(find /usr/lib /usr/lib64 -name 'libshew*' 2>/dev/null | head -1)")" gjs -m "$ROOT/tools/prefs-test.js" \
    "$HOME/.local/share/gnome-shell/extensions/$UUID" "$SHOTS" || status=1
echo "Settings screenshots: $SHOTS"
cp "$LOG" "${RECENTDOCK_LOG:-/dev/null}" 2>/dev/null || true; grep -iE "recentdock|JS ERROR" "$LOG" | grep -v "test-helper" | head -20 || true
exit $status
