UUID := steelseries-battery@gnome
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
DIST_DIR := dist

.PHONY: install install-udev package uninstall clean hid-monitor read-battery

install:
	mkdir -p "$(INSTALL_DIR)"
	cp metadata.json extension.js stylesheet.css "$(INSTALL_DIR)/"
	mkdir -p "$(INSTALL_DIR)/tools"
	cp tools/read-battery.py "$(INSTALL_DIR)/tools/"
	@echo "Installed $(UUID)"

install-udev:
	sudo install -Dm644 udev/70-steelseries-battery.rules /etc/udev/rules.d/70-steelseries-battery.rules
	sudo udevadm control --reload-rules
	sudo udevadm trigger --subsystem-match=hidraw
	@echo "Installed HID permissions; reconnect the headset if needed."
	@echo "If GNOME does not reload the extension, log out and back in."

package:
	mkdir -p "$(DIST_DIR)"
	gnome-extensions pack . --out-dir="$(DIST_DIR)" --force

uninstall:
	rm -rf "$(INSTALL_DIR)"

clean:
	rm -rf "$(DIST_DIR)"

hid-monitor:
	python3 tools/hid-monitor.py

read-battery:
	python3 tools/read-battery.py
