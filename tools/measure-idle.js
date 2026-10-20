// SPDX-License-Identifier: GPL-3.0-or-later
// Rough idle cost of the extension inside the nested shell (see measure-idle.sh):
// GNOME Shell CPU time and RSS over an idle window, extension enabled vs disabled.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const UUID = 'recentdock@legitforce.github.io';
const ev = code => JSON.parse(Gio.DBus.session.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
    new GLib.Variant('(s)', [code]), null, 0, 10000, null).deepUnpack()[1] || 'null');
const sleep = ms => {
    const l = new GLib.MainLoop(null, false);
    GLib.timeout_add(0, ms, () => l.quit());
    l.run();
};
const pid = ev('new Gio.Credentials().get_unix_pid()');
const ticks = () => {
    const f = new TextDecoder().decode(GLib.file_get_contents(`/proc/${pid}/stat`)[1]).split(') ')[1].split(' ');
    return Number(f[11]) + Number(f[12]); // utime + stime (clock ticks)
};
const rssKb = () => Number(/VmRSS:\s+(\d+)/.exec(new TextDecoder().decode(GLib.file_get_contents(`/proc/${pid}/status`)[1]))[1]);
function sample(label, seconds) {
    ev('imports.system.gc(); true');
    sleep(2000);
    const t0 = ticks(), r0 = rssKb();
    sleep(seconds * 1000);
    const cpuMs = (ticks() - t0) * 10;
    const line = `${label}: shell CPU ${cpuMs} ms over ${seconds}s idle (${(cpuMs / seconds / 10).toFixed(2)}%), RSS ${(r0 / 1024).toFixed(1)} MiB`;
    print(line);
    return r0;
}
// Let session startup settle, then alternate to cancel out ordering effects.
sleep(20000);
const set = enabled => ev(`Main.extensionManager.${enabled ? 'enable' : 'disable'}Extension('${UUID}'); true`);
const r = {on: [], off: []};
for (const enabled of (GLib.getenv("RD_SEQ") ?? "0101").split("").map(c => c === "1")) {
    set(enabled);
    r[enabled ? 'on' : 'off'].push(sample(enabled ? 'extension enabled ' : 'extension disabled', 30));
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
print(`RSS difference (enabled - disabled, mean): ${((avg(r.on) - avg(r.off)) / 1024).toFixed(1)} MiB (noisy)`);
