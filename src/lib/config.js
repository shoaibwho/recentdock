// SPDX-License-Identifier: GPL-3.0-or-later
// Shared constants and pure configuration helpers. No Shell/GTK imports here:
// this module is used by the extension, the preferences window, the fallback
// launcher and the unit tests.

export const APP_ID = 'recentdock.desktop';
export const SCHEMA_ID = 'org.gnome.shell.extensions.recentdock';
export const SCHEMA_VERSION = 1;
export const DBUS_PATH = '/io/github/legitforce/RecentDock';
export const DBUS_IFACE = 'io.github.legitforce.RecentDock';

export const SECTION_IDS = Object.freeze([
    'downloaded-folders',
    'downloaded-files',
    'opened-files',
    'opened-folders',
]);

export const DEFAULT_ORDER = SECTION_IDS;

export const SECTION_TITLES = Object.freeze({
    'downloaded-folders': 'Recently Downloaded Folders',
    'downloaded-files': 'Recently Downloaded Files',
    'opened-files': 'Recently Opened Files',
    'opened-folders': 'Recently Opened Folders',
});

// Which sections hold folders (opened with the file manager) vs. files.
export const SECTION_IS_FOLDER = Object.freeze({
    'downloaded-folders': true,
    'downloaded-files': false,
    'opened-files': false,
    'opened-folders': true,
});

export const ALLOWED_LIMITS = Object.freeze([3, 5]);
export const DEFAULT_LIMIT = 3;
export const SORT_NEWEST = 'newest';
export const SORT_OLDEST = 'oldest';

// How many entries are retained per section in RecentDock's own store. This is
// larger than the display limit so that entries which disappear (deleted,
// unmounted) can be skipped while still filling the menu.
export const RETAINED_PER_SECTION = 25;

export const LEFT_CLICK_ACTIONS = Object.freeze([
    'download-directory',
    'downloaded-folder',
    'visited-folder',
    'opened-file',
    'url',
    'application',
]);

export const LEFT_CLICK_LABELS = Object.freeze({
    'download-directory': 'Show latest download in its folder',
    'downloaded-folder': 'Open latest downloaded folder',
    'visited-folder': 'Open latest visited folder',
    'opened-file': 'Open latest opened file',
    'url': 'Open a web address',
    'application': 'Launch an application',
});

export const key = (sectionId, suffix) => `${sectionId}-${suffix}`;

export function sanitizeLimit(value) {
    return ALLOWED_LIMITS.includes(value) ? value : DEFAULT_LIMIT;
}

export function sanitizeSort(value) {
    return value === SORT_OLDEST ? SORT_OLDEST : SORT_NEWEST;
}

/**
 * Turn a stored order (possibly corrupted, outdated, or from a future version)
 * into a valid permutation of SECTION_IDS: unknown ids and duplicates are
 * dropped, and missing ids are appended in their default position order.
 *
 * @param {string[]} stored
 * @returns {string[]}
 */
export function normalizeOrder(stored) {
    const out = [];
    for (const id of Array.isArray(stored) ? stored : []) {
        if (SECTION_IDS.includes(id) && !out.includes(id))
            out.push(id);
    }
    for (const id of DEFAULT_ORDER) {
        if (!out.includes(id))
            out.push(id);
    }
    return out;
}

/** Move `id` to `targetIndex` within `order`, returning a new array. */
export function moveSection(order, id, targetIndex) {
    const out = normalizeOrder(order).filter(x => x !== id);
    const idx = Math.max(0, Math.min(targetIndex, out.length));
    out.splice(idx, 0, id);
    return out;
}

/**
 * Read every per-section setting from a Gio.Settings-like object into a plain
 * snapshot, validating each value so a corrupted configuration cannot break
 * the menu.
 *
 * @param {{get_boolean: Function, get_int: Function, get_string: Function,
 *          get_strv: Function, get_int64?: Function}} settings
 */
export function readConfig(settings) {
    const sections = {};
    for (const id of SECTION_IDS) {
        sections[id] = {
            enabled: settings.get_boolean(key(id, 'enabled')),
            limit: sanitizeLimit(settings.get_int(key(id, 'limit'))),
            sort: sanitizeSort(settings.get_string(key(id, 'sort'))),
            clearedAt: Number(settings.get_int64(key(id, 'cleared-at'))) || 0,
        };
    }
    const action = settings.get_string('left-click-action');
    return {
        enabled: settings.get_boolean('enabled'),
        order: normalizeOrder(settings.get_strv('section-order')),
        sections,
        leftClick: {
            action: LEFT_CLICK_ACTIONS.includes(action) ? action : 'download-directory',
            url: settings.get_string('left-click-url'),
            app: settings.get_string('left-click-app'),
        },
        excludeScreenshots: settings.get_boolean('exclude-screenshots'),
    };
}
