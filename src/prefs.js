// SPDX-License-Identifier: GPL-3.0-or-later
// RecentDock Settings window.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js';

import {
    ALLOWED_LIMITS, DBUS_IFACE, DBUS_PATH, LEFT_CLICK_ACTIONS, LEFT_CLICK_LABELS,
    SECTION_IDS, SECTION_TITLES, SORT_NEWEST, SORT_OLDEST, key, moveSection,
    normalizeOrder, sanitizeLimit,
} from './lib/config.js';
import {validateWebUrl} from './lib/paths.js';
import {getDownloadDir} from './lib/downloads.js';
import {defaultRecentPath} from './lib/recentFiles.js';
import {defaultStorePath} from './lib/history.js';

const SOURCE_INFO = {
    'downloaded-folders': 'Folders that appear directly in your Downloads folder — for example a ' +
        'folder created by “Extract Here”, by unzip, or moved there. Folders extracted elsewhere ' +
        'are not detected.',
    'downloaded-files': 'Files completed in your Downloads folder. Recognises Chrome, Chromium, ' +
        'Brave, Edge and Firefox temporary files (.crdownload, .part), and files written ' +
        'directly by tools such as wget. Downloads saved to other folders are not detected.',
    'opened-files': 'Your desktop’s recent-files list (recently-used.xbel), written by GTK and ' +
        'GNOME apps, LibreOffice, file choosers and many others. Apps that do not register ' +
        'recent files (some Electron, Qt or terminal apps) are not covered.',
    'opened-folders': 'Folders you visit in Files (Nautilus), folders opened through RecentDock, ' +
        'and folders in the recent-files list (e.g. chosen in an “Open Folder” dialog). Other ' +
        'file managers and terminals are not covered.',
};

function callShell(method, cb) {
    Gio.DBus.session.call('org.gnome.Shell', DBUS_PATH, DBUS_IFACE, method, null,
        null, Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
            try {
                cb(conn.call_finish(res).deepUnpack());
            } catch {
                cb(null);
            }
        });
}

function confirm(parent, heading, body, actionLabel, onConfirm) {
    if (Adw.AlertDialog) {
        const d = new Adw.AlertDialog({heading, body});
        d.add_response('cancel', 'Cancel');
        d.add_response('ok', actionLabel);
        d.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
        d.set_default_response('cancel');
        d.set_close_response('cancel');
        d.connect('response', (_d, r) => r === 'ok' && onConfirm());
        d.present(parent);
    } else {
        const d = new Adw.MessageDialog({heading, body, transient_for: parent, modal: true});
        d.add_response('cancel', 'Cancel');
        d.add_response('ok', actionLabel);
        d.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
        d.set_default_response('cancel');
        d.set_close_response('cancel');
        d.connect('response', (_d, r) => r === 'ok' && onConfirm());
        d.present();
    }
}

function toast(window, title) {
    window.add_toast?.(new Adw.Toast({title, timeout: 3}));
}

/** A linked "3 | 5" toggle bound to a section's limit key. */
function limitSelector(settings, id) {
    const box = new Gtk.Box({css_classes: ['linked'], valign: Gtk.Align.CENTER});
    const buttons = ALLOWED_LIMITS.map(n => {
        const b = new Gtk.ToggleButton({label: String(n), tooltip_text: `Show ${n} items`});
        b.update_property([Gtk.AccessibleProperty.LABEL],
            [`${SECTION_TITLES[id]}: show ${n} items`]);
        box.append(b);
        return b;
    });
    buttons[1].set_group(buttons[0]);
    const sync = () => {
        const v = sanitizeLimit(settings.get_int(key(id, 'limit')));
        buttons.forEach((b, i) => {
            if (b.active !== (ALLOWED_LIMITS[i] === v))
                b.active = ALLOWED_LIMITS[i] === v;
        });
    };
    buttons.forEach((b, i) => b.connect('toggled', () => {
        if (b.active && settings.get_int(key(id, 'limit')) !== ALLOWED_LIMITS[i])
            settings.set_int(key(id, 'limit'), ALLOWED_LIMITS[i]);
    }));
    const hid = settings.connect(`changed::${key(id, 'limit')}`, sync);
    box.connect('destroy', () => settings.disconnect(hid));
    sync();
    return box;
}

export default class RecentDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings; // keep alive with the window
        window.set_default_size(720, 760);
        window.set_search_enabled(true);

        window.add(this._generalPage(window, settings));
        window.add(this._layoutPage(window, settings));
        window.add(this._sectionsPage(window, settings));
        window.add(this._historyPage(window, settings));
        window.add(this._diagnosticsPage(window, settings));
    }

    // ---- General ----------------------------------------------------------

    _generalPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});

        const main = new Adw.PreferencesGroup();
        const enabled = new Adw.SwitchRow({
            title: 'Enable RecentDock',
            subtitle: 'When off, the menu shows only Settings and tracking still keeps your history',
        });
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        main.add(enabled);
        page.add(main);

        const click = new Adw.PreferencesGroup({
            title: 'Left-Click Action',
            description: 'What happens when you click the RecentDock icon in the dock',
        });
        const actionRow = new Adw.ComboRow({
            title: 'Action',
            model: Gtk.StringList.new(LEFT_CLICK_ACTIONS.map(a => LEFT_CLICK_LABELS[a])),
        });
        const syncAction = () => {
            const i = LEFT_CLICK_ACTIONS.indexOf(settings.get_string('left-click-action'));
            actionRow.selected = Math.max(0, i);
        };
        syncAction();
        actionRow.connect('notify::selected', () => {
            const a = LEFT_CLICK_ACTIONS[actionRow.selected];
            if (a && a !== settings.get_string('left-click-action'))
                settings.set_string('left-click-action', a);
        });
        settings.connect('changed::left-click-action', syncAction);
        click.add(actionRow);

        const urlRow = new Adw.EntryRow({title: 'Web address (http or https)', show_apply_button: true});
        urlRow.text = settings.get_string('left-click-url');
        urlRow.connect('apply', () => {
            const u = validateWebUrl(urlRow.text);
            if (u) {
                urlRow.text = u;
                settings.set_string('left-click-url', u);
                urlRow.remove_css_class('error');
                toast(window, 'Web address saved');
            } else {
                urlRow.add_css_class('error');
                toast(window, 'Enter a valid http:// or https:// address');
            }
        });
        click.add(urlRow);

        const appRow = new Adw.ActionRow({title: 'Application'});
        const appLabel = new Gtk.Label({css_classes: ['dim-label'], ellipsize: 3});
        const syncApp = () => {
            const id = settings.get_string('left-click-app');
            const info = id ? Gio.DesktopAppInfo.new(id) : null;
            appLabel.label = info ? info.get_display_name() : id ? 'Not installed' : 'None selected';
        };
        syncApp();
        settings.connect('changed::left-click-app', syncApp);
        const chooseBtn = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
        chooseBtn.connect('clicked', () => this._chooseApp(window, settings));
        appRow.add_suffix(appLabel);
        appRow.add_suffix(chooseBtn);
        appRow.activatable_widget = chooseBtn;
        click.add(appRow);

        const syncVisible = () => {
            const a = settings.get_string('left-click-action');
            urlRow.visible = a === 'url';
            appRow.visible = a === 'application';
        };
        syncVisible();
        settings.connect('changed::left-click-action', syncVisible);
        page.add(click);

        const status = new Adw.PreferencesGroup({title: 'Tracking Status'});
        const rows = {
            extension: new Adw.ActionRow({title: 'RecentDock extension'}),
            downloads: new Adw.ActionRow({title: 'Downloads folder monitor'}),
            recentFiles: new Adw.ActionRow({title: 'Recent files list'}),
            fileManager: new Adw.ActionRow({title: 'Files (Nautilus) folder visits'}),
        };
        Object.values(rows).forEach(r => {
            r.subtitle_selectable = true;
            status.add(r);
        });
        const refresh = new Gtk.Button({
            icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Refresh history', css_classes: ['flat'],
        });
        const update = () => callShell('GetStatus', res => {
            if (!res) {
                rows.extension.subtitle = 'Not running. Enable it with the Extensions app, or log out and back in after installing.';
                for (const k of ['downloads', 'recentFiles', 'fileManager'])
                    rows[k].subtitle = 'Unknown (extension not running)';
                return;
            }
            const s = JSON.parse(res[0]);
            rows.extension.subtitle = `Running, version ${s.version}`;
            rows.downloads.subtitle = s.sources.downloads;
            rows.recentFiles.subtitle = s.sources.recentFiles;
            rows.fileManager.subtitle = s.sources.fileManager;
        });
        refresh.connect('clicked', () => {
            settings.set_int64('refresh-request', Date.now());
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                update();
                return GLib.SOURCE_REMOVE;
            });
            toast(window, 'History refreshed');
        });
        status.set_header_suffix(refresh);
        update();
        page.add(status);
        return page;
    }

    _chooseApp(window, settings) {
        const dialog = new Adw.Window({
            title: 'Choose an Application', modal: true, transient_for: window,
            default_width: 420, default_height: 560,
        });
        const view = new Adw.ToolbarView();
        view.add_top_bar(new Adw.HeaderBar());
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12,
            margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12});
        const search = new Gtk.SearchEntry({placeholder_text: 'Search applications'});
        const list = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
        const apps = Gio.AppInfo.get_all()
            .filter(a => a.should_show() && a.get_id() && a.get_id() !== 'recentdock.desktop')
            .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
        for (const app of apps) {
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(app.get_display_name(), -1), activatable: true});
            row.add_prefix(new Gtk.Image({gicon: app.get_icon() ?? Gio.ThemedIcon.new('application-x-executable'), pixel_size: 32}));
            row._name = app.get_display_name().toLowerCase();
            row.connect('activated', () => {
                settings.set_string('left-click-app', app.get_id());
                dialog.close();
            });
            list.append(row);
        }
        list.set_filter_func(row => row._name.includes(search.text.toLowerCase()));
        search.connect('search-changed', () => list.invalidate_filter());
        box.append(search);
        box.append(new Gtk.ScrolledWindow({child: list, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER}));
        view.content = box;
        dialog.content = view;
        dialog.present();
    }

    // ---- Menu layout (drag and drop) --------------------------------------

    _layoutPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'Menu Layout', icon_name: 'view-list-symbolic'});

        const fixed = new Adw.PreferencesGroup({
            title: 'Right-Click Menu',
            description: '“RecentDock Settings” always stays first. Drag the sections below to reorder them, ' +
                'or use the arrow buttons.',
        });
        const settingsRow = new Adw.ActionRow({title: 'RecentDock Settings', subtitle: 'Always first'});
        settingsRow.add_prefix(new Gtk.Image({icon_name: 'preferences-system-symbolic'}));
        fixed.add(settingsRow);
        page.add(fixed);

        const group = new Adw.PreferencesGroup({title: 'Sections'});
        const list = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
        group.add(list);
        page.add(group);

        const order = () => normalizeOrder(settings.get_strv('section-order'));
        const setOrder = o => settings.set_strv('section-order', o);

        const rebuild = () => {
            let child;
            while ((child = list.get_first_child()))
                list.remove(child);
            const o = order();
            o.forEach((id, index) => list.append(this._layoutRow(settings, id, index, o.length, setOrder, order)));
        };
        rebuild();
        const hid = settings.connect('changed::section-order', rebuild);
        page.connect('destroy', () => settings.disconnect(hid));

        const reset = new Gtk.Button({label: 'Reset Order', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        reset.connect('clicked', () => settings.reset('section-order'));
        group.set_header_suffix(reset);
        return page;
    }

    _layoutRow(settings, id, index, count, setOrder, order) {
        const row = new Adw.ActionRow({title: SECTION_TITLES[id], subtitle: `Position ${index + 1}`});
        const handle = new Gtk.Image({icon_name: 'list-drag-handle-symbolic', css_classes: ['dim-label'],
            tooltip_text: 'Drag to reorder'});
        row.add_prefix(handle);

        const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
            sensitive: index > 0, tooltip_text: 'Move up'});
        const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'],
            sensitive: index < count - 1, tooltip_text: 'Move down'});
        up.update_property([Gtk.AccessibleProperty.LABEL], [`Move ${SECTION_TITLES[id]} up`]);
        down.update_property([Gtk.AccessibleProperty.LABEL], [`Move ${SECTION_TITLES[id]} down`]);
        up.connect('clicked', () => setOrder(moveSection(order(), id, index - 1)));
        down.connect('clicked', () => setOrder(moveSection(order(), id, index + 1)));

        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: 'Show this section'});
        sw.update_property([Gtk.AccessibleProperty.LABEL], [`Show ${SECTION_TITLES[id]}`]);
        settings.bind(key(id, 'enabled'), sw, 'active', Gio.SettingsBindFlags.DEFAULT);

        row.add_suffix(limitSelector(settings, id));
        row.add_suffix(sw);
        row.add_suffix(up);
        row.add_suffix(down);

        // Drag source: the whole row; payload is the section id.
        const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        drag.connect('prepare', (_s, x, y) => {
            row._dragX = x;
            row._dragY = y;
            return Gdk.ContentProvider.new_for_value(id);
        });
        drag.connect('drag-begin', () => {
            drag.set_icon(new Gtk.WidgetPaintable({widget: row}), row._dragX, row._dragY);
        });
        row.add_controller(drag);

        const drop = new Gtk.DropTarget({actions: Gdk.DragAction.MOVE});
        drop.set_gtypes([GObject.TYPE_STRING]);
        drop.connect('enter', () => {
            row.add_css_class('accent');
            return Gdk.DragAction.MOVE;
        });
        drop.connect('leave', () => row.remove_css_class('accent'));
        drop.connect('drop', (_t, value, _x, y) => {
            row.remove_css_class('accent');
            if (typeof value !== 'string' || !SECTION_IDS.includes(value) || value === id)
                return false;
            const o = order();
            const from = o.indexOf(value);
            // Dropping on the lower half of a row places the item after it.
            let target = y > row.get_height() / 2 ? index + 1 : index;
            if (from < target)
                target -= 1;
            setOrder(moveSection(o, value, target));
            return true;
        });
        row.add_controller(drop);
        return row;
    }

    // ---- Per-section settings ---------------------------------------------

    _sectionsPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'Sections', icon_name: 'folder-symbolic'});
        for (const id of SECTION_IDS) {
            const group = new Adw.PreferencesGroup({title: SECTION_TITLES[id]});

            const en = new Adw.SwitchRow({title: 'Show in menu', subtitle: 'Hiding keeps the history'});
            settings.bind(key(id, 'enabled'), en, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(en);

            const limit = new Adw.ActionRow({title: 'Items shown'});
            const sel = limitSelector(settings, id);
            limit.add_suffix(sel);
            group.add(limit);

            const sort = new Adw.ComboRow({
                title: 'Order',
                subtitle: 'Which items are shown is the same either way: the most recent ones',
                model: Gtk.StringList.new(['Newest first', 'Oldest first']),
            });
            const k = key(id, 'sort');
            const syncSort = () => {
                sort.selected = settings.get_string(k) === SORT_OLDEST ? 1 : 0;
            };
            syncSort();
            sort.connect('notify::selected', () => {
                const v = sort.selected === 1 ? SORT_OLDEST : SORT_NEWEST;
                if (settings.get_string(k) !== v)
                    settings.set_string(k, v);
            });
            settings.connect(`changed::${k}`, syncSort);
            group.add(sort);

            const info = new Adw.ExpanderRow({title: 'Tracking source', subtitle: 'What is and is not detected'});
            const infoLabel = new Gtk.Label({label: SOURCE_INFO[id], wrap: true, xalign: 0,
                margin_top: 12, margin_bottom: 12, margin_start: 12, margin_end: 12});
            info.add_row(infoLabel);
            group.add(info);

            const clear = new Adw.ActionRow({title: 'Clear history', subtitle: 'Your files and folders are not touched'});
            const btn = new Gtk.Button({label: 'Clear…', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
            btn.connect('clicked', () => this._confirmClear(window, settings, [id]));
            clear.add_suffix(btn);
            group.add(clear);

            page.add(group);
        }
        return page;
    }

    _confirmClear(window, settings, ids) {
        const all = ids.length === SECTION_IDS.length;
        const what = all ? 'all RecentDock history' : `“${SECTION_TITLES[ids[0]]}”`;
        confirm(window, `Clear ${what}?`,
            'RecentDock will forget these entries. Your actual files and folders are not deleted, ' +
            'and your desktop’s own recent-files list is not changed.',
            'Clear History', () => {
                const now = Date.now();
                for (const id of ids)
                    settings.set_int64(key(id, 'cleared-at'), now);
                toast(window, 'History cleared');
            });
    }

    // ---- History & privacy -------------------------------------------------

    _historyPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'History', icon_name: 'document-open-recent-symbolic'});

        const clear = new Adw.PreferencesGroup({
            title: 'Clear History',
            description: 'Clearing only makes RecentDock forget entries. It never deletes files or folders.',
        });
        for (const id of SECTION_IDS) {
            const row = new Adw.ActionRow({title: SECTION_TITLES[id]});
            const btn = new Gtk.Button({label: 'Clear…', valign: Gtk.Align.CENTER});
            btn.connect('clicked', () => this._confirmClear(window, settings, [id]));
            row.add_suffix(btn);
            clear.add(row);
        }
        const allRow = new Adw.ActionRow({title: 'All RecentDock history'});
        const allBtn = new Gtk.Button({label: 'Clear All…', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        allBtn.connect('clicked', () => this._confirmClear(window, settings, [...SECTION_IDS]));
        allRow.add_suffix(allBtn);
        clear.add(allRow);
        page.add(clear);

        const privacy = new Adw.PreferencesGroup({
            title: 'Privacy',
            description: 'RecentDock works offline, sends nothing anywhere, and has no telemetry.',
        });
        const shots = new Adw.SwitchRow({
            title: 'Ignore screenshots',
            subtitle: 'Screenshots saved by GNOME are not listed as opened files',
        });
        settings.bind('exclude-screenshots', shots, 'active', Gio.SettingsBindFlags.DEFAULT);
        privacy.add(shots);
        const where = [
            ['Settings', 'GSettings (dconf): /org/gnome/shell/extensions/recentdock/'],
            ['RecentDock history', defaultStorePath()],
            ['Recent files list (read only)', defaultRecentPath()],
        ];
        for (const [title, subtitle] of where) {
            const r = new Adw.ActionRow({title, subtitle: GLib.markup_escape_text(subtitle, -1)});
            r.subtitle_selectable = true;
            privacy.add(r);
        }
        page.add(privacy);
        return page;
    }

    // ---- Diagnostics -------------------------------------------------------

    _diagnosticsPage(window, _settings) {
        const page = new Adw.PreferencesPage({title: 'Diagnostics', icon_name: 'dialog-information-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Diagnostics',
            description: 'This report contains versions, states and counts only — no file names or paths.',
        });
        const add = (title, subtitle) => {
            const r = new Adw.ActionRow({title, subtitle: GLib.markup_escape_text(String(subtitle), -1)});
            r.subtitle_selectable = true;
            group.add(r);
            return r;
        };
        const lines = [];
        const base = {
            'RecentDock version': this.metadata['version-name'] ?? String(this.metadata.version ?? '?'),
            'GNOME Shell': Config.PACKAGE_VERSION,
            'Session type': GLib.getenv('XDG_SESSION_TYPE') ?? 'unknown',
            'Desktop': GLib.getenv('XDG_CURRENT_DESKTOP') ?? 'unknown',
            'Downloads folder found': getDownloadDir() ? 'yes' : 'no',
            'Recent files list exists': GLib.file_test(defaultRecentPath(), GLib.FileTest.EXISTS) ? 'yes' : 'no',
        };
        for (const [k, v] of Object.entries(base)) {
            add(k, v);
            lines.push(`${k}: ${v}`);
        }
        const live = add('Extension', 'checking…');
        const counts = add('Retained entries per section', '…');
        const perf = add('Measured response times', '…');

        callShell('GetStatus', res => {
            if (!res) {
                live.subtitle = 'not running';
                counts.subtitle = perf.subtitle = 'unavailable';
                lines.push('Extension: not running');
                return;
            }
            const s = JSON.parse(res[0]);
            live.subtitle = `running; downloads: ${s.sources.downloads}; recent list: ${s.sources.recentFiles} ` +
                `(parse ${s.recentParseMs} ms); Files: ${s.sources.fileManager}` +
                (s.storeError ? `; history file: ${s.storeError}` : '');
            counts.subtitle = SECTION_IDS.map(id => `${SECTION_TITLES[id]}: ${s.counts[id]}`).join(', ');
            const fmt = t => t ? `p50 ${t.p50.toFixed(2)} ms, p95 ${t.p95.toFixed(2)} ms (n=${t.n})` : 'no samples yet';
            perf.subtitle = `Menu build: ${fmt(s.timingsMs.menu)}; left-click: ${fmt(s.timingsMs.click)}`;
            lines.push(`Extension: ${live.subtitle}`, `Counts: ${counts.subtitle}`, `Timing: ${perf.subtitle}`);
        });

        const copy = new Gtk.Button({label: 'Copy Report', valign: Gtk.Align.CENTER});
        copy.connect('clicked', () => {
            window.get_display().get_clipboard().set(lines.join('\n'));
            toast(window, 'Diagnostic report copied');
        });
        group.set_header_suffix(copy);
        page.add(group);
        return page;
    }
}
