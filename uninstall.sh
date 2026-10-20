#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Remove RecentDock. Your files, downloads and folders are never touched.
#
#   ./uninstall.sh          remove RecentDock, keep its settings and history
#   ./uninstall.sh --purge  also delete RecentDock's settings and history
set -euo pipefail

UUID="recentdock@legitforce.github.io"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
APP_DIR="$DATA_HOME/recentdock"
MANIFEST="$APP_DIR/installed-files"
PURGE=0
for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
        -h|--help) sed -n '3,6p' "$0"; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

gnome-extensions disable "$UUID" 2>/dev/null && say "Extension disabled" || true

# Remove from enabled-extensions and the dock favorites (only our own entries).
remove_from_list() { # $1 key, $2 value
    local cur new
    cur="$(gsettings get org.gnome.shell "$1")"
    grep -qF "'$2'" <<<"$cur" || return 0
    new="$(sed -e "s/'$2', //; s/, '$2'//; s/'$2'//" <<<"$cur")"
    gsettings set org.gnome.shell "$1" "$new"
}
remove_from_list enabled-extensions "$UUID"
remove_from_list favorite-apps "recentdock.desktop"

# Remove exactly the files the installer recorded.
if [ -f "$MANIFEST" ]; then
    while IFS= read -r path; do
        case "$path" in
            "$DATA_HOME"/gnome-shell/extensions/"$UUID"|"$APP_DIR"/*|"$DATA_HOME"/applications/recentdock.desktop|"$DATA_HOME"/icons/hicolor/scalable/apps/recentdock.svg)
                [ -e "$path" ] && rm -rf -- "$path" && say "Removed $path" ;;
            *) echo "Skipping unexpected manifest entry: $path" >&2 ;;
        esac
    done < "$MANIFEST"
    rmdir "$APP_DIR" 2>/dev/null || true
else
    echo "No install manifest found; RecentDock does not seem to be installed by install.sh."
fi
command -v update-desktop-database >/dev/null && update-desktop-database -q "$DATA_HOME/applications" 2>/dev/null || true

if [ "$PURGE" -eq 1 ]; then
    rm -rf -- "$STATE_HOME/recentdock" && say "Removed RecentDock history ($STATE_HOME/recentdock)"
    dconf reset -f /org/gnome/shell/extensions/recentdock/ 2>/dev/null && say "Reset RecentDock settings" || true
else
    echo "Kept RecentDock settings and history. Run ./uninstall.sh --purge to remove them too."
fi
say "RecentDock has been removed. Log out and back in to fully unload it from GNOME Shell."
