// SPDX-License-Identifier: GPL-3.0-or-later
// Path and URL validation. Nothing here ever runs a shell or a command line.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * Check that a local path still exists and is of the expected kind.
 * Only local (native) absolute paths are accepted. Symlinks are followed so
 * that a link to a folder still counts as a folder.
 *
 * @param {string} path
 * @param {boolean} wantDir
 */
export function isAvailable(path, wantDir) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0'))
        return false;
    try {
        const info = Gio.File.new_for_path(path).query_info('standard::type,access::can-read',
            Gio.FileQueryInfoFlags.NONE, null);
        if (info.has_attribute('access::can-read') && !info.get_attribute_boolean('access::can-read'))
            return false;
        const isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
        return wantDir ? isDir : !isDir;
    } catch {
        return false;
    }
}

/**
 * Validate a user-configured web address. Only http and https are allowed, so
 * a URL can never be used to open a local file, a script, or another handler.
 *
 * @param {string} text
 * @returns {string|null} the normalized URL, or null if invalid
 */
export function validateWebUrl(text) {
    if (typeof text !== 'string')
        return null;
    let s = text.trim();
    if (!s || /\s/.test(s))
        return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s))
        s = `https://${s}`;
    let uri;
    try {
        uri = GLib.Uri.parse(s, GLib.UriFlags.NONE);
    } catch {
        return null;
    }
    const scheme = uri.get_scheme()?.toLowerCase();
    if (scheme !== 'http' && scheme !== 'https')
        return null;
    if (!uri.get_host())
        return null;
    return uri.to_string();
}

/** Display name for a path: its basename, or "/" for the root. */
export function displayName(path) {
    const base = GLib.path_get_basename(path);
    return GLib.filename_display_name(base) || path;
}

/** Parent folder with the home directory abbreviated to "~". */
export function displayParent(path) {
    const parent = GLib.path_get_dirname(path);
    const home = GLib.get_home_dir();
    const shown = parent === home ? '~'
        : parent.startsWith(`${home}/`) ? `~${parent.slice(home.length)}` : parent;
    return GLib.filename_display_name(shown);
}
