#!/usr/bin/env python3
"""Read-only diagnostic monitor for SteelSeries Arctis HID reports.

This intentionally does not write to the headset. It helps us learn which
hidraw interface emits Nova 5 status reports before we build the battery
parser.
"""

import argparse
import errno
import glob
import os
import select
import time

VENDOR = "1038"
PRODUCT = "2232"


def steelseries_hidraw_devices():
    devices = []
    for hidraw in sorted(glob.glob("/sys/class/hidraw/hidraw*/device")):
        uevent_path = os.path.join(hidraw, "uevent")
        try:
            props = {}
            with open(uevent_path, encoding="ascii") as stream:
                for line in stream:
                    if "=" in line:
                        key, value = line.rstrip().split("=", 1)
                        props[key] = value
            if props.get("HID_ID") != f"0003:0000{VENDOR}:{PRODUCT.zfill(8)}":
                continue
            node = "/dev/" + os.path.basename(os.path.dirname(hidraw))
            devices.append((node, props))
        except OSError:
            continue
    return devices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=15, help="listen duration (default: 15)")
    parser.add_argument("--device", help="specific hidraw node, e.g. /dev/hidraw8")
    args = parser.parse_args()

    devices = steelseries_hidraw_devices()
    if args.device:
        devices = [(args.device, {})]
    if not devices:
        raise SystemExit("No Arctis Nova 5 HID interfaces found")

    print("Detected HID interfaces:")
    for node, props in devices:
        print(f"  {node}  {props.get('HID_PHYS', '')}")

    handles = []
    try:
        for node, _props in devices:
            try:
                handles.append((node, os.open(node, os.O_RDONLY | os.O_NONBLOCK)))
            except OSError as error:
                print(f"  cannot open {node}: {error}")
        if not handles:
            raise SystemExit("No HID interfaces could be opened; install the udev rule first")

        print(f"Listening for {args.seconds:g}s (read-only)…")
        deadline = time.monotonic() + args.seconds
        fd_to_node = {fd: node for node, fd in handles}
        while time.monotonic() < deadline:
            ready, _, _ = select.select(list(fd_to_node), [], [], 0.5)
            for fd in ready:
                try:
                    report = os.read(fd, 256)
                except BlockingIOError:
                    continue
                except OSError as error:
                    if error.errno == errno.EIO:
                        print(f"{fd_to_node[fd]}  no readable reports on this interface")
                        del fd_to_node[fd]
                        os.close(fd)
                        handles[:] = [(node, handle) for node, handle in handles if handle != fd]
                        if not fd_to_node:
                            return
                        continue
                    raise
                command = report[1] if len(report) > 1 else None
                print(f"{fd_to_node[fd]}  command={command:#04x}  bytes={report.hex(' ')}")
    finally:
        for _node, fd in handles:
            os.close(fd)


if __name__ == "__main__":
    main()
