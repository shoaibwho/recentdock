// SPDX-License-Identifier: GPL-3.0-or-later
// Drives the nested shell started by nested-test.sh through org.gnome.Shell.Eval.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

const UUID = 'recentdock@legitforce.github.io';
const HOME = GLib.get_home_dir();
const DL = `${HOME}/Downloads`;
let failures = 0;

function evalShell(code) {
    const r = Gio.DBus.session.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
        new GLib.Variant('(s)', [code]), null, Gio.DBusCallFlags.NONE, 10000, null).deepUnpack();
    if (!r[0])
        throw new Error(`Eval failed: ${r[1]}`);
    return r[1] ? JSON.parse(r[1]) : undefined;
}
function sleep(ms) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}
function check(name, cond, detail = '') {
    print(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? `  [${detail}]` : ''}`);
    if (!cond)
        failures++;
}

const schemaDir = `${HOME}/.local/share/gnome-shell/extensions/${UUID}/schemas`;
const src = Gio.SettingsSchemaSource.new_from_directory(schemaDir, Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: src.lookup('org.gnome.shell.extensions.recentdock', false)});

// Shell-side helpers, defined once in the shell's global scope.
evalShell(`
globalThis.rdFind = () => {
    const stack = [global.stage];
    while (stack.length) {
        const a = stack.pop();
        if (a.app?.get_id?.() === 'recentdock.desktop' && typeof a.popupMenu === 'function' && a.mapped)
            return a;
        stack.push(...a.get_children());
    }
    return null;
};
globalThis.rdMenu = () => {
    const icon = rdFind();
    if (!icon) return null;
    icon.popupMenu();
    const items = icon._menu._getMenuItems().map(i =>
        i.label ? (i.constructor.name.includes('Separator') ? '# ' : '') + i.label.text
            : (i.constructor.name.includes('Separator') ? '---' : '?'));
    icon._menu.close(0);
    return items;
};
true`);

const ext = evalShell(`(() => { const e = Main.extensionManager.lookup('${UUID}'); return e ? {state: e.state, error: e.error ?? null} : null; })()`);
check('extension loaded and active', ext?.state === 1, JSON.stringify(ext));
let found = false;
for (let i = 0; i < 40 && !found; i++) {
    found = evalShell('!!rdFind()');
    if (!found)
        sleep(250);
}
check('RecentDock icon is in the dock', found);

// --- Seed real activity --------------------------------------------------
GLib.file_set_contents(`${DL}/report.pdf.crdownload`, 'partial');
sleep(300);
GLib.rename(`${DL}/report.pdf.crdownload`, `${DL}/report.pdf`);
GLib.file_set_contents(`${DL}/photo.png`, '');
GLib.file_set_contents(`${DL}/photo.png.part`, 'img');
sleep(300);
GLib.rename(`${DL}/photo.png.part`, `${DL}/photo.png`);
for (const n of ['Extracted', 'Album'])
    GLib.mkdir_with_parents(`${DL}/${n}`, 0o755);
for (let i = 1; i <= 6; i++)
    GLib.file_set_contents(`${HOME}/Documents/doc${i}.txt`, 'x');

const bf = new GLib.BookmarkFile();
const now = GLib.DateTime.new_now_utc();
for (let i = 1; i <= 6; i++) {
    const uri = Gio.File.new_for_path(`${HOME}/Documents/doc${i}.txt`).get_uri();
    bf.set_mime_type(uri, 'text/plain');
    bf.add_application(uri, 'gnome-text-editor', 'gnome-text-editor %u');
    bf.set_visited_date_time(uri, now.add_seconds(i - 100));
}
const furi = Gio.File.new_for_path(`${HOME}/Documents`).get_uri();
bf.set_mime_type(furi, 'inode/directory');
bf.add_application(furi, 'code', 'code %u');
bf.set_visited_date_time(furi, now);
bf.add_application(Gio.File.new_for_path(`${HOME}/Documents/missing.txt`).get_uri(), 'x', 'x %u');
bf.to_file(`${HOME}/.local/share/recently-used.xbel`);
sleep(3000); // recent-files debounce + monitor delivery

// --- Menu contents -------------------------------------------------------
let m = evalShell('rdMenu()');
print(`     menu: ${JSON.stringify(m)}`);
check('Settings is the first item', m?.[0] === 'RecentDock Settings');
const headings = items => items.filter(x => x.startsWith('# ') && x.length > 2).map(x => x.slice(2));
check('default section order', JSON.stringify(headings(m)) === JSON.stringify([
    'Recently Downloaded Folders', 'Recently Downloaded Files', 'Recently Opened Files', 'Recently Opened Folders']),
JSON.stringify(headings(m)));
check('downloaded files distinguished from folders',
    m.includes('report.pdf') && m.includes('photo.png') && m.includes('Album') && m.includes('Extracted'));
check('incomplete download never listed', !m.some(x => x.includes('.crdownload') || x.includes('.part')));
check('opened files limited to 3, newest first',
    JSON.stringify(m.slice(m.indexOf('# Recently Opened Files') + 1, m.indexOf('# Recently Opened Files') + 4)) ===
    JSON.stringify(['doc6.txt', 'doc5.txt', 'doc4.txt']));
check('missing recent file not shown', !m.includes('missing.txt'));
check('dock items kept below RecentDock items', m.includes('Unpin') || m.includes('App Details') || m.includes('Pin to Dash'));

// --- Settings changes apply immediately -----------------------------------
settings.set_strv('section-order', ['opened-files', 'opened-folders', 'downloaded-files', 'downloaded-folders']);
settings.set_boolean('downloaded-folders-enabled', false);
settings.set_int('opened-files-limit', 5);
settings.set_string('opened-files-sort', 'oldest');
sleep(500);
m = evalShell('rdMenu()');
check('reordered sections, Settings still first', m[0] === 'RecentDock Settings' &&
    JSON.stringify(headings(m)) === JSON.stringify(['Recently Opened Files', 'Recently Opened Folders', 'Recently Downloaded Files']),
JSON.stringify(headings(m)));
const of = m.indexOf('# Recently Opened Files');
check('limit 5 + oldest-first for one section only',
    JSON.stringify(m.slice(of + 1, of + 6)) === JSON.stringify(['doc2.txt', 'doc3.txt', 'doc4.txt', 'doc5.txt', 'doc6.txt']));
check('disabled section hidden completely', !m.includes('Album') && !headings(m).includes('Recently Downloaded Folders'));
settings.set_boolean('downloaded-folders-enabled', true);
sleep(300);
m = evalShell('rdMenu()');
check('re-enabled section restores history', m.includes('Album'));

// --- Clearing --------------------------------------------------------------
settings.set_int64('downloaded-files-cleared-at', Date.now());
sleep(300);
m = evalShell('rdMenu()');
check('clearing one section leaves the others', !m.includes('report.pdf') && m.includes('Album') && m.includes('doc6.txt'));
check('clearing does not delete files', GLib.file_test(`${DL}/report.pdf`, GLib.FileTest.EXISTS));

// --- Deleted paths ----------------------------------------------------------
GLib.rmdir(`${DL}/Album`);
sleep(300);
m = evalShell('rdMenu()');
check('deleted folder disappears without errors', !m.includes('Album') && m[0] === 'RecentDock Settings');

// --- Left click --------------------------------------------------------------
settings.set_string('left-click-action', 'downloaded-folder');
const before = evalShell('rdFind().app.state');
evalShell('rdFind().app.activate(); true');
sleep(500);
// More samples of left-click dispatch (a target-less action, so nothing launches).
settings.set_string('left-click-action', 'application');
settings.set_string('left-click-app', '');
sleep(200);
for (let i = 0; i < 20; i++)
    evalShell('rdFind().app.activate(); true');
sleep(300);
const status = JSON.parse(Gio.DBus.session.call_sync('org.gnome.Shell', '/io/github/legitforce/RecentDock',
    'io.github.legitforce.RecentDock', 'GetStatus', null, null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack()[0]);
check('left-click handled in-shell (no process launched)', status.timingsMs.click?.n === 21 && evalShell('rdFind().app.state') === before);
check('status reports sources without paths', status.sources.downloads === 'active' &&
    !JSON.stringify(status).includes(HOME), JSON.stringify(status.sources));

// --- Performance: menu open --------------------------------------------------
const perf = evalShell(`(() => {
    const icon = rdFind(); const t = [];
    for (let i = 0; i < 100; i++) {
        const t0 = GLib.get_monotonic_time();
        icon.popupMenu();
        t.push((GLib.get_monotonic_time() - t0) / 1000);
        icon._menu.close(0);
    }
    t.sort((a, b) => a - b);
    return {p50: t[50], p95: t[95], max: t[99]};
})()`);
print(`     full menu popup (dock + RecentDock) x100: p50=${perf.p50.toFixed(2)}ms p95=${perf.p95.toFixed(2)}ms max=${perf.max.toFixed(2)}ms`);
check('menu popup p95 < 100 ms', perf.p95 < 100);
const st2 = JSON.parse(Gio.DBus.session.call_sync('org.gnome.Shell', '/io/github/legitforce/RecentDock',
    'io.github.legitforce.RecentDock', 'GetStatus', null, null, Gio.DBusCallFlags.NONE, 2000, null).deepUnpack()[0]);
print(`     RecentDock part of menu build: ${JSON.stringify(st2.timingsMs.menu)}; left-click resolve: ${JSON.stringify(st2.timingsMs.click)}`);

// --- Disable / enable cycle ---------------------------------------------------
evalShell(`Main.extensionManager.disableExtension('${UUID}'); true`);
sleep(800);
const cycle = {items: evalShell('rdMenu()') ?? []};
evalShell(`Main.extensionManager.enableExtension('${UUID}'); true`);
check('disable removes all RecentDock menu items', !cycle.items.includes('RecentDock Settings'), JSON.stringify(cycle.items));
sleep(500);
check('re-enable works', evalShell('rdMenu()')[0] === 'RecentDock Settings');

// --- Persistence across restart (history file written) ------------------------
sleep(2500);
const hist = `${HOME}/.local/state/recentdock/history.json`;
check('history persisted to disk', GLib.file_test(hist, GLib.FileTest.EXISTS));

print(failures ? `\n${failures} check(s) FAILED` : '\nall nested-shell checks passed');
System.exit(failures ? 1 : 0);
