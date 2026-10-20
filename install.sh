#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Install RecentDock for the current user. No sudo, no system files, no network.
#
#   ./install.sh            install, enable, and pin to the dock
#   ./install.sh --no-pin   do not add the icon to the dock favorites
#   ./install.sh --force    install even on an untested GNOME Shell version
set -euo pipefail

UUID="recentdock@legitforce.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
EXT_DIR="$DATA_HOME/gnome-shell/extensions/$UUID"
APP_DIR="$DATA_HOME/recentdock"
DESKTOP="$DATA_HOME/applications/recentdock.desktop"
ICON="$DATA_HOME/icons/hicolor/scalable/apps/recentdock.svg"
MANIFEST="$APP_DIR/installed-files"
MARKER="X-RecentDock-Installer=1"

PIN=1
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --no-pin) PIN=0 ;;
        --force) FORCE=1 ;;
        -h|--help) sed -n '3,8p' "$0"; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Do not run this as root. RecentDock installs for your user only."

# --- Environment checks ------------------------------------------------------
command -v gnome-shell >/dev/null || die "GNOME Shell was not found. RecentDock requires the GNOME desktop."
SHELL_VERSION="$(gnome-shell --version | awk '{print $3}')"
SHELL_MAJOR="${SHELL_VERSION%%.*}"
case "$SHELL_MAJOR" in
    45|46|47) ;;
    *) if [ "$FORCE" -eq 1 ]; then
           warn "GNOME Shell $SHELL_VERSION is untested; continuing because of --force."
       else
           die "GNOME Shell $SHELL_VERSION is not supported (45–47 are). Use --force to try anyway."
       fi ;;
esac

missing=()
for cmd in gjs glib-compile-schemas gdbus gsettings; do
    command -v "$cmd" >/dev/null || missing+=("$cmd")
done
if [ "${#missing[@]}" -gt 0 ]; then
    die "Missing commands: ${missing[*]}. On Ubuntu they come with the standard desktop (packages gjs, libglib2.0-bin)."
fi

if [ -r /etc/os-release ]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    say "Detected ${PRETTY_NAME:-Linux}, GNOME Shell $SHELL_VERSION, ${XDG_SESSION_TYPE:-unknown} session"
fi

# --- Refuse to overwrite files that RecentDock did not create -----------------
foreign() { # $1 = path; true if it exists and is not in our manifest
    [ -e "$1" ] || return 1
    [ -f "$MANIFEST" ] && grep -qxF "$1" "$MANIFEST" && return 1
    return 0
}
if foreign "$DESKTOP" && ! grep -qxF "$MARKER" "$DESKTOP"; then
    die "$DESKTOP already exists and was not created by RecentDock. Move it away and run again."
fi
if foreign "$ICON"; then
    die "$ICON already exists and was not created by RecentDock. Move it away and run again."
fi
if [ -e "$EXT_DIR" ] && [ ! -f "$EXT_DIR/metadata.json" ]; then
    die "$EXT_DIR exists but does not look like an extension. Move it away and run again."
fi

# --- Install -----------------------------------------------------------------
say "Installing the extension to $EXT_DIR"
mkdir -p "$EXT_DIR" "$APP_DIR" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
rm -rf "$EXT_DIR.new"
mkdir -p "$EXT_DIR.new"
cp -r "$ROOT/src/." "$EXT_DIR.new/"
glib-compile-schemas --strict "$EXT_DIR.new/schemas"
rm -rf "$EXT_DIR"
mv "$EXT_DIR.new" "$EXT_DIR"

say "Installing the dock launcher"
LAUNCHER="$APP_DIR/recentdock-launch"
sed "s|@EXTDIR@|$EXT_DIR|g" "$ROOT/data/recentdock-launch" > "$LAUNCHER"
chmod 755 "$LAUNCHER"
{
    sed "s|@LAUNCHER@|$LAUNCHER|g" "$ROOT/data/recentdock.desktop.in"
    echo "$MARKER"
} > "$DESKTOP"
cp "$ROOT/data/recentdock.svg" "$ICON"

printf '%s\n' "$EXT_DIR" "$LAUNCHER" "$DESKTOP" "$ICON" "$MANIFEST" > "$MANIFEST"

command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$DESKTOP")" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && [ -f "$DATA_HOME/icons/hicolor/index.theme" ] && \
    gtk-update-icon-cache -q "$DATA_HOME/icons/hicolor" 2>/dev/null || true

# --- Enable ------------------------------------------------------------------
NEEDS_RELOGIN=0
if gnome-extensions enable "$UUID" 2>/dev/null; then
    say "Extension enabled"
    # An already-running older copy keeps running until the shell restarts.
    gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE" || NEEDS_RELOGIN=1
else
    # GNOME Shell only discovers new extensions at login; mark it enabled so it
    # starts automatically next time.
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if ! grep -qF "'$UUID'" <<<"$current"; then
        if [ "$current" = "@as []" ] || [ "$current" = "[]" ]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']"
        fi
    fi
    NEEDS_RELOGIN=1
fi
if [ "$(gsettings get org.gnome.shell disable-user-extensions)" = "true" ]; then
    warn "User extensions are disabled on this system. Turn them on in the Extensions app."
fi

if [ "$PIN" -eq 1 ]; then
    favs="$(gsettings get org.gnome.shell favorite-apps)"
    if ! grep -qF "'recentdock.desktop'" <<<"$favs"; then
        if [ "$favs" = "@as []" ] || [ "$favs" = "[]" ]; then
            gsettings set org.gnome.shell favorite-apps "['recentdock.desktop']"
        else
            gsettings set org.gnome.shell favorite-apps "${favs%]}, 'recentdock.desktop']"
        fi
        say "Pinned RecentDock to the dock"
    fi
fi

echo
say "RecentDock is installed."
if [ "$NEEDS_RELOGIN" -eq 1 ]; then
    echo "    Log out and log back in to start it (GNOME loads new extensions at login)."
    [ "${XDG_SESSION_TYPE:-}" = "x11" ] && \
        echo "    On X11 you can instead press Alt+F2, type r, and press Enter."
fi
echo "    Left-click the RecentDock icon in the dock for the quick action; right-click for recent items."
echo "    Settings: right-click the icon → RecentDock Settings."
echo "    Uninstall with ./uninstall.sh"
