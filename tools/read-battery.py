#!/usr/bin/env python3
"""Read the battery status of an Arctis Nova 5 over vendor HID."""

import argparse
import errno
import glob
import json
import os
import select
import sys
import time

VENDOR = "1038"
PRODUCT = "2232"


def interfaces():
    result = []
    for device_dir in sorted(glob.glob("/sys/class/hidraw/hidraw*/device")):
        try:
            props = {}
            with open(os.path.join(device_dir, "uevent"), encoding="ascii") as stream:
                for line in stream:
                    if "=" in line:
                        key, value = line.rstrip().split("=", 1)
                        props[key] = value
            if props.get("HID_ID") != f"0003:0000{VENDOR}:{PRODUCT.zfill(8)}":
                continue
            node = "/dev/" + os.path.basename(os.path.dirname(device_dir))
            result.append((node, props.get("HID_PHYS", "")))
        except OSError:
            continue
    return result


def parse_report(report):
    # Nova 5 replies without the zero report-id byte: b0, state, ..., level.
    if len(report) > 3 and report[0] == 0xB0:
        return report[3], report[1] == 0x02, "b0"
    if len(report) > 15 and report[:2] == bytes((0x00, 0xB0)):
        return report[6], report[15] in (0x02, 0x04), "00 b0"
    if len(report) > 4 and report[:2] == bytes((0x07, 0xB7)):
        return report[2], report[4] == 0x02, "07 b7"
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=5)
    parser.add_argument("--json", action="store_true", help="print one machine-readable result")
    args = parser.parse_args()

    def log(message):
        print(message, file=sys.stderr if args.json else sys.stdout)

    found = interfaces()
    if not found:
        raise SystemExit("No Arctis Nova 5 HID interfaces found")

    handles = []
    for node, physical_path in found:
        try:
            fd = os.open(node, os.O_RDWR | os.O_NONBLOCK)
            handles.append((node, physical_path, fd))
            log(f"opened {node} ({physical_path})")
        except OSError as error:
            log(f"skipping {node}: {error}")

    if not handles:
        raise SystemExit("No HID interfaces could be opened; install the udev rule first")

    # The Nova 5 status poll is a 64-byte, read-only vendor request.
    command_fd = next((fd for node, path, fd in handles if path.endswith("/input3")), None)
    if command_fd is None:
        raise SystemExit("The command interface (input3) is not accessible")
    os.write(command_fd, bytes((0x00, 0xB0)) + bytes(62))

    deadline = time.monotonic() + args.seconds
    result = None
    fd_to_node = {fd: node for node, _path, fd in handles}
    while time.monotonic() < deadline:
        ready, _, _ = select.select(list(fd_to_node), [], [], 0.5)
        for fd in ready:
            try:
                report = os.read(fd, 256)
            except OSError as error:
                if error.errno == errno.EIO:
                    log(f"{fd_to_node[fd]} has no readable input reports")
                    del fd_to_node[fd]
                    os.close(fd)
                    handles[:] = [(node, path, handle) for node, path, handle in handles if handle != fd]
                    if not fd_to_node:
                        return
                    continue
                raise
            parsed = parse_report(report)
            if parsed:
                battery, charging, protocol = parsed
                result = {"battery": battery, "charging": charging, "protocol": protocol,
                          "device": fd_to_node[fd]}
                if args.json:
                    print(json.dumps(result))
                else:
                    print(f"battery={battery}% charging={charging} protocol={protocol} device={fd_to_node[fd]}")
                break
            else:
                log(f"report={report.hex(' ')} device={fd_to_node[fd]}")

        if result:
            break

    for _node, _path, fd in handles:
        os.close(fd)

    if args.json and not result:
        print(json.dumps({"error": "no-response"}))


if __name__ == "__main__":
    main()
