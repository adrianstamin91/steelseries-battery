# SteelSeries Battery GNOME Extension

Shows a SteelSeries headset battery percentage in the GNOME panel. It checks
UPower first, then BlueZ/D-Bus, and refreshes every 30 seconds.

## Install from GitHub

```bash
git clone https://github.com/adrianstamin91/steelseries-battery.git
cd steelseries-battery-gnome
make install
sudo make install-udev
gnome-extensions enable steelseries-battery@gnome
gnome-extensions info steelseries-battery@gnome
```

The headset must expose battery data through Bluetooth or UPower. USB receivers
that hide the battery behind a vendor protocol may not be detectable generically.
After installing the udev rule, reconnect the headset receiver. If GNOME does
not reload the extension, log out and back in, then run:

```bash
gnome-extensions enable steelseries-battery@gnome
gnome-extensions info steelseries-battery@gnome
```

The info command should report `Enabled: Yes` and `State: ACTIVE`.

## Build a distributable bundle

```bash
make package
gnome-extensions install --force dist/steelseries-battery@gnome.shell-extension.zip
```

## Uninstall

```bash
make uninstall
```

## Nova 5 HID development

The Arctis Nova 5 USB receiver uses vendor-specific HID reports, so it may not
appear in UPower or Bluetooth. The project includes a read-only diagnostic
monitor:

```bash
sudo cp udev/70-steelseries-battery.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
make hid-monitor
```

The monitor only reads reports. It does not send commands to the headset. The
raw reports will let us implement the Nova 5 battery parser in a later step.

To test the documented read-only battery status request:

```bash
make read-battery
```
