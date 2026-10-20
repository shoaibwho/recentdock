// SPDX-License-Identifier: GPL-3.0-or-later
// RecentDock GNOME Shell extension.
//
// RecentDock is a normal application entry (recentdock.desktop) that the user
// pins to the dock. This extension:
//   * adds RecentDock's items to the top of that icon's right-click menu
//     (Ubuntu Dock / Dash to Dock, and the GNOME dash and app grid);
//   * handles left-clicks on the icon in-process, without spawning anything;
//   * runs three event-driven trackers (Downloads folder monitor, recent-files
//     list monitor, Files D-Bus property watch). There is no polling.
// Nothing is modified outside the shell process, and everything is undone in
// disable().

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {APP_ID, DBUS_IFACE, DBUS_PATH, SECTION_IDS, readConfig} from './lib/config.js';
import {HistoryStore, STORED_SECTIONS} from './lib/history.js';
import {DownloadsTracker} from './lib/downloads.js';
import {RecentFilesSource} from './lib/recentFiles.js';
import {FileManagerTracker} from './lib/fileManager.js';
import {buildMenuModel, resolveLeftClick} from './lib/model.js';
import {isAvailable, displayName, displayParent} from './lib/paths.js';
import * as Actions from './lib/actions.js';

const DBUS_XML = `<node>
  <interface name="${DBUS_IFACE}">
    <method name="Activate"/>
    <method name="GetStatus"><arg type="s" direction="out" name="json"/></method>
  </interface>
</node>`;

function isOurApp(app) {
    try {
        return app?.get_id?.() === APP_ID;
    } catch {
        return false;
    }
}

export default class RecentDockExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._config = readConfig(this._settings);
        this._ourItems = new WeakMap();
        this._timings = [];

        this._store = new HistoryStore().load();
        this._recent = new RecentFilesSource();
        this._recent.excludeScreenshots = this._config.excludeScreenshots;
        this._downloads = new DownloadsTracker(this._store);
        this._fileManager = new FileManagerTracker(this._store);

        // Apply clears that were requested while the extension was not running.
        for (const id of STORED_SECTIONS)
            this._store.forgetBefore(id, this._config.sections[id].clearedAt);

        this._settingsId = this._settings.connect('changed', (_s, k) => this._onSettingChanged(k));

        // Each source is started independently: a failure in one must never
        // break the others or the menu.
        for (const src of [this._recent, this._downloads, this._fileManager]) {
            try {
                src.start();
            } catch (e) {
                src.status = `failed: ${e.message}`;
                console.warn(`RecentDock: a tracking source failed to start: ${e.message}`);
            }
        }

        this._injections = new InjectionManager();
        this._injectMenu();
        this._injectActivation();
        this._exportDBus();
    }

    disable() {
        this._injections?.clear();
        this._injections = null;
        this._dbus?.unexport();
        this._dbus = null;
        if (this._settingsId)
            this._settings.disconnect(this._settingsId);
        this._settingsId = 0;
        this._downloads?.stop();
        this._fileManager?.stop();
        this._recent?.stop();
        this._store?.destroy();
        this._downloads = this._fileManager = this._recent = this._store = null;
        this._settings = null;
        this._ourItems = null;
    }

    _onSettingChanged(k) {
        const prev = this._config;
        this._config = readConfig(this._settings);
        if (k === 'exclude-screenshots') {
            this._recent.excludeScreenshots = this._config.excludeScreenshots;
            this._recent.reload();
        } else if (k === 'refresh-request') {
            this._recent.reload();
        } else if (k.endsWith('-cleared-at')) {
            for (const id of STORED_SECTIONS) {
                if (this._config.sections[id].clearedAt !== prev.sections[id].clearedAt)
                    this._store.forgetBefore(id, this._config.sections[id].clearedAt);
            }
        }
        // Menus are rebuilt each time they open, so nothing else to do.
    }

    // ---- Right-click menu -------------------------------------------------

    _injectMenu() {
        const ext = this;
        this._injections.overrideMethod(PopupMenu.PopupMenu.prototype, 'open', original => {
            return function (...args) {
                // Dock menus keep the icon in _source; GNOME's AppMenu in _app.
                if (!this.isOpen && (isOurApp(this._source?.app) || isOurApp(this._app))) {
                    try {
                        ext._populate(this);
                    } catch (e) {
                        console.error(`RecentDock: menu error: ${e.message}`);
                    }
                }
                return original.call(this, ...args);
            };
        });
    }

    _availability() {
        // Cache stat results for the duration of one menu build only.
        const cache = new Map();
        return (path, wantDir) => {
            const k = `${wantDir}:${path}`;
            if (!cache.has(k))
                cache.set(k, isAvailable(path, wantDir));
            return cache.get(k);
        };
    }

    _sources() {
        return {store: this._store, recent: this._recent};
    }

    _populate(menu) {
        const t0 = GLib.get_monotonic_time();
        for (const item of this._ourItems.get(menu) ?? [])
            item.destroy();
        const items = [];
        const add = item => {
            menu.addMenuItem(item, items.length);
            items.push(item);
            return item;
        };

        const settingsItem = add(new PopupMenu.PopupImageMenuItem('RecentDock Settings',
            'preferences-system-symbolic'));
        settingsItem.connect('activate', () => this.openPreferences());

        const model = buildMenuModel(this._config, this._sources(), this._availability());
        for (const section of model) {
            this._addHeading(add, section);
            const names = section.entries.map(e => displayName(e.path));
            section.entries.forEach((entry, i) => {
                let label = names[i];
                // Disambiguate identical names (e.g. two "report.pdf").
                if (names.indexOf(label) !== names.lastIndexOf(label))
                    label = `${label} — ${displayParent(entry.path)}`;
                const icon = section.isFolder ? Gio.ThemedIcon.new('folder-symbolic')
                    : Gio.content_type_get_symbolic_icon(Gio.content_type_guess(entry.path, null)[0]);
                const item = add(new PopupMenu.PopupImageMenuItem(label, icon));
                item.label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
                item.accessible_name = `${label}, in ${displayParent(entry.path)}`;
                item.connect('activate', () => this._openEntry(section, entry));
            });
        }
        if (this._config.enabled && model.length === 0) {
            const empty = add(new PopupMenu.PopupMenuItem('No recent items yet'));
            empty.setSensitive(false);
        } else if (!this._config.enabled) {
            const off = add(new PopupMenu.PopupMenuItem('RecentDock is turned off'));
            off.setSensitive(false);
        }
        // Separate RecentDock's items from the dock's own (Pin, App Details…).
        if (menu.numMenuItems > items.length)
            add(new PopupMenu.PopupSeparatorMenuItem());

        this._ourItems.set(menu, items);
        this._recordTiming('menu', (GLib.get_monotonic_time() - t0) / 1000);
    }

    /**
     * A section heading with a faded "?" at its end. Clicking the "?", or
     * hovering the heading for 3 seconds, shows what the section lists.
     */
    _addHeading(add, section) {
        const heading = add(new PopupMenu.PopupSeparatorMenuItem(section.title));
        // Only the title text reacts; a reactive row would close the menu on click.
        heading.label.reactive = true;
        heading.label.track_hover = true;
        const help = new St.Button({
            label: '?',
            opacity: 128,
            reactive: true,
            can_focus: true,
            accessible_name: `What is ${section.title}?`,
            style: 'padding: 0 4px; font-weight: bold;',
        });
        heading.insert_child_above(help, heading.label);

        const info = add(new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false}));
        const text = new St.Label({text: section.description, opacity: 180, style: 'font-size: 0.9em;'});
        info.add_child(text);
        info.hide();

        let pinned = false, timerId = 0;
        const stopTimer = () => {
            if (timerId)
                GLib.source_remove(timerId);
            timerId = 0;
        };
        help.connect('clicked', () => {
            pinned = !info.visible;
            info.visible = pinned;
        });
        heading.label.connect('notify::hover', () => {
            stopTimer();
            if (heading.label.hover) {
                timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    timerId = 0;
                    info.show();
                    return GLib.SOURCE_REMOVE;
                });
            } else if (!pinned) {
                info.hide();
            }
        });
        heading.connect('destroy', stopTimer);
    }

    _openEntry(section, entry) {
        if (!isAvailable(entry.path, section.isFolder)) {
            Main.notify('RecentDock', `“${displayName(entry.path)}” is no longer available. It was moved, renamed or deleted.`);
            if (STORED_SECTIONS.includes(section.id))
                this._store.remove(section.id, [entry.path]);
            return;
        }
        const ctx = global.create_app_launch_context(0, -1);
        Actions.openUri(Actions.uriFor(entry.path), ctx).then(ok => {
            if (!ok)
                Main.notify('RecentDock', `Could not open “${displayName(entry.path)}”.`);
        });
        // Opening a folder through RecentDock is itself a folder visit.
        if (section.isFolder)
            this._store.add('opened-folders', {path: entry.path, time: Date.now(), source: 'recentdock'});
    }

    // ---- Left-click -------------------------------------------------------

    _injectActivation() {
        const ext = this;
        const handle = original => function (...args) {
            if (isOurApp(this)) {
                ext.activate();
                return undefined;
            }
            return original.call(this, ...args);
        };
        for (const m of ['activate', 'activate_full', 'open_new_window'])
            this._injections.overrideMethod(Shell.App.prototype, m, handle);
        // Hide the dock's "New Window" item for RecentDock.
        this._injections.overrideMethod(Shell.App.prototype, 'can_open_new_window', original =>
            function (...args) {
                return isOurApp(this) ? false : original.call(this, ...args);
            });
    }

    activate() {
        const t0 = GLib.get_monotonic_time();
        Main.overview.hide();
        if (!this._config.enabled) {
            this.openPreferences();
            return;
        }
        const target = resolveLeftClick(this._config, this._sources(), this._availability());
        this._recordTiming('click', (GLib.get_monotonic_time() - t0) / 1000);
        if (target.kind === 'none') {
            Main.notify('RecentDock', target.message);
            return;
        }
        Actions.perform(target, global.create_app_launch_context(0, -1)).then(ok => {
            if (!ok)
                Main.notify('RecentDock', 'The left-click action could not be completed.');
        });
    }

    _recordTiming(kind, ms) {
        this._timings.push({kind, ms});
        if (this._timings.length > 200)
            this._timings.shift();
    }

    // ---- D-Bus (used by the launcher script and by Settings diagnostics) --

    _exportDBus() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_XML, {
            Activate: () => this.activate(),
            GetStatus: () => JSON.stringify(this._status()),
        });
        try {
            this._dbus.export(Gio.DBus.session, DBUS_PATH);
        } catch (e) {
            console.warn(`RecentDock: D-Bus export failed: ${e.message}`);
            this._dbus = null;
        }
    }

    /** Diagnostic status. Contains counts and states only, never paths. */
    _status() {
        const counts = {};
        for (const id of SECTION_IDS) {
            counts[id] = id === 'opened-files' ? this._recent.files.length
                : id === 'opened-folders' ? this._store.get(id).length + this._recent.folders.length
                    : this._store.get(id).length;
        }
        const stat = kind => {
            const v = this._timings.filter(t => t.kind === kind).map(t => t.ms).sort((a, b) => a - b);
            if (!v.length)
                return null;
            return {n: v.length, p50: v[Math.floor(v.length * 0.5)], p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))]};
        };
        return {
            version: this.metadata['version-name'],
            sources: {
                downloads: this._downloads.status,
                recentFiles: this._recent.status,
                fileManager: this._fileManager.status,
            },
            recentParseMs: Math.round(this._recent.lastParseMs * 10) / 10,
            storeError: this._store.loadError,
            counts,
            timingsMs: {menu: stat('menu'), click: stat('click')},
        };
    }
}
