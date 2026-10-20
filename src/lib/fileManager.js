// SPDX-License-Identifier: GPL-3.0-or-later
// Folder visits from the file manager, via the org.freedesktop.FileManager1
// D-Bus interface. Nautilus (GNOME Files) publishes the locations shown in its
// windows in the "OpenLocations" property and emits PropertiesChanged when the
// user navigates, so this is event-driven. The same interface is what Ubuntu
// Dock uses to associate Files windows with folders.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const BUS_NAME = 'org.freedesktop.FileManager1';
const OBJ_PATH = '/org/freedesktop/FileManager1';
const IFACE = 'org.freedesktop.FileManager1';

/** Convert OpenLocations URIs to local folder paths (pure, testable). */
export function locationsToPaths(uris) {
    const out = [];
    for (const uri of uris ?? []) {
        if (typeof uri !== 'string' || !uri.startsWith('file://'))
            continue; // trash://, recent://, network locations, etc.
        try {
            const [path] = GLib.filename_from_uri(uri);
            if (path && !out.includes(path))
                out.push(path);
        } catch {}
    }
    return out;
}

export class FileManagerTracker {
    /** @param {import('./history.js').HistoryStore} store */
    constructor(store) {
        this._store = store;
        this._proxy = null;
        this._known = new Set();
        this.status = 'not started';
    }

    start() {
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new(Gio.DBus.session,
            Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
            BUS_NAME, OBJ_PATH, IFACE, this._cancellable, (_o, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this.status = `unavailable: ${e.message}`;
                    return;
                }
                this._propsId = this._proxy.connect('g-properties-changed', () => this._update());
                this._ownerId = this._proxy.connect('notify::g-name-owner', () => this._update());
                this._update();
            });
    }

    _update() {
        if (!this._proxy.g_name_owner) {
            this.status = 'waiting (Files is not running)';
            this._known.clear();
            return;
        }
        this.status = 'active';
        const v = this._proxy.get_cached_property('OpenLocations');
        const paths = locationsToPaths(v ? v.deepUnpack() : []);
        const now = Date.now();
        // Record locations that newly appeared (a visit). Locations that stay
        // open are not re-recorded on every unrelated property change.
        for (const path of paths) {
            if (!this._known.has(path))
                this._store.add('opened-folders', {path, time: now, source: 'file-manager'});
        }
        this._known = new Set(paths);
    }

    stop() {
        this._cancellable?.cancel();
        if (this._proxy) {
            this._proxy.disconnect(this._propsId);
            this._proxy.disconnect(this._ownerId);
        }
        this._proxy = null;
    }
}
