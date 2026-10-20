// SPDX-License-Identifier: GPL-3.0-or-later
// Performing actions through desktop APIs only: files, folders and URLs are
// opened with their default handlers (Gio.AppInfo), applications through
// their .desktop entries. No shell, no command-line string building.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {parentOf} from './model.js';

function uriFor(path) {
    return Gio.File.new_for_path(path).get_uri();
}

/** Open a URI with its default handler. Resolves to true on success. */
export function openUri(uri, context = null) {
    return new Promise(resolve => {
        Gio.AppInfo.launch_default_for_uri_async(uri, context, null, (_s, res) => {
            try {
                resolve(Gio.AppInfo.launch_default_for_uri_finish(res));
            } catch (e) {
                console.warn(`RecentDock: could not open item: ${e.message}`);
                resolve(false);
            }
        });
    });
}

/**
 * Show a file selected in its folder using the file manager's standard
 * org.freedesktop.FileManager1.ShowItems method; open the folder instead if no
 * file manager implements it.
 */
export function showItem(path, context = null, startupId = '') {
    return new Promise(resolve => {
        Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1', 'ShowItems',
            new GLib.Variant('(ass)', [[uriFor(path)], startupId]),
            null, Gio.DBusCallFlags.NONE, 3000, null, (conn, res) => {
                try {
                    conn.call_finish(res);
                    resolve(true);
                } catch {
                    openUri(uriFor(parentOf(path)), context).then(resolve);
                }
            });
    });
}

export function launchApp(desktopId, context = null) {
    const info = Gio.DesktopAppInfo.new(desktopId);
    if (!info)
        return false;
    try {
        return info.launch([], context);
    } catch (e) {
        console.warn(`RecentDock: could not launch application: ${e.message}`);
        return false;
    }
}

/**
 * Carry out a resolved left-click target (see model.resolveLeftClick).
 * @returns {Promise<boolean>}
 */
export function perform(target, context = null) {
    switch (target.kind) {
    case 'show-item':
        return showItem(target.target, context);
    case 'open-folder':
    case 'open-file':
        return openUri(uriFor(target.target), context);
    case 'open-url':
        return openUri(target.target, context);
    case 'launch-app':
        return Promise.resolve(launchApp(target.target, context));
    default:
        return Promise.resolve(false);
    }
}

export {uriFor};
