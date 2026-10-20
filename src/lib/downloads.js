// SPDX-License-Identifier: GPL-3.0-or-later
// Download tracking by watching the XDG Downloads folder (non-recursively)
// with a GIO file monitor (inotify). No polling and no browser profile access.
//
// How browsers finish a download in that folder:
//   Chrome/Chromium/Brave/Edge: write "name.crdownload" (or
//     "Unconfirmed 123.crdownload"), then rename it to "name".
//   Firefox: create an empty placeholder "name" plus "name.part", write the
//     .part file, then rename "name.part" over "name".
//   wget/curl/other tools: write "name" directly and close it.
// A rename from a temporary name to a final name, or a newly created file that
// is closed (CHANGES_DONE) while no ".part"/".crdownload" sibling exists, is
// treated as a completed download.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const TEMP_SUFFIXES = [
    '.crdownload', '.part', '.partial', '.download', '.opdownload',
    '.tmp', '.temp', '.!qb', '.aria2', '.filepart', '~',
];

/** True for names that are never a finished, user-visible download. */
export function isTemporaryName(name) {
    if (!name || name.startsWith('.'))
        return true; // hidden files, ".com.google.Chrome.XXXX", ".fr-XXXX", ".goutputstream-*"
    const lower = name.toLowerCase();
    return TEMP_SUFFIXES.some(s => lower.endsWith(s));
}

/** Names of in-progress sibling files that indicate `name` is not finished. */
export function inProgressSiblings(name) {
    return [`${name}.part`, `${name}.crdownload`, `${name}.download`];
}

export function getDownloadDir() {
    const dir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
    // Fall back to ~/Downloads only if it exists; never invent a location.
    if (dir)
        return dir;
    const fallback = GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return GLib.file_test(fallback, GLib.FileTest.IS_DIR) ? fallback : null;
}

const QUERY_ATTRS = 'standard::type,standard::name,standard::is-hidden,time::modified';

export class DownloadsTracker {
    /**
     * @param {import('./history.js').HistoryStore} store
     * @param {string|null} dir
     */
    constructor(store, dir = getDownloadDir()) {
        this._store = store;
        this._dirPath = dir;
        this._monitor = null;
        this._pending = new Set(); // created files waiting for CHANGES_DONE
        this.status = 'not started';
    }

    start() {
        if (!this._dirPath || !GLib.file_test(this._dirPath, GLib.FileTest.IS_DIR)) {
            this.status = 'unavailable: no Downloads folder';
            return;
        }
        try {
            this._dir = Gio.File.new_for_path(this._dirPath);
            this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.connect('changed', (_m, file, other, type) => {
                try {
                    this._onChanged(file, other, type);
                } catch (e) {
                    console.warn(`RecentDock: downloads event ignored: ${e.message}`);
                }
            });
            this.status = 'active';
        } catch (e) {
            this.status = `unavailable: ${e.message}`;
            return;
        }
        this._catchUp();
    }

    stop() {
        // Remember when tracking stopped so the next start can catch up on
        // items that arrive while RecentDock is not running.
        if (this._monitor)
            this._store.markScanned(Date.now());
        this._monitor?.cancel();
        this._monitor = null;
        this._cancellable?.cancel();
        this._pending.clear();
    }

    get directory() {
        return this._dirPath;
    }

    _onChanged(file, other, type) {
        const E = Gio.FileMonitorEvent;
        switch (type) {
        case E.CREATED:
        case E.MOVED_IN:
            this._consider(file, type === E.CREATED);
            break;
        case E.RENAMED:
            // A tracked entry that is simply renamed keeps its history.
            this._store.rename(file.get_path(), other.get_path());
            if (isTemporaryName(file.get_basename()) || this._isPending(file))
                this._consider(other, false);
            else if (!this._known(other.get_path()))
                this._consider(other, false);
            this._pending.delete(file.get_path());
            break;
        case E.CHANGES_DONE_HINT:
            if (this._pending.delete(file.get_path()))
                this._consider(file, false);
            break;
        case E.DELETED:
        case E.MOVED_OUT:
            this._pending.delete(file.get_path());
            break;
        }
    }

    _isPending(file) {
        return this._pending.has(file.get_path());
    }

    _known(path) {
        return this._store.get('downloaded-files').some(e => e.path === path);
    }

    /**
     * @param {Gio.File} file
     * @param {boolean} justCreated a regular file that was just created may
     *   still be being written; wait for CHANGES_DONE_HINT.
     */
    _consider(file, justCreated) {
        const name = file.get_basename();
        if (isTemporaryName(name))
            return;
        let info;
        try {
            info = file.query_info(QUERY_ATTRS, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        } catch {
            return; // vanished already
        }
        const ftype = info.get_file_type();
        const path = file.get_path();
        if (ftype !== Gio.FileType.REGULAR)
            return;
        if (justCreated || this._hasInProgressSibling(name)) {
            // Firefox's empty placeholder lands here; the later rename of
            // "name.part" -> "name" records it once complete.
            this._pending.add(path);
            return;
        }
        this._store.add('downloaded-files', {path, time: Date.now(), source: 'downloads-monitor'});
    }

    _hasInProgressSibling(name) {
        return inProgressSiblings(name).some(n =>
            GLib.file_test(GLib.build_filenamev([this._dirPath, n]), GLib.FileTest.EXISTS));
    }

    /**
     * Pick up items that appeared while RecentDock was not running (logged
     * out, extension disabled). Lists the top level of Downloads once,
     * asynchronously; nothing is recursed into. On the very first run this
     * seeds the history with the newest few existing items.
     */
    _catchUp() {
        const since = this._store.data.lastScan || 0;
        const startedAt = Date.now();
        this._cancellable = new Gio.Cancellable();
        this._dir.enumerate_children_async(QUERY_ATTRS, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            GLib.PRIORITY_LOW, this._cancellable, (dir, res) => {
                let en;
                try {
                    en = dir.enumerate_children_finish(res);
                } catch {
                    return;
                }
                const files = [];
                const next = () => en.next_files_async(64, GLib.PRIORITY_LOW, this._cancellable, (_e, r) => {
                    let infos;
                    try {
                        infos = en.next_files_finish(r);
                    } catch {
                        return;
                    }
                    if (infos.length === 0) {
                        en.close_async(GLib.PRIORITY_LOW, null, null);
                        this._finishCatchUp(files, since, startedAt);
                        return;
                    }
                    for (const info of infos) {
                        const name = info.get_name();
                        if (info.get_is_hidden() || isTemporaryName(name))
                            continue;
                        const time = info.get_modification_date_time()?.to_unix_usec() / 1000 || 0;
                        const t = info.get_file_type();
                        const entry = {path: GLib.build_filenamev([this._dirPath, name]), time, source: 'downloads-scan'};
                        if (t === Gio.FileType.REGULAR && !this._hasInProgressSibling(name))
                            files.push(entry);
                    }
                    next();
                });
                next();
            });
    }

    _finishCatchUp(files, since, startedAt) {
        const firstRun = since === 0;
        const id = 'downloaded-files';
        const fresh = files
            .filter(e => firstRun || (e.time > since && e.time <= startedAt))
            .sort((a, b) => b.time - a.time)
            .slice(0, firstRun ? 5 : 25);
        const known = new Set(this._store.get(id).map(e => e.path));
        const add = fresh.filter(e => !known.has(e.path));
        if (add.length)
            this._store.set(id, [...add, ...this._store.get(id)]);
        this._store.markScanned(startedAt);
    }
}
