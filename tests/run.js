// SPDX-License-Identifier: GPL-3.0-or-later
// Run with: tests/run.sh   (sets a private GSettings backend and schema dir)

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

import {test, assert, assertEqual, run} from './harness.js';
import * as C from '../src/lib/config.js';
import * as H from '../src/lib/history.js';
import {isTemporaryName, DownloadsTracker} from '../src/lib/downloads.js';
import {parseRecent} from '../src/lib/recentFiles.js';
import {locationsToPaths} from '../src/lib/fileManager.js';
import {buildMenuModel, resolveLeftClick} from '../src/lib/model.js';
import {validateWebUrl, isAvailable} from '../src/lib/paths.js';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const DAY = 86400000;

// ---------- helpers ----------
function tmpdir() {
    return GLib.dir_make_tmp('recentdock-test-XXXXXX');
}
function writeFile(path, text = 'x') {
    GLib.file_set_contents(path, text);
}
function spin(ms) {
    // Run the main loop so file-monitor events are delivered.
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}
function rmrf(path) {
    Gio.Subprocess.new(['rm', '-rf', '--', path], Gio.SubprocessFlags.NONE).wait(null);
}
function newSettings() {
    const s = new Gio.Settings({schema_id: C.SCHEMA_ID});
    for (const k of s.settings_schema.list_keys())
        s.reset(k);
    return s;
}
const memStore = () => new H.HistoryStore(`${tmpdir()}/history.json`, 10);
const fakeSettings = values => ({
    get_boolean: k => values[k] ?? true,
    get_int: k => values[k] ?? 3,
    get_int64: k => values[k] ?? 0,
    get_string: k => values[k] ?? '',
    get_strv: k => values[k] ?? [],
});
const always = () => true;

// ---------- configuration ----------
test('schema defaults match the specification', () => {
    const cfg = C.readConfig(newSettings());
    assertEqual(cfg.order, ['downloaded-folders', 'downloaded-files', 'opened-files', 'opened-folders']);
    for (const id of C.SECTION_IDS) {
        assertEqual(cfg.sections[id], {enabled: true, limit: 3, sort: 'newest', clearedAt: 0}, id);
    }
    assertEqual(cfg.leftClick.action, 'download-directory');
    assertEqual(cfg.enabled, true);
});

test('schema rejects limits outside 3..5 and sanitizer maps 4 to default', () => {
    const s = newSettings();
    let threw = false;
    try {
        s.set_int('opened-files-limit', 10);
    } catch {
        threw = true;
    }
    // GSettings logs a critical and ignores out-of-range writes.
    assert(threw || s.get_int('opened-files-limit') === 3, 'out of range write applied');
    assertEqual(C.sanitizeLimit(4), 3);
    assertEqual(C.sanitizeLimit(5), 5);
});

test('normalizeOrder repairs corrupted orders', () => {
    assertEqual(C.normalizeOrder(['opened-files', 'bogus', 'opened-files']),
        ['opened-files', 'downloaded-folders', 'downloaded-files', 'opened-folders']);
    assertEqual(C.normalizeOrder(null), C.DEFAULT_ORDER);
    assertEqual(C.normalizeOrder([]), C.DEFAULT_ORDER);
});

test('moveSection reorders without losing sections', () => {
    const o = C.moveSection(C.DEFAULT_ORDER, 'opened-folders', 0);
    assertEqual(o, ['opened-folders', 'downloaded-folders', 'downloaded-files', 'opened-files']);
    assertEqual(C.moveSection(o, 'opened-folders', 99), C.DEFAULT_ORDER);
});

test('readConfig sanitizes corrupted values', () => {
    const cfg = C.readConfig(fakeSettings({
        'downloaded-files-limit': 99, 'opened-files-sort': 'sideways',
        'left-click-action': 'rm -rf', 'section-order': ['x'],
    }));
    assertEqual(cfg.sections['downloaded-files'].limit, 3);
    assertEqual(cfg.sections['opened-files'].sort, 'newest');
    assertEqual(cfg.leftClick.action, 'download-directory');
    assertEqual(cfg.order, C.DEFAULT_ORDER);
});

test('changing one section setting leaves others untouched', () => {
    const s = newSettings();
    const before = C.readConfig(s);
    s.set_int('opened-files-limit', 5);
    s.set_string('opened-files-sort', 'oldest');
    s.set_boolean('opened-files-enabled', false);
    s.set_strv('section-order', C.moveSection(before.order, 'opened-files', 0));
    const after = C.readConfig(s);
    for (const id of C.SECTION_IDS.filter(x => x !== 'opened-files'))
        assertEqual(after.sections[id], before.sections[id], id);
    assertEqual(after.sections['opened-files'], {enabled: false, limit: 5, sort: 'oldest', clearedAt: 0});
    assertEqual(after.order[0], 'opened-files');
});

// ---------- history ----------
test('dedupe keeps newest timestamp per canonical path', () => {
    const r = H.dedupe([
        {path: '/a/b', time: 1}, {path: '/a//b/', time: 5}, {path: '/a/./c', time: 3},
        {path: 'relative', time: 9}, {path: '/x', time: NaN},
    ]);
    assertEqual(r.map(e => [e.path, e.time]), [['/a/b', 5], ['/a/c', 3]]);
});

test('upsert caps retained entries', () => {
    let list = [];
    for (let i = 1; i <= 40; i++)
        list = H.upsert(list, {path: `/f${i}`, time: i});
    assertEqual(list.length, C.RETAINED_PER_SECTION);
    assertEqual(list[0].path, '/f40');
});

test('selectForDisplay: limit, sort and clear are independent', () => {
    const entries = [1, 2, 3, 4, 5, 6].map(i => ({path: `/f${i}`, time: i}));
    const pick = (o, ok = always) => H.selectForDisplay(entries, o, ok).map(e => e.path);
    assertEqual(pick({limit: 3, sort: 'newest'}), ['/f6', '/f5', '/f4']);
    assertEqual(pick({limit: 3, sort: 'oldest'}), ['/f4', '/f5', '/f6'], 'oldest-first shows same items reversed');
    assertEqual(pick({limit: 5, sort: 'newest'}), ['/f6', '/f5', '/f4', '/f3', '/f2']);
    assertEqual(pick({limit: 5, sort: 'newest', clearedAt: 4}), ['/f6', '/f5']);
    assertEqual(pick({limit: 3, sort: 'newest'}, e => e.path !== '/f5'), ['/f6', '/f4', '/f3'], 'missing items are skipped');
});

test('renamePath follows renamed files and folder contents', () => {
    const r = H.renamePath([{path: '/d/old', time: 2}, {path: '/d/old/inner', time: 1}], '/d/old', '/d/new');
    assertEqual(r.map(e => e.path), ['/d/new', '/d/new/inner']);
});

test('parseStore tolerates corrupted and partial data', () => {
    assertEqual(H.parseStore('{not json').ok, false);
    assertEqual(H.parseStore('[]').ok, false);
    const {data, ok} = H.parseStore(JSON.stringify({sections: {'downloaded-files': [{path: '/a', time: 1}, 'junk']}}));
    assert(ok);
    assertEqual(data.sections['downloaded-files'].length, 1);
    assertEqual(data.sections['downloaded-folders'], []);
});

test('HistoryStore persists across instances and backs up corrupted files', () => {
    const dir = tmpdir();
    const path = `${dir}/sub/history.json`;
    const a = new H.HistoryStore(path, 10);
    a.add('downloaded-files', {path: '/tmp/x.pdf', time: 100, source: 't'});
    a.flush();
    const b = new H.HistoryStore(path).load();
    assertEqual(b.get('downloaded-files').map(e => e.path), ['/tmp/x.pdf']);
    writeFile(path, '{garbage');
    const c = new H.HistoryStore(path).load();
    assertEqual(c.loadError, 'corrupted');
    assert(GLib.file_test(`${path}.corrupt`, GLib.FileTest.EXISTS), 'backup kept');
    assertEqual(c.get('downloaded-files'), []);
    rmrf(dir);
});

test('clearing one section keeps the others and never touches files', () => {
    const dir = tmpdir();
    const f = `${dir}/keep.txt`;
    writeFile(f);
    const s = memStore();
    s.add('downloaded-files', {path: f, time: 10});
    s.add('downloaded-folders', {path: dir, time: 10});
    s.forgetBefore('downloaded-files', 20);
    assertEqual(s.get('downloaded-files'), []);
    assertEqual(s.get('downloaded-folders').length, 1);
    assert(GLib.file_test(f, GLib.FileTest.EXISTS), 'file must survive clearing');
    rmrf(dir);
});

// ---------- downloads ----------
test('temporary download names are recognised', () => {
    for (const n of ['a.crdownload', 'Unconfirmed 123.crdownload', 'a.pdf.part', '.com.google.Chrome.ab12', '.fr-x1', 'x~', 'b.!qB'])
        assert(isTemporaryName(n), n);
    for (const n of ['report.pdf', 'photo.png', 'archive.zip', 'setup.deb', 'My Folder'])
        assert(!isTemporaryName(n), n);
});

test('downloads monitor: Chrome, Firefox, wget, folders, extraction', () => {
    const dir = tmpdir();
    const store = memStore();
    store.markScanned(Date.now()); // not a first run: skip seeding
    const t = new DownloadsTracker(store, dir);
    t.start();
    spin(200);
    assertEqual(t.status, 'active');

    // Chrome: .crdownload then rename.
    writeFile(`${dir}/Unconfirmed 1.crdownload`, 'data');
    spin(150);
    assertEqual(store.get('downloaded-files'), [], 'incomplete Chrome download not listed');
    GLib.rename(`${dir}/Unconfirmed 1.crdownload`, `${dir}/report.pdf`);
    spin(150);

    // Firefox: empty placeholder + .part, then rename .part over placeholder.
    writeFile(`${dir}/photo.png`, '');
    writeFile(`${dir}/photo.png.part`, 'img');
    spin(150);
    assert(!store.get('downloaded-files').some(e => e.path.endsWith('photo.png')), 'Firefox placeholder not listed early');
    GLib.rename(`${dir}/photo.png.part`, `${dir}/photo.png`);
    spin(150);

    // wget/curl: written directly.
    writeFile(`${dir}/archive.zip`, 'zip');
    spin(1500); // CHANGES_DONE_HINT may be delayed

    // Folder created by extraction tools (directly, or via hidden temp dir).
    GLib.mkdir_with_parents(`${dir}/Extracted`, 0o755);
    GLib.mkdir_with_parents(`${dir}/.fr-abc123/inner`, 0o755);
    spin(150);
    GLib.rename(`${dir}/.fr-abc123`, `${dir}/Album`);
    // Files inside a downloaded folder are not separate downloads.
    writeFile(`${dir}/Extracted/inside.txt`);
    spin(1500);

    const files = store.get('downloaded-files').map(e => GLib.path_get_basename(e.path)).sort();
    const folders = store.get('downloaded-folders').map(e => GLib.path_get_basename(e.path)).sort();
    assertEqual(files, ['archive.zip', 'photo.png', 'report.pdf']);
    assertEqual(folders, ['Album', 'Extracted']);

    // Rename of a tracked file keeps its history under the new name.
    GLib.rename(`${dir}/report.pdf`, `${dir}/report-renamed.pdf`);
    spin(200);
    const after = store.get('downloaded-files').map(e => GLib.path_get_basename(e.path));
    assert(after.includes('report-renamed.pdf') && !after.includes('report.pdf'), `rename followed: ${after}`);
    t.stop();
    rmrf(dir);
});

test('downloads catch-up picks up items added while not running', () => {
    const dir = tmpdir();
    const store = memStore();
    store.markScanned(Date.now() - DAY);
    writeFile(`${dir}/offline.iso`);
    writeFile(`${dir}/still.crdownload`);
    GLib.mkdir_with_parents(`${dir}/OfflineFolder`, 0o755);
    const t = new DownloadsTracker(store, dir);
    t.start();
    spin(400);
    assertEqual(store.get('downloaded-files').map(e => GLib.path_get_basename(e.path)), ['offline.iso']);
    assertEqual(store.get('downloaded-folders').map(e => GLib.path_get_basename(e.path)), ['OfflineFolder']);
    t.stop();
    rmrf(dir);
});

test('downloads tracker reports a missing Downloads folder without throwing', () => {
    const t = new DownloadsTracker(memStore(), '/nonexistent/recentdock');
    t.start();
    assert(t.status.startsWith('unavailable'), t.status);
});

// ---------- recent files ----------
test('recent-files parsing separates files and folders, skips screenshots and remote URIs', () => {
    const [, bytes] = GLib.file_get_contents(`${here}/fixtures/recently-used.xbel`);
    const r = parseRecent(bytes);
    assertEqual(r.files.map(e => e.path), ['/home/test/Documents/notes.txt', '/home/test/Documents/report final.pdf']);
    assertEqual(r.folders.map(e => e.path), ['/home/test/Projects']);
    const withShots = parseRecent(bytes, {excludeScreenshots: false});
    assertEqual(withShots.files[0].path, '/home/test/Pictures/Screenshots/Screenshot.png');
});

test('recent-files parsing rejects corrupted data', () => {
    let threw = false;
    try {
        parseRecent('<xbel><bookmark');
    } catch {
        threw = true;
    }
    assert(threw, 'corrupted xbel should throw so the source keeps its previous list');
});

test('file manager locations: only local folders', () => {
    assertEqual(locationsToPaths(['file:///home/u/Projects', 'trash:///', 'sftp://h/x', 'file:///home/u/A%20B', 'file:///home/u/Projects']),
        ['/home/u/Projects', '/home/u/A B']);
});

// ---------- menu model ----------
function sources() {
    const store = memStore();
    for (let i = 1; i <= 6; i++) {
        store.add('downloaded-files', {path: `/dl/file${i}`, time: i * 10});
        store.add('downloaded-folders', {path: `/dl/folder${i}`, time: i * 10});
    }
    store.add('opened-folders', {path: '/home/u/Visited', time: 100});
    return {store, recent: {
        files: [{path: '/home/u/a.txt', time: 50}, {path: '/home/u/b.txt', time: 40}],
        folders: [{path: '/home/u/Visited', time: 20}, {path: '/home/u/Old', time: 10}],
    }};
}

test('menu: default order and per-section limits', () => {
    const m = buildMenuModel(C.readConfig(newSettings()), sources(), always);
    assertEqual(m.map(s => s.id), C.DEFAULT_ORDER);
    assertEqual(m[0].entries.map(e => e.path), ['/dl/folder6', '/dl/folder5', '/dl/folder4']);
    assertEqual(m[3].entries.map(e => e.path), ['/home/u/Visited', '/home/u/Old'], 'deduplicated across sources');
});

test('menu: order, visibility, limit and sort follow settings independently', () => {
    const s = newSettings();
    s.set_strv('section-order', ['opened-files', 'opened-folders', 'downloaded-files', 'downloaded-folders']);
    s.set_boolean('opened-folders-enabled', false);
    s.set_int('downloaded-files-limit', 5);
    s.set_string('downloaded-folders-sort', 'oldest');
    const m = buildMenuModel(C.readConfig(s), sources(), always);
    assertEqual(m.map(x => x.id), ['opened-files', 'downloaded-files', 'downloaded-folders']);
    assertEqual(m[1].entries.length, 5);
    assertEqual(m[2].entries.map(e => e.path), ['/dl/folder4', '/dl/folder5', '/dl/folder6']);
    s.set_boolean('opened-folders-enabled', true);
    const again = buildMenuModel(C.readConfig(s), sources(), always);
    assert(again.some(x => x.id === 'opened-folders'), 're-enabled section restores its history');
});

test('menu: empty, missing and disabled', () => {
    const cfg = C.readConfig(newSettings());
    const empty = {store: memStore(), recent: {files: [], folders: []}};
    assertEqual(buildMenuModel(cfg, empty, always), [], 'no headings for empty sections');
    assertEqual(buildMenuModel(cfg, sources(), () => false), [], 'all paths missing');
    assertEqual(buildMenuModel({...cfg, enabled: false}, sources(), always), []);
});

test('menu: clearing a section hides only that section', () => {
    const s = newSettings();
    s.set_int64('downloaded-files-cleared-at', 1000);
    const m = buildMenuModel(C.readConfig(s), sources(), always);
    assertEqual(m.map(x => x.id), ['downloaded-folders', 'opened-files', 'opened-folders']);
});

test('menu: real paths are validated for existence and type', () => {
    const dir = tmpdir();
    writeFile(`${dir}/f.txt`);
    assert(isAvailable(`${dir}/f.txt`, false));
    assert(!isAvailable(`${dir}/f.txt`, true), 'a file is not a folder');
    assert(isAvailable(dir, true));
    assert(!isAvailable(`${dir}/gone`, false));
    assert(!isAvailable('relative/path', false));
    rmrf(dir);
});

// ---------- left-click ----------
test('left-click resolves every action and fails gracefully', () => {
    const s = newSettings();
    const src = sources();
    const res = () => resolveLeftClick(C.readConfig(s), src, always);
    assertEqual(res(), {kind: 'show-item', target: '/dl/file6'});
    s.set_string('left-click-action', 'downloaded-folder');
    assertEqual(res(), {kind: 'open-folder', target: '/dl/folder6'});
    s.set_string('left-click-action', 'visited-folder');
    assertEqual(res(), {kind: 'open-folder', target: '/home/u/Visited'});
    s.set_string('left-click-action', 'opened-file');
    assertEqual(res(), {kind: 'open-file', target: '/home/u/a.txt'});
    s.set_boolean('opened-files-enabled', false);
    assertEqual(res().kind, 'open-file', 'independent of menu visibility');
    s.set_string('left-click-action', 'url');
    assertEqual(res().kind, 'none');
    s.set_string('left-click-url', 'example.com/x');
    assertEqual(res(), {kind: 'open-url', target: 'https://example.com/x'});
    s.set_string('left-click-action', 'application');
    s.set_string('left-click-app', 'org.gnome.Nautilus.desktop');
    assertEqual(res(), {kind: 'launch-app', target: 'org.gnome.Nautilus.desktop'});
    s.set_string('left-click-app', '; rm -rf ~');
    assertEqual(res().kind, 'none');
    s.set_string('left-click-action', 'download-directory');
    assertEqual(resolveLeftClick(C.readConfig(s), {store: memStore(), recent: {files: [], folders: []}}, always).kind, 'none');
});

test('URL validation allows only http(s) with a host', () => {
    assertEqual(validateWebUrl('https://gnome.org'), 'https://gnome.org');
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'http://', 'a b', '', 'smb://host/share'])
        assertEqual(validateWebUrl(bad), null, bad);
});

// ---------- performance ----------
test('performance: menu model with large histories', () => {
    const store = memStore();
    for (let i = 0; i < 1000; i++)
        store.add('downloaded-files', {path: `/dl/f${i}`, time: i});
    const recent = {files: [], folders: []};
    for (let i = 0; i < 5000; i++)
        recent.files.push({path: `/home/u/f${i}`, time: 5000 - i});
    const cfg = C.readConfig(newSettings());
    const times = [];
    for (let i = 0; i < 200; i++) {
        const t0 = GLib.get_monotonic_time();
        buildMenuModel(cfg, {store, recent}, always);
        times.push((GLib.get_monotonic_time() - t0) / 1000);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    print(`     menu model p50=${times[100].toFixed(2)}ms p95=${p95.toFixed(2)}ms (5000 recent files)`);
    assert(p95 < 100, `p95 ${p95}ms`);
});

const failed = await run();
System.exit(failed ? 1 : 0);
