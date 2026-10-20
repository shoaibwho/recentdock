// SPDX-License-Identifier: GPL-3.0-or-later
// Pure assembly of what the menu shows and what a left-click does.

import GLib from 'gi://GLib';

import {SECTION_IS_FOLDER, SECTION_TITLES, SORT_NEWEST} from './config.js';
import {dedupe, selectForDisplay} from './history.js';
import {validateWebUrl} from './paths.js';

/**
 * All candidate entries of a section, newest first, from every source.
 *
 * @param {string} id
 * @param {{store: {get: Function}, recent: {files: object[], folders: object[]}}} sources
 */
export function sectionCandidates(id, {store, recent}) {
    switch (id) {
    case 'downloaded-folders':
    case 'downloaded-files':
        return store.get(id);
    case 'opened-files':
        return recent?.files ?? [];
    case 'opened-folders':
        return dedupe([...store.get(id), ...recent?.folders ?? []]);
    default:
        return [];
    }
}

/**
 * Sections to render, in the configured order, skipping disabled sections
 * and sections with nothing to show.
 *
 * @param {ReturnType<import('./config.js').readConfig>} config
 * @param {object} sources
 * @param {(path: string, isFolder: boolean) => boolean} isAvailable
 */
export function buildMenuModel(config, sources, isAvailable) {
    if (!config.enabled)
        return [];
    const out = [];
    for (const id of config.order) {
        const sc = config.sections[id];
        if (!sc?.enabled)
            continue;
        const entries = selectForDisplay(sectionCandidates(id, sources), sc,
            e => isAvailable(e.path, SECTION_IS_FOLDER[id]));
        if (entries.length)
            out.push({id, title: SECTION_TITLES[id], isFolder: SECTION_IS_FOLDER[id], entries});
    }
    return out;
}

function latest(id, config, sources, isAvailable) {
    const sc = config.sections[id];
    const [e] = selectForDisplay(sectionCandidates(id, sources),
        {limit: 1, sort: SORT_NEWEST, clearedAt: sc.clearedAt},
        x => isAvailable(x.path, SECTION_IS_FOLDER[id]));
    return e ?? null;
}

/**
 * Decide what a left-click does. Independent of section visibility and order
 * (a hidden section's history is still used), but cleared history is not.
 *
 * @returns {{kind: 'show-item'|'open-folder'|'open-file'|'open-url'|'launch-app'|'none',
 *            target?: string, message?: string}}
 */
export function resolveLeftClick(config, sources, isAvailable) {
    const {action, url, app} = config.leftClick;
    switch (action) {
    case 'download-directory': {
        const e = latest('downloaded-files', config, sources, isAvailable);
        if (e)
            return {kind: 'show-item', target: e.path};
        return {kind: 'none', message: 'No downloaded file has been recorded yet.'};
    }
    case 'downloaded-folder': {
        const e = latest('downloaded-folders', config, sources, isAvailable);
        return e ? {kind: 'open-folder', target: e.path}
            : {kind: 'none', message: 'No downloaded folder has been recorded yet.'};
    }
    case 'visited-folder': {
        const e = latest('opened-folders', config, sources, isAvailable);
        return e ? {kind: 'open-folder', target: e.path}
            : {kind: 'none', message: 'No recently visited folder is available.'};
    }
    case 'opened-file': {
        const e = latest('opened-files', config, sources, isAvailable);
        return e ? {kind: 'open-file', target: e.path}
            : {kind: 'none', message: 'No recently opened file is available.'};
    }
    case 'url': {
        const u = validateWebUrl(url);
        return u ? {kind: 'open-url', target: u}
            : {kind: 'none', message: 'No valid web address is set. Choose one in RecentDock Settings.'};
    }
    case 'application':
        return app && /^[\w.-]+\.desktop$/.test(app)
            ? {kind: 'launch-app', target: app}
            : {kind: 'none', message: 'No application is selected. Choose one in RecentDock Settings.'};
    default:
        return {kind: 'none', message: 'Unknown left-click action.'};
    }
}

/** Parent folder of a path (used when an item can't be highlighted). */
export function parentOf(path) {
    return GLib.path_get_dirname(path);
}
