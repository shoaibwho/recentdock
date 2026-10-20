// SPDX-License-Identifier: GPL-3.0-or-later
// History entries and RecentDock's own small JSON store.
//
// An entry is {path: string, time: number (ms since epoch), source: string}.
// Only absolute local paths are stored; no file contents, no URLs, no titles.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {RETAINED_PER_SECTION, SORT_OLDEST} from './config.js';

export const STORE_VERSION = 1;
// Sections whose history RecentDock records itself. "opened-files" comes
// entirely from the desktop recent-files list and is never copied.
export const STORED_SECTIONS = Object.freeze([
    'downloaded-folders',
    'downloaded-files',
    'opened-folders',
]);

/** Canonical form of a path used for deduplication. */
export function canonicalPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/'))
        return null;
    // canonicalize_filename resolves "." and ".." and duplicate slashes without
    // touching the filesystem (symlinks are deliberately not resolved).
    const c = GLib.canonicalize_filename(path, null);
    return c.length > 1 && c.endsWith('/') ? c.slice(0, -1) : c;
}

export function isValidEntry(e) {
    return e !== null && typeof e === 'object' &&
        typeof e.path === 'string' && e.path.startsWith('/') &&
        Number.isFinite(e.time) && e.time > 0;
}

/**
 * Deduplicate by canonical path, keeping the newest timestamp for each path,
 * and return entries sorted newest first.
 */
export function dedupe(entries) {
    const byPath = new Map();
    for (const e of entries) {
        if (!isValidEntry(e))
            continue;
        const p = canonicalPath(e.path);
        if (!p)
            continue;
        const prev = byPath.get(p);
        if (!prev || e.time > prev.time)
            byPath.set(p, {...e, path: p});
    }
    return [...byPath.values()].sort((a, b) => b.time - a.time);
}

/** Insert or refresh an entry, keeping at most `max` newest entries. */
export function upsert(entries, entry, max = RETAINED_PER_SECTION) {
    return dedupe([entry, ...entries]).slice(0, max);
}

/** Rewrite entries at `oldPath` (or below it) after a rename/move. */
export function renamePath(entries, oldPath, newPath) {
    const o = canonicalPath(oldPath), n = canonicalPath(newPath);
    if (!o || !n)
        return entries;
    return dedupe(entries.map(e => {
        if (e.path === o)
            return {...e, path: n};
        if (e.path.startsWith(`${o}/`))
            return {...e, path: n + e.path.slice(o.length)};
        return e;
    }));
}

/**
 * Choose what one menu section displays.
 *
 * The `limit` most recent entries that are newer than the section's clear
 * time and pass `isAvailable` are selected; `sort` only changes the order in
 * which those entries are shown, never which entries are chosen.
 *
 * @param {object[]} entries
 * @param {{limit: number, sort: string, clearedAt: number}} opts
 * @param {(entry: object) => boolean} isAvailable
 */
export function selectForDisplay(entries, {limit, sort, clearedAt = 0}, isAvailable = () => true) {
    const picked = [];
    for (const e of dedupe(entries)) {
        if (picked.length >= limit)
            break;
        if (e.time <= clearedAt)
            continue;
        if (isAvailable(e))
            picked.push(e);
    }
    return sort === SORT_OLDEST ? picked.reverse() : picked;
}

/** Parse and validate the store file's JSON; never throws. */
export function parseStore(text) {
    const empty = {version: STORE_VERSION, lastScan: 0, sections: {}};
    for (const id of STORED_SECTIONS)
        empty.sections[id] = [];
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return {data: empty, ok: false};
    }
    if (!data || typeof data !== 'object' || typeof data.sections !== 'object')
        return {data: empty, ok: false};
    // Future migrations: inspect data.version here and convert.
    for (const id of STORED_SECTIONS) {
        const list = Array.isArray(data.sections?.[id]) ? data.sections[id] : [];
        empty.sections[id] = dedupe(list.map(e => ({
            path: e?.path, time: Number(e?.time), source: String(e?.source ?? 'unknown'),
        }))).slice(0, RETAINED_PER_SECTION);
    }
    empty.lastScan = Number(data.lastScan) || 0;
    return {data: empty, ok: true};
}

export function defaultStorePath() {
    return GLib.build_filenamev([GLib.get_user_state_dir(), 'recentdock', 'history.json']);
}

/**
 * RecentDock's history file. Writes are coalesced (one write at most every
 * `saveDelayMs`) and atomic (written to a temp file and renamed).
 */
export class HistoryStore {
    constructor(path = defaultStorePath(), saveDelayMs = 2000) {
        this._file = Gio.File.new_for_path(path);
        this._saveDelayMs = saveDelayMs;
        this._saveId = 0;
        this._listeners = new Set();
        this.data = parseStore('').data;
        this.loadError = null;
    }

    load() {
        try {
            const [, bytes] = this._file.load_contents(null);
            const {data, ok} = parseStore(new TextDecoder().decode(bytes));
            this.data = data;
            if (!ok) {
                this.loadError = 'corrupted';
                // Keep the unreadable file for inspection instead of silently
                // discarding it; a fresh store is written on the next save.
                const bak = Gio.File.new_for_path(`${this._file.get_path()}.corrupt`);
                this._file.move(bak, Gio.FileCopyFlags.OVERWRITE, null, null);
            }
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                this.loadError = e.message;
        }
        return this;
    }

    get(sectionId) {
        return this.data.sections[sectionId] ?? [];
    }

    set(sectionId, entries) {
        this.data.sections[sectionId] = dedupe(entries).slice(0, RETAINED_PER_SECTION);
        this._changed(sectionId);
    }

    add(sectionId, entry) {
        this.set(sectionId, upsert(this.get(sectionId), entry));
    }

    rename(oldPath, newPath) {
        for (const id of STORED_SECTIONS) {
            const before = this.get(id);
            const after = renamePath(before, oldPath, newPath);
            if (JSON.stringify(before) !== JSON.stringify(after))
                this.set(id, after);
        }
    }

    remove(sectionId, paths) {
        const drop = new Set(paths);
        const before = this.get(sectionId);
        const after = before.filter(e => !drop.has(e.path));
        if (after.length !== before.length)
            this.set(sectionId, after);
    }

    /** Permanently forget entries recorded at or before `clearedAt`. */
    forgetBefore(sectionId, clearedAt) {
        const before = this.get(sectionId);
        const after = before.filter(e => e.time > clearedAt);
        if (after.length !== before.length)
            this.set(sectionId, after);
    }

    connect(fn) {
        this._listeners.add(fn);
        return fn;
    }

    disconnect(fn) {
        this._listeners.delete(fn);
    }

    _changed(sectionId) {
        for (const fn of this._listeners)
            fn(sectionId);
        this._scheduleSave();
    }

    markScanned(time) {
        this.data.lastScan = time;
        this._scheduleSave();
    }

    _scheduleSave() {
        if (this._saveId)
            return;
        this._saveId = GLib.timeout_add(GLib.PRIORITY_LOW, this._saveDelayMs, () => {
            this._saveId = 0;
            this.save();
            return GLib.SOURCE_REMOVE;
        });
    }

    save() {
        try {
            const dir = this._file.get_parent();
            GLib.mkdir_with_parents(dir.get_path(), 0o700);
            const bytes = new TextEncoder().encode(JSON.stringify(this.data));
            // replace_contents writes to a temporary file and renames it, so a
            // crash mid-write never leaves a truncated history file.
            this._file.replace_contents(bytes, null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.warn(`RecentDock: could not save history: ${e.message}`);
        }
    }

    /** Write pending changes now and cancel the timer (used on disable). */
    flush() {
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
            this.save();
        }
    }

    destroy() {
        this.flush();
        this._listeners.clear();
    }
}
