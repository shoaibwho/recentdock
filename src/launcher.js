// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone left-click fallback, used only when the RecentDock extension is
// not running (see data/recentdock-launch). It reads the same settings and
// history as the extension and performs the configured action once, then
// exits. If there is nothing to open it shows RecentDock Settings instead.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {SCHEMA_ID, readConfig} from './lib/config.js';
import {HistoryStore} from './lib/history.js';
import {parseRecent, defaultRecentPath} from './lib/recentFiles.js';
import {resolveLeftClick} from './lib/model.js';
import {isAvailable} from './lib/paths.js';
import {perform} from './lib/actions.js';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const UUID = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(GLib.build_filenamev([here, 'metadata.json']))[1])).uuid;

function openSettings() {
    try {
        Gio.Subprocess.new(['gnome-extensions', 'prefs', UUID], Gio.SubprocessFlags.NONE);
    } catch (e) {
        printerr(`RecentDock: ${e.message}`);
    }
}

const source = Gio.SettingsSchemaSource.new_from_directory(
    GLib.build_filenamev([here, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup(SCHEMA_ID, false)});
const config = readConfig(settings);

let recent = {files: [], folders: []};
try {
    recent = parseRecent(GLib.file_get_contents(defaultRecentPath())[1],
        {excludeScreenshots: config.excludeScreenshots});
} catch {}

const target = resolveLeftClick(config, {store: new HistoryStore().load(), recent}, isAvailable);
const loop = new GLib.MainLoop(null, false);
if (target.kind === 'none') {
    printerr(`RecentDock: ${target.message}`);
    openSettings();
} else {
    perform(target).then(ok => {
        if (!ok)
            openSettings();
        loop.quit();
    });
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => loop.quit());
    loop.run();
}
