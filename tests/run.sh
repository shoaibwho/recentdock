#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs the unit and integration tests with a private, in-memory GSettings
# backend, so your real RecentDock settings are never touched.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCHEMAS=$(mktemp -d)
trap 'rm -rf "$SCHEMAS"' EXIT
glib-compile-schemas --strict --targetdir="$SCHEMAS" "$ROOT/src/schemas"
GSETTINGS_SCHEMA_DIR="$SCHEMAS" GSETTINGS_BACKEND=memory gjs -m "$ROOT/tests/run.js"
