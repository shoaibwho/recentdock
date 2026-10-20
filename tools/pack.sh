#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Build an extension zip (for `gnome-extensions install` / extensions.gnome.org review).
# The dock launcher entry is installed by install.sh, not by this zip.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/build"
cd "$ROOT/src"
gnome-extensions pack --force --out-dir="$ROOT/build" \
    --extra-source=lib --extra-source=launcher.js --schema=schemas/org.gnome.shell.extensions.recentdock.gschema.xml .
ls -l "$ROOT/build"
