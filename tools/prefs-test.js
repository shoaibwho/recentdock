// SPDX-License-Identifier: GPL-3.0-or-later
// Loads the real prefs.js in a standalone GTK process (as the Extensions app
// does), renders each page to PNG, and exercises the controls by emitting
// their signals. Run by tools/nested-test.sh against the nested compositor;
// no synthetic input events are generated.
//   gjs -m tools/prefs-test.js <extension-dir> <png-output-dir>

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();

const [extDir, outDir] = ARGV;
const metadata = JSON.parse(new TextDecoder().decode(
    GLib.file_get_contents(`${extDir}/metadata.json`)[1]));
metadata.path = extDir;
metadata.dir = Gio.File.new_for_path(extDir);
const {default: Prefs} = await import(`file://${extDir}/prefs.js`);

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`${cond ? 'ok  ' : 'FAIL'} prefs: ${name}${detail ? `  [${detail}]` : ''}`);
    if (!cond)
        failures++;
};
const spin = ms => {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
};
function* walk(w) {
    yield w;
    for (let c = w.get_first_child(); c; c = c.get_next_sibling())
        yield* walk(c);
}
function shoot(widget, name) {
    const w = widget.get_width(), h = widget.get_height();
    const snap = new Gtk.Snapshot();
    new Gtk.WidgetPaintable({widget}).snapshot(snap, w, h);
    const tex = widget.get_native().get_renderer().render_texture(snap.to_node(), null);
    tex.save_to_png(`${outDir}/prefs-${name}.png`);
}

Adw.init();
const app = new Adw.Application({application_id: 'io.github.legitforce.RecentDockPrefsTest'});
app.connect('activate', () => {
    const prefs = new Prefs(metadata);
    const settings = prefs.getSettings();
    for (const k of settings.settings_schema.list_keys())
        settings.reset(k);
    const window = new Adw.PreferencesWindow({application: app});
    prefs.fillPreferencesWindow(window);
    window.present();
    spin(800);

    const pages = [...walk(window)].filter(w => w instanceof Adw.PreferencesPage && w.title);
    check('five pages', pages.length === 5, pages.map(p => p.title).join(', '));
    for (const p of pages) {
        window.set_visible_page(p);
        spin(300);
        shoot(window, p.title.toLowerCase().replace(/\s+/g, '-'));
    }

    // --- Menu Layout page: rows, drag-and-drop handler, arrow buttons ---------
    const layout = pages.find(p => p.title === 'Menu Layout');
    window.set_visible_page(layout); // rows must be allocated to compute drop halves
    spin(300);
    const rows = () => [...walk(layout)].filter(w => w instanceof Adw.ActionRow && w.subtitle.startsWith('Position'));
    check('layout rows in default order', JSON.stringify(rows().map(r => r.title)) === JSON.stringify(
        ['Recently Downloaded Folders', 'Recently Downloaded Files', 'Recently Opened Files', 'Recently Opened Folders']));
    check('drag handles shown', rows().every(r => [...walk(r)].some(w => w instanceof Gtk.Image && w.icon_name === 'list-drag-handle-symbolic')));

    const controllers = (row, type) => {
        const out = [];
        const lm = row.observe_controllers();
        for (let i = 0; i < lm.get_n_items(); i++) {
            const c = lm.get_item(i);
            if (c instanceof type)
                out.push(c);
        }
        return out;
    };
    // Drag "Recently Opened Folders" (last) and drop on the top half of the first row.
    const src = rows()[3];
    const content = controllers(src, Gtk.DragSource)[0].emit('prepare', 5, 5);
    check('drag source offers a string payload', content?.ref_formats().contain_gtype(GObject.TYPE_STRING));
    const value = 'opened-folders'; // the payload of that row (see prefs.js 'prepare')
    const target = controllers(rows()[0], Gtk.DropTarget)[0];
    const accepted = target.emit('drop', value, 10, 2);
    spin(200);
    check('drop handler accepted the section', accepted === true);
    check('drag-and-drop updates order setting', JSON.stringify(settings.get_strv('section-order')) === JSON.stringify(
        ['opened-folders', 'downloaded-folders', 'downloaded-files', 'opened-files']), settings.get_strv('section-order'));
    check('list rebuilt in new order', rows()[0].title === 'Recently Opened Folders');

    // Drop on the bottom half of the last row moves it to the end.
    const v2 = 'opened-folders';
    const last = rows()[3];
    controllers(last, Gtk.DropTarget)[0].emit('drop', v2, 10, last.get_height() - 2);
    spin(200);
    check('drop below last row moves to end', settings.get_strv('section-order').at(-1) === 'opened-folders',
        `${settings.get_strv('section-order')} h=${last.get_height()} rows=${rows().map(r => r.title)}`);

    // Arrow buttons (keyboard-accessible alternative to dragging).
    const upButton = [...walk(rows()[3])].find(w => w instanceof Gtk.Button && w.icon_name === 'go-up-symbolic');
    upButton.emit('clicked');
    spin(200);
    check('move-up button', settings.get_strv('section-order')[2] === 'opened-folders', settings.get_strv('section-order'));
    settings.reset('section-order');

    // Limit toggle and switch on one row affect only that section.
    const row1 = rows()[1];
    const five = [...walk(row1)].find(w => w instanceof Gtk.ToggleButton && w.label === '5');
    five.active = true;
    const sw = [...walk(row1)].find(w => w instanceof Gtk.Switch);
    sw.active = false;
    spin(200);
    check('limit toggle sets only that section', settings.get_int('downloaded-files-limit') === 5 &&
        settings.get_int('downloaded-folders-limit') === 3 && settings.get_int('opened-files-limit') === 3);
    check('section switch sets only that section', !settings.get_boolean('downloaded-files-enabled') &&
        settings.get_boolean('downloaded-folders-enabled'));
    window.set_visible_page(layout);
    spin(300);
    shoot(window, 'menu-layout-after-changes');
    for (const k of ['downloaded-files-limit', 'downloaded-files-enabled'])
        settings.reset(k);

    // URL validation in the entry row.
    const general = pages[0];
    const combo = [...walk(general)].find(w => w instanceof Adw.ComboRow);
    combo.selected = 4;
    spin(100);
    check('left-click combo writes setting', settings.get_string('left-click-action') === 'url');
    const entry = [...walk(general)].find(w => w instanceof Adw.EntryRow);
    check('URL row shown for url action', entry.visible);
    entry.text = 'javascript:alert(1)';
    entry.emit('apply');
    check('invalid URL rejected', settings.get_string('left-click-url') === '' && entry.has_css_class('error'));
    entry.text = 'gnome.org';
    entry.emit('apply');
    check('valid URL normalised and saved', settings.get_string('left-click-url') === 'https://gnome.org');
    settings.reset('left-click-action');
    settings.reset('left-click-url');

    // Clear button opens a confirmation; nothing is cleared until confirmed.
    const sections = pages.find(p => p.title === 'Sections');
    const clearBtn = [...walk(sections)].find(w => w instanceof Gtk.Button && w.label === 'Clear…');
    clearBtn.emit('clicked');
    spin(400);
    check('clear asks for confirmation first', settings.get_int64('downloaded-folders-cleared-at') === 0);
    const dialog = [...walk(window)].find(w => w instanceof (Adw.AlertDialog ?? Adw.MessageDialog));
    if (dialog) {
        shoot(window, 'clear-confirmation');
        dialog.emit('response', 'ok');
        spin(100);
    }
    check('confirming clears exactly one section', settings.get_int64('downloaded-folders-cleared-at') > 0 &&
        settings.get_int64('downloaded-files-cleared-at') === 0);

    window.close();
    app.quit();
});
app.run([]);
System.exit(failures ? 1 : 0);
