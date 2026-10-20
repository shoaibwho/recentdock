// SPDX-License-Identifier: GPL-3.0-or-later
// Reads the freedesktop "recently used" list (~/.local/share/recently-used.xbel)
// that GTK applications, LibreOffice, file choosers (via the portal), Nautilus
// and many others write to. RecentDock only reads this file; it never edits it.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Applications whose entries do not mean "the user opened this":
//   gnome-shell adds every screenshot it saves.
const SCREENSHOT_APPS = ['gnome-shell'];
// Browsers register each finished download here, wherever it was saved
// (e.g. Chrome as "com.google.Chrome", Firefox as "Firefox"). File uploads go
// through the portal and are registered by it, not by the browser.
const BROWSER_APP_RE = /chrom|firefox|brave|edge|vivaldi|opera|epiphany|librewolf|waterfox|floorp|zen/i;

/** True if an xbel application name belongs to a web browser. */
export function isBrowserApp(name) {
    return BROWSER_APP_RE.test(name);
}

export function defaultRecentPath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
}

function toMs(dt) {
    return dt ? dt.to_unix_usec() / 1000 : 0;
}

/**
 * Parse xbel text into {files, folders, downloads} lists of entries, newest
 * first. Only local file:// entries are returned. `downloads` holds the files
 * a web browser registered, with the time they were first added.
 *
 * @param {string|Uint8Array} data
 * @param {{excludeScreenshots?: boolean}} opts
 */
export function parseRecent(data, {excludeScreenshots = true} = {}) {
    const bf = new GLib.BookmarkFile();
    bf.load_from_data(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    const files = [], folders = [], downloads = [];
    for (const uri of bf.get_uris()) {
        if (!uri.startsWith('file://'))
            continue;
        let path;
        try {
            [path] = GLib.filename_from_uri(uri);
        } catch {
            continue;
        }
        let apps = [];
        try {
            apps = bf.get_applications(uri);
        } catch {}
        if (excludeScreenshots && apps.length > 0 && apps.every(a => SCREENSHOT_APPS.includes(a)))
            continue;
        let mime = '';
        try {
            mime = bf.get_mime_type(uri);
        } catch {}
        // "visited" is the last time the item was used; "modified" the last
        // time the entry changed (re-registration also counts as a use).
        let time = 0;
        for (const getter of ['get_visited_date_time', 'get_modified_date_time', 'get_added_date_time']) {
            try {
                time = Math.max(time, toMs(bf[getter](uri)));
            } catch {}
        }
        if (!time)
            continue;
        const entry = {path, time, source: 'recently-used.xbel'};
        (mime === 'inode/directory' ? folders : files).push(entry);
        if (mime !== 'inode/directory' && apps.some(isBrowserApp)) {
            let added = 0;
            try {
                added = toMs(bf.get_added_date_time(uri));
            } catch {}
            downloads.push({path, time: added || time, source: 'recently-used.xbel (browser)'});
        }
    }
    const byTime = (a, b) => b.time - a.time;
    return {files: files.sort(byTime), folders: folders.sort(byTime), downloads: downloads.sort(byTime)};
}

/**
 * Watches recently-used.xbel and re-parses it (debounced) when it changes.
 * The read is asynchronous; only the parse runs on the main loop.
 */
export class RecentFilesSource {
    constructor(path = defaultRecentPath(), {debounceMs = 1500} = {}) {
        this._file = Gio.File.new_for_path(path);
        this._debounceMs = debounceMs;
        this._timeoutId = 0;
        this._listeners = new Set();
        this.files = [];
        this.folders = [];
        this.downloads = [];
        this.status = 'not started';
        this.lastParseMs = 0;
        this.excludeScreenshots = true;
    }

    start() {
        try {
            this._monitor = this._file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (_m, _f, _o, type) => {
                if (type === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    type === Gio.FileMonitorEvent.CREATED ||
                    type === Gio.FileMonitorEvent.DELETED)
                    this.queueReload();
            });
        } catch (e) {
            this.status = `unavailable: ${e.message}`;
        }
        this.reload();
    }

    queueReload() {
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, this._debounceMs, () => {
            this._timeoutId = 0;
            this.reload();
            return GLib.SOURCE_REMOVE;
        });
    }

    reload() {
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        this._file.load_contents_async(this._cancellable, (file, res) => {
            let bytes;
            try {
                [, bytes] = file.load_contents_finish(res);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                this.files = [];
                this.folders = [];
                this.downloads = [];
                this.status = e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
                    ? 'active (no recent items yet)' : `unavailable: ${e.message}`;
                this._emit();
                return;
            }
            try {
                const t0 = GLib.get_monotonic_time();
                const {files, folders, downloads} = parseRecent(bytes, {excludeScreenshots: this.excludeScreenshots});
                this.lastParseMs = (GLib.get_monotonic_time() - t0) / 1000;
                this.files = files;
                this.folders = folders;
                this.downloads = downloads;
                this.status = 'active';
            } catch (e) {
                // A half-written or corrupted file: keep the previous results.
                this.status = `parse error (kept previous list): ${e.message}`;
            }
            this._emit();
        });
    }

    connect(fn) {
        this._listeners.add(fn);
    }

    _emit() {
        for (const fn of this._listeners)
            fn();
    }

    stop() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._cancellable?.cancel();
        this._monitor?.cancel();
        this._monitor = null;
        this._listeners.clear();
    }
}
