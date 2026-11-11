import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import GObject from 'gi://GObject';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UPOWER = 'org.freedesktop.UPower';
const BLUEZ = 'org.bluez';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const PROPERTIES = 'org.freedesktop.DBus.Properties';
const REFRESH_SECONDS = 30;

function managedObjectsAsync(bus, service, callback) {
    try {
        bus.call(service, '/', OBJECT_MANAGER, 'GetManagedObjects', null, null,
            Gio.DBusCallFlags.NONE, 3000, null, (_connection, result) => {
                try {
                    callback(result ? bus.call_finish(result).deep_unpack()[0] : null);
                } catch (_error) {
                    callback(null);
                }
            });
    } catch (_error) {
        callback(null);
    }
}

function value(v) {
    try { return v.deep_unpack(); } catch (_error) { return v; }
}

function isSteelSeries(text) {
    return /steelseries|arctis|nova/i.test(String(text ?? ''));
}

const Indicator = GObject.registerClass(class Indicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.0, 'SteelSeries Battery');
        this._extensionPath = extensionPath;
        this._bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        this._signals = [];

        this._box = new St.BoxLayout({style_class: 'steelseries-battery-panel'});
        this._icon = new St.Icon({icon_name: 'battery-missing-symbolic', style_class: 'system-status-icon'});
        this._percent = new St.Label({text: '—', y_align: 2, style_class: 'steelseries-battery-percent'});
        this._box.add_child(this._icon);
        this._box.add_child(this._percent);
        this.add_child(this._box);

        this._status = new PopupMenu.PopupMenuItem('Looking for a SteelSeries headset…', {reactive: false});
        this.menu.addMenuItem(this._status);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh = new PopupMenu.PopupMenuItem('Refresh');
        refresh.connect('activate', () => this._queueRefresh());
        this.menu.addMenuItem(refresh);

        for (const service of [UPOWER, BLUEZ]) {
            this._signals.push(this._bus.signal_subscribe(service, PROPERTIES, 'PropertiesChanged',
                null, null, Gio.DBusSignalFlags.NONE, () => this._queueRefresh()));
        }
        this._refreshScheduled = false;
        this._refreshInFlight = false;
        this._refreshAgain = false;
        this._destroyed = false;
        this._queueRefresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._queueRefresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _queueRefresh() {
        if (this._destroyed) return;
        if (this._refreshInFlight) {
            this._refreshAgain = true;
            return;
        }
        if (this._refreshScheduled) return;
        this._refreshScheduled = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._refreshScheduled = false;
            if (!this._destroyed) this._refreshAsync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshAsync() {
        if (this._refreshInFlight) return;
        this._refreshInFlight = true;
        this._findDeviceAsync(device => {
            if (!this._destroyed) {
                if (device) this._showDevice(device);
                else this._probeNova5();
            }
            this._refreshInFlight = false;
            if (this._refreshAgain) {
                this._refreshAgain = false;
                this._queueRefresh();
            }
        });
    }

    _showDevice(device) {
        const percentage = Math.round(device.percentage);
        const level = percentage >= 95 ? 100 : Math.max(0, Math.round(percentage / 10) * 10);
        this._icon.icon_name = `battery-${level}${device.charging ? '-charging' : ''}-symbolic`;
        this._percent.text = `${percentage}%`;
        this._status.label.text = `${device.name}: ${percentage}% (${device.source})`;
        this.tooltip_text = `${device.name}: ${percentage}%`;
    }

    _probeNova5() {
        if (this._probe)
            return;
        this._status.label.text = 'Checking SteelSeries USB headset…';
        const script = `${this._extensionPath}/tools/read-battery.py`;
        try {
            this._probe = new Gio.Subprocess({
                argv: ['python3', script, '--json', '--seconds', '2'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            this._probe.init(null);
            this._probe.communicate_utf8_async(null, null, (_process, result) => {
                try {
                    const [, stdout] = this._probe.communicate_utf8_finish(result);
                    const data = JSON.parse(stdout.trim().split('\n').pop());
                    if (Number.isFinite(data.battery)) {
                        this._showDevice({name: 'SteelSeries Arctis Nova 5', percentage: data.battery,
                            charging: Boolean(data.charging), source: 'USB HID'});
                    } else {
                        this._showMissing();
                    }
                } catch (_error) {
                    this._showMissing();
                } finally {
                    this._probe = null;
                }
            });
        } catch (_error) {
            this._probe = null;
            this._showMissing();
        }
    }

    _showMissing() {
        this._icon.icon_name = 'battery-missing-symbolic';
        this._percent.text = '—';
        this._status.label.text = 'No SteelSeries headset detected';
        this.tooltip_text = 'SteelSeries Battery: not detected';
    }

    _findDeviceAsync(callback) {
        managedObjectsAsync(this._bus, UPOWER, objects => {
            if (objects) {
                for (const [path, interfaces] of Object.entries(objects)) {
                    const props = interfaces['org.freedesktop.UPower.Device'];
                    if (!props) continue;
                    const text = [path, props['Model'], props['Vendor'], props['NativePath']].map(value).join(' ');
                    if (isSteelSeries(text)) {
                        callback({name: value(props['Model']) || 'SteelSeries headset',
                            percentage: Number(value(props['Percentage'])),
                            charging: [1, 4].includes(Number(value(props['State']))), source: 'UPower'});
                        return;
                    }
                }
            }
            managedObjectsAsync(this._bus, BLUEZ, bluez => {
                if (bluez) {
                    for (const [path, interfaces] of Object.entries(bluez)) {
                        const device = interfaces['org.bluez.Device1'];
                        const battery = interfaces['org.bluez.Battery1'];
                        if (!device || !battery) continue;
                        const text = [path, device['Name'], device['Alias'], device['Icon']].map(value).join(' ');
                        if (isSteelSeries(text)) {
                            callback({name: value(device['Alias']) || value(device['Name']) || 'SteelSeries headset',
                                percentage: Number(value(battery['Percentage'])), charging: false, source: 'Bluetooth'});
                            return;
                        }
                    }
                }
                callback(null);
            });
        });
    }

    destroy() {
        this._destroyed = true;
        this._probe?.force_exit();
        if (this._timer) GLib.source_remove(this._timer);
        for (const id of this._signals) this._bus.signal_unsubscribe(id);
        super.destroy();
    }
});

export default class SteelSeriesBatteryExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
