#!/usr/bin/env python3
"""
Offline self-test for the observer.

Needs no aircraft, no QGroundControl and no network. It builds MAVLink messages in
memory, hands them to the observer's own decoder, and checks what the tools report.
Nothing is sent anywhere: the "transmit" side writes into a byte buffer, not a socket.

Run from the app's folder, with the Python the observer was installed into:

    Windows    mcp\\observer\\.venv\\Scripts\\python.exe mcp\\observer\\selftest.py
    macOS      mcp/observer/.venv/bin/python mcp/observer/selftest.py

What it proves: the Python environment is complete; server.py decodes, caches and
compares correctly; where the aircraft is stays out of the answers unless asked for;
and the socket refuses to send. What it does not prove: that QGroundControl is
forwarding, or that the port is free.
"""

import importlib
import os
import socket
import struct
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("MAVLINK20", "1")
# the test decides these; whatever the person running it has set is put aside
os.environ.pop("FC_OBSERVER_PLACE", None)
os.environ.pop("QGC_FWD_HOST", None)

import server  # noqa: E402
from pymavlink import mavutil  # noqa: E402

mav = mavutil.mavlink
_results = []


class _Buffer:
    """Stands in for a socket so the encoder has somewhere to write."""

    def __init__(self):
        self.data = bytearray()

    def write(self, b):
        self.data += b


def feed(src_system, build):
    """Encode messages as system `src_system`, decode them, pass them to the observer."""
    buf = _Buffer()
    build(mav.MAVLink(buf, srcSystem=src_system, srcComponent=1))
    for msg in mav.MAVLink(None).parse_buffer(bytes(buf.data)) or []:
        server._handle(msg)


def check(name, got, want):
    ok = got == want
    _results.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + ("" if ok else f"   got {got!r}, want {want!r}"))


def px4_int(value):
    """PX4 puts an int32 parameter's bytes inside the float field."""
    return struct.unpack("<f", struct.pack("<i", value))[0]


# A place nobody flies: the default home of PX4's simulator.
LAT, LON = 47.397742, 8.545594


def main():
    print("1. Vehicle heartbeat is decoded")
    auto_loiter = (4 << 16) | (3 << 24)          # PX4 custom_mode: main AUTO, sub LOITER
    feed(1, lambda m: m.heartbeat_send(mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_PX4,
                                       0, auto_loiter, mav.MAV_STATE_STANDBY))
    v = server.status()["vehicle"]
    check("type", v["type"], "MAV_TYPE_QUADROTOR")
    check("autopilot", v["autopilot"], "MAV_AUTOPILOT_PX4")
    check("armed", v["armed"], False)
    check("mode", v["mode"]["name"], "AUTO:LOITER")

    print("2. QGroundControl's own heartbeat (system 255) is ignored")
    feed(255, lambda m: m.heartbeat_send(mav.MAV_TYPE_GCS, mav.MAV_AUTOPILOT_INVALID,
                                         mav.MAV_MODE_FLAG_SAFETY_ARMED, 0,
                                         mav.MAV_STATE_ACTIVE))
    v = server.status()["vehicle"]
    check("still the quadrotor", v["type"], "MAV_TYPE_QUADROTOR")
    check("still disarmed", v["armed"], False)

    print("3. Parameters, including PX4's byte-wise integers")

    def params(m):
        m.param_value_send(b"SYS_AUTOSTART", px4_int(4019), mav.MAV_PARAM_TYPE_INT32, 3, 0)
        m.param_value_send(b"RC_MAP_KILL_SW", px4_int(8), mav.MAV_PARAM_TYPE_INT32, 3, 1)
        m.param_value_send(b"BAT_LOW_THR", 0.3, mav.MAV_PARAM_TYPE_REAL32, 3, 2)
    feed(1, params)
    check("SYS_AUTOSTART", server.param("SYS_AUTOSTART").get("value"), 4019)
    check("RC_MAP_KILL_SW", server.param("rc_map_kill_sw").get("value"), 8)
    check("BAT_LOW_THR", round(server.param("BAT_LOW_THR").get("value", 0), 4), 0.3)
    check("prefix filter", sorted(server.params(prefix="rc_")["params"]), ["RC_MAP_KILL_SW"])
    check("counts", (server.status()["params_received"], server.status()["params_expected"]),
          (3, 3))

    print("4. Board text messages")
    feed(1, lambda m: m.statustext_send(mav.MAV_SEVERITY_INFO, b"Armed by Stick gesture"))
    last = server.messages(n=1)["messages"][-1]
    check("text", last["text"], "Armed by Stick gesture")
    check("severity", last["severity"], "MAV_SEVERITY_INFO")

    print("5. The live comparison with a saved file")
    body = ("# Onboard parameters for Vehicle 1\n"
            "1\t1\tSYS_AUTOSTART\t4019\t6\n"
            "1\t1\tRC_MAP_KILL_SW\t7\t6\n"
            "1\t1\tBAT_LOW_THR\t0.300000011920928955\t9\n"
            "1\t1\tONLY_IN_FILE\t1\t6\n")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "selftest.params")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        d = server.diff_live_against_file(path)
        check("file count", d["file_count"], 4)
        check("changed", d["changed"], {"RC_MAP_KILL_SW": {"file": "7", "live": 8}})
        check("only_in_file", d["only_in_file"], ["ONLY_IN_FILE"])
        check("only_live", d["only_live"], [])
        check("a file that is not there", "error" in server.diff_live_against_file(os.path.join(tmp, "no.params")), True)

    print("6. Where the aircraft is stays out, unless asked for")

    def position(m):
        m.gps_raw_int_send(0, mav.GPS_FIX_TYPE_3D_FIX, int(LAT * 1e7), int(LON * 1e7), 488000,
                           90, 120, 0, 0, 14)
        m.global_position_int_send(0, int(LAT * 1e7), int(LON * 1e7), 488000, 0, 0, 0, 0, 0)
        m.home_position_send(int(LAT * 1e7), int(LON * 1e7), 488000, 0, 0, 0,
                             [1, 0, 0, 0], 0, 0, 0)
    feed(1, position)
    check("default is to leave it out", server.SHOW_PLACE, False)
    g = server.sensors()["gps"]
    check("sensors: satellites are given", g["satellites_visible"], 14)
    check("sensors: height is given", g["alt_m"], 488.0)
    check("sensors: no latitude or longitude", ("lat" in g, "lon" in g), (False, False))
    check("sensors: says it was left out", "left out" in g["place"], True)
    for kind in ("GPS_RAW_INT", "GLOBAL_POSITION_INT", "HOME_POSITION"):
        f = server.latest(kind)["fields"]
        check(f"latest {kind}: no position", ("left out" in str(f.get("lat", f.get("latitude"))),
                                             "left out" in str(f.get("lon", f.get("longitude")))),
              (True, True))
    everything = repr([server.sensors(), server.latest("GPS_RAW_INT"), server.latest("GLOBAL_POSITION_INT"),
                       server.latest("HOME_POSITION"), server.status(), server.traffic()])
    check("no tool's answer holds the position's digits", ("473977" in everything, "85455" in everything),
          (False, False))

    # a mission's waypoints travel in fields called x and y
    feed(1, lambda m: m.mission_item_int_send(0, 0, 1, mav.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                                              mav.MAV_CMD_NAV_WAYPOINT, 0, 1, 0, 0, 0, 0,
                                              int(LAT * 1e7), int(LON * 1e7), 20))
    f = server.latest("MISSION_ITEM_INT")["fields"]
    check("latest MISSION_ITEM_INT: no position", ("left out" in str(f["x"]), "left out" in str(f["y"])),
          (True, True))
    check("latest MISSION_ITEM_INT: height is given", f["z"], 20.0)

    server.SHOW_PLACE = True
    g = server.sensors()["gps"]
    check("asked for: latitude", round(g["lat"], 6), LAT)
    check("asked for: longitude", round(g["lon"], 6), LON)
    check("asked for: raw fields", server.latest("GLOBAL_POSITION_INT")["fields"]["lat"], int(LAT * 1e7))
    server.SHOW_PLACE = False

    print("7. It listens on this computer only")
    check("default address", server.LISTEN_HOST, "127.0.0.1")
    os.environ["FC_OBSERVER_PLACE"] = "yes"
    check("place needs exactly 1", importlib.reload(server).SHOW_PLACE, False)
    os.environ.pop("FC_OBSERVER_PLACE")
    importlib.reload(server)

    print("8. The tools: nine, and none that sends")
    tools = sorted(n for n in ("status", "autopilot_version", "params", "param", "messages", "sensors",
                               "traffic", "latest", "diff_live_against_file") if callable(getattr(server, n, None)))
    check("the nine", len(tools), 9)
    names = [n for n in dir(server) if not n.startswith("_")]
    sending = [n for n in names if any(w in n.lower() for w in ("send", "write", "set_", "arm", "command", "upload", "reboot"))]
    check("no name that sends, sets or arms", sending, [])
    with open(os.path.join(HERE, "server.py"), encoding="utf-8") as fh:
        source = fh.read()
    check("the connection's write is replaced", source.count("conn.write = _forbidden"), 1)
    check("the socket is wrapped", source.count("conn.port = _RxOnlySocket(conn.port)"), 1)
    check("no way out is opened", any(w in source for w in ("udpout", "tcp:", "serial", ".sendto(", "mav.mav.")), False)

    print("9. The read-only guard")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)   # never bound, never used
    try:
        guarded = server._RxOnlySocket(sock)
        for method in ("send", "sendto", "sendall", "sendmsg"):
            try:
                getattr(guarded, method)(b"x", ("127.0.0.1", 9))
                refused = False
            except RuntimeError:
                refused = True
            check(f"{method} refused", refused, True)
    finally:
        sock.close()

    failed = _results.count(False)
    print(f"\n{len(_results) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
