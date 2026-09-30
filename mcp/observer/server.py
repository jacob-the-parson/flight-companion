#!/usr/bin/env python3
"""
flight-companion-observer: a passive MAVLink observer, offered as MCP tools.

QGroundControl mirrors everything it hears from the vehicle to a UDP port when
"Enable MAVLink forwarding" is switched on (Application Settings -> MAVLink).
This server binds that port, caches what arrives, and exposes it as MCP tools.
An assistant can see what the aircraft is reporting. It cannot say anything to
the aircraft.

READ-ONLY BY CONSTRUCTION
-------------------------
Nothing in this file transmits. The connection's write path is replaced with a
function that raises, so even a future edit that tried to send would fail loudly.
Parameter values arrive because QGC downloads them itself on connect; pressing
"Refresh" in QGC's Parameters view re-sends them.

It listens on this computer only (127.0.0.1) unless QGC_FWD_HOST says otherwise,
so nothing else on the network can feed it.

WHERE THE AIRCRAFT IS is left out of what the tools return unless
FC_OBSERVER_PLACE=1 is set. An assistant passes on what it is given, and a
position is somebody's address.

Settings, from the environment:
    QGC_FWD_PORT        UDP port to listen on (default 14445, QGC's own default)
    QGC_FWD_HOST        address to listen on (default 127.0.0.1)
    FC_OBSERVER_PLACE   1 to include latitude and longitude (default: left out)

Diagnostic use without MCP:  python server.py --watch
"""

import os
import struct
import sys
import threading
import time
from collections import deque

os.environ.setdefault("MAVLINK20", "1")

from pymavlink import mavutil  # noqa: E402
try:                                                    # mcp >= 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP  # noqa: E402
except ModuleNotFoundError:                             # mcp 1.x
    from mcp.server.fastmcp import FastMCP  # noqa: E402

LISTEN_HOST = os.environ.get("QGC_FWD_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("QGC_FWD_PORT", "14445"))   # QGC's default target
SHOW_PLACE = os.environ.get("FC_OBSERVER_PLACE", "") == "1"

# Fields that say where something is: every field MAVLink gives in degrees, by name.
# Height is not among them.
_PLACE_FIELDS = ("lat", "lon", "latitude", "longitude", "lat_int", "lon_int",
                 "lat_camera", "lon_camera", "lat_image", "lon_image",
                 "next_lat", "next_lon", "operator_latitude", "operator_longitude")
# Messages that carry a position in fields with no name of their own: a mission
# item's x and y are a latitude and a longitude in most frames.
_PLACE_BY_MESSAGE = {
    "MISSION_ITEM": ("x", "y"),
    "MISSION_ITEM_INT": ("x", "y"),
    "COMMAND_INT": ("x", "y"),
    "COMMAND_LONG": ("param5", "param6"),
    "ORBIT_EXECUTION_STATUS": ("x", "y"),
    "FIGURE_EIGHT_EXECUTION_STATUS": ("x", "y"),
}
_PLACE_LEFT_OUT = "left out; set FC_OBSERVER_PLACE=1 to include"


def _without_place(fields, msg_type=""):
    """A message's fields, with any that say where the aircraft is taken out."""
    if SHOW_PLACE:
        return fields
    hidden = _PLACE_FIELDS + _PLACE_BY_MESSAGE.get(msg_type, ())
    return {k: (_PLACE_LEFT_OUT if k in hidden else v) for k, v in fields.items()}

# ---------------------------------------------------------------- cache

_lock = threading.Lock()
_state = {
    "started": time.time(),
    "bytes_seen": 0,
    "last_rx": None,
    "latest": {},          # msg type -> (timestamp, dict)
    "counts": {},          # msg type -> count
    "first_seen": {},      # msg type -> timestamp
    "params": {},          # name -> {value, type, type_name, index}
    "param_count": None,
    "statustext": deque(maxlen=500),
    "chunks": {},          # STATUSTEXT id -> partial text
    "errors": deque(maxlen=50),
}


def _forbidden(*_a, **_k):
    raise RuntimeError("the observer never transmits")


class _RxOnlySocket:
    """Wraps the UDP socket so any transmit method raises; receive methods pass through."""

    def __init__(self, sock):
        self._sock = sock

    def __getattr__(self, name):
        if name in ("send", "sendto", "sendall", "sendmsg"):
            return _forbidden
        return getattr(self._sock, name)


# PX4 sends integer parameters byte-wise inside the float field.
_INT_FMT = {1: "<B", 2: "<b", 3: "<H", 4: "<h", 5: "<I", 6: "<i"}


def _decode_param(msg):
    t = msg.param_type
    if t in _INT_FMT:
        # Recover the original bytes from the float field; denormals survive the trip.
        raw = struct.pack("<f", msg.param_value)
        fmt = _INT_FMT[t]
        return struct.unpack(fmt, raw[:struct.calcsize(fmt)])[0]
    return float(msg.param_value)


def _enum_name(enum, value, default="?"):
    e = mavutil.mavlink.enums.get(enum, {})
    return e[value].name if value in e else default


def _text(field):
    s = field if isinstance(field, str) else field.decode(errors="replace")
    return s.rstrip("\0")


def _handle(msg):
    t = msg.get_type()
    if t == "BAD_DATA":
        return
    # QGC's forwarding link also carries QGC's own outgoing traffic (its heartbeat,
    # requests, commands). Only the vehicle's messages belong in the cache; a GCS
    # heartbeat would otherwise show up as a bogus "armed" vehicle.
    if msg.get_srcSystem() == 255 or (t == "HEARTBEAT" and msg.type == 6):
        _state["gcs_msgs"] = _state.get("gcs_msgs", 0) + 1
        return
    now = time.time()
    d = msg.to_dict()
    d.pop("mavpackettype", None)
    with _lock:
        _state["last_rx"] = now
        _state["latest"][t] = (now, d)
        _state["counts"][t] = _state["counts"].get(t, 0) + 1
        _state["first_seen"].setdefault(t, now)

        if t == "PARAM_VALUE":
            name = _text(msg.param_id)
            # A reboot can change the parameter set (port config params appear and
            # disappear). Drop the cache when the vehicle's count changes.
            if _state["param_count"] not in (None, msg.param_count):
                _state["params"].clear()
            _state["params"][name] = {
                "value": _decode_param(msg),
                "type": msg.param_type,
                "type_name": _enum_name("MAV_PARAM_TYPE", msg.param_type),
                "index": msg.param_index,
            }
            _state["param_count"] = msg.param_count

        elif t == "STATUSTEXT":
            text = _text(msg.text)
            mid = getattr(msg, "id", 0)
            if mid:
                buf = _state["chunks"].get(mid, "") + text
                # A chunked message ends with a chunk shorter than the 50-char field.
                if len(text) < 50:
                    _state["chunks"].pop(mid, None)
                    text = buf
                else:
                    _state["chunks"][mid] = buf
                    return
            _state["statustext"].append({
                "t": now,
                "severity": msg.severity,
                "severity_name": _enum_name("MAV_SEVERITY", msg.severity),
                "text": text,
            })


def _probe_port_free():
    """pymavlink binds with SO_REUSEADDR, so a second observer binds silently and one of
    them starves. Probe without REUSEADDR first so a clash is reported, not hidden."""
    import socket
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.bind((LISTEN_HOST, LISTEN_PORT))
    except OSError as err:
        raise RuntimeError(
            f"UDP {LISTEN_PORT} already bound by another process, probably an observer "
            f"started by another assistant session. Close that session. ({err})")
    finally:
        probe.close()


def _listener():
    while True:
        try:
            _probe_port_free()
            conn = mavutil.mavlink_connection(
                f"udpin:{LISTEN_HOST}:{LISTEN_PORT}", dialect="common",
                source_system=0, source_component=0)
            conn.write = _forbidden                      # the read-only guarantee
            conn.port = _RxOnlySocket(conn.port)         # belt and braces
            while True:
                msg = conn.recv_match(blocking=True, timeout=1.0)
                if msg is not None:
                    _state["bytes_seen"] += len(msg.get_msgbuf())
                    _handle(msg)
        except Exception as err:                         # noqa: BLE001
            with _lock:
                _state["errors"].append({"t": time.time(), "error": repr(err)})
            time.sleep(2)


# ---------------------------------------------------------------- helpers

def _age(ts):
    return None if ts is None else round(time.time() - ts, 1)


def _px4_mode(custom_mode):
    main = (custom_mode >> 16) & 0xFF
    sub = (custom_mode >> 24) & 0xFF
    mains = {1: "MANUAL", 2: "ALTCTL", 3: "POSCTL", 4: "AUTO", 5: "ACRO",
             6: "OFFBOARD", 7: "STABILIZED", 8: "RATTITUDE"}
    auto_subs = {1: "READY", 2: "TAKEOFF", 3: "LOITER", 4: "MISSION", 5: "RTL",
                 6: "LAND", 7: "RTGS", 8: "FOLLOW_TARGET", 9: "PRECLAND"}
    name = mains.get(main, f"main={main}")
    if main == 4:
        name += ":" + auto_subs.get(sub, f"sub={sub}")
    elif main == 3 and sub == 2:
        name += ":ORBIT"
    return {"main_mode": main, "sub_mode": sub, "name": name,
            "note": "PX4 custom_mode decode; verify against PX4 docs if it matters"}


def _decode_flags(enum, value):
    out = []
    for v, entry in mavutil.mavlink.enums.get(enum, {}).items():
        if not isinstance(v, int) or v == 0 or entry.name.endswith("_ENUM_END"):
            continue
        if (value & v) == v:
            out.append(entry.name)
    return out


def _parse_params_file(path):
    """QGC .params format: '# comments' then 'sysid<TAB>compid<TAB>NAME<TAB>value<TAB>type'."""
    params, header = {}, []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\r\n")
            if not line.strip():
                continue
            if line.startswith("#"):
                header.append(line)
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                parts = line.split()
            if len(parts) >= 4:
                params[parts[2]] = {"value": parts[3],
                                    "type": parts[4] if len(parts) > 4 else None}
    return header, params


# ---------------------------------------------------------------- MCP tools

mcp = FastMCP("flight-companion-observer")


@mcp.tool()
def status() -> dict:
    """Connection and vehicle summary: is QGC forwarding reaching us, is a vehicle alive,
    armed state, flight mode, parameter download progress."""
    with _lock:
        hb = _state["latest"].get("HEARTBEAT")
        out = {
            "listening_on": f"{LISTEN_HOST}:{LISTEN_PORT}",
            "server_uptime_s": round(time.time() - _state["started"], 1),
            "receiving": _state["last_rx"] is not None and time.time() - _state["last_rx"] < 5,
            "last_packet_age_s": _age(_state["last_rx"]),
            "bytes_seen": _state["bytes_seen"],
            "message_types_seen": len(_state["counts"]),
            "params_received": len(_state["params"]),
            "params_expected": _state["param_count"],
            "recent_errors": list(_state["errors"])[-3:],
        }
        if hb is None:
            out["vehicle"] = None
            out["hint"] = ("No HEARTBEAT yet. In QGC: Application Settings -> MAVLink -> "
                           f"Enable MAVLink forwarding, host 'localhost:{LISTEN_PORT}'.")
            return out
        ts, h = hb
        out["vehicle"] = {
            "heartbeat_age_s": _age(ts),
            "type": _enum_name("MAV_TYPE", h["type"]),
            "autopilot": _enum_name("MAV_AUTOPILOT", h["autopilot"]),
            "system_status": _enum_name("MAV_STATE", h["system_status"]),
            "armed": bool(h["base_mode"] & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
            "base_mode_flags": _decode_flags("MAV_MODE_FLAG", h["base_mode"]),
            "mode": _px4_mode(h["custom_mode"]),
            "mavlink_version": h.get("mavlink_version"),
        }
    return out


@mcp.tool()
def autopilot_version() -> dict:
    """Decoded AUTOPILOT_VERSION: firmware version, git hash ('Custom FW Ver' in QGC),
    board, vendor/product IDs, UID, capabilities. QGC requests this on connect."""
    with _lock:
        item = _state["latest"].get("AUTOPILOT_VERSION")
    if item is None:
        return {"error": "AUTOPILOT_VERSION not seen yet. Reconnect the vehicle in QGC "
                         "or open Analyze Tools -> MAVLink Inspector to trigger a request."}
    ts, v = item

    def ver(u32):
        return {"major": (u32 >> 24) & 0xFF, "minor": (u32 >> 16) & 0xFF,
                "patch": (u32 >> 8) & 0xFF,
                "type": _enum_name("FIRMWARE_VERSION_TYPE", u32 & 0xFF, str(u32 & 0xFF)),
                "string": f"{(u32 >> 24) & 0xFF}.{(u32 >> 16) & 0xFF}.{(u32 >> 8) & 0xFF}"}

    def hexbytes(b):
        return bytes(b).hex() if b else None

    return {
        "age_s": _age(ts),
        "flight_sw_version": ver(v["flight_sw_version"]),
        "flight_custom_version_hex": hexbytes(v.get("flight_custom_version")),
        "middleware_sw_version": ver(v["middleware_sw_version"]),
        "middleware_custom_version_hex": hexbytes(v.get("middleware_custom_version")),
        "os_sw_version": ver(v["os_sw_version"]),
        "os_custom_version_hex": hexbytes(v.get("os_custom_version")),
        "board_version": v["board_version"],
        "board_version_hex": f"0x{v['board_version']:08x}",
        "vendor_id": v["vendor_id"], "vendor_id_hex": f"0x{v['vendor_id']:04x}",
        "product_id": v["product_id"], "product_id_hex": f"0x{v['product_id']:04x}",
        "uid": v["uid"], "uid_hex": f"0x{v['uid']:016x}",
        "uid2_hex": hexbytes(v.get("uid2")),
        "capabilities": _decode_flags("MAV_PROTOCOL_CAPABILITY", v["capabilities"]),
    }


@mcp.tool()
def params(prefix: str = "", limit: int = 300) -> dict:
    """Cached parameter values, optionally filtered by name prefix (case-insensitive).
    Values come from QGC's own download; press Refresh in QGC's Parameters view if stale."""
    prefix = prefix.upper()
    with _lock:
        items = {k: v for k, v in _state["params"].items() if k.upper().startswith(prefix)}
        total = _state["param_count"]
        cached = len(_state["params"])
    names = sorted(items)
    return {
        "matched": len(names), "returned": min(len(names), limit),
        "cached_total": cached, "vehicle_total": total,
        "params": {n: items[n] for n in names[:limit]},
    }


@mcp.tool()
def param(name: str) -> dict:
    """One cached parameter by exact name."""
    with _lock:
        v = _state["params"].get(name) or _state["params"].get(name.upper())
        cached = len(_state["params"])
    if v is None:
        return {"error": f"{name} not in cache", "cached_total": cached}
    return {"name": name.upper(), **v}


@mcp.tool()
def messages(n: int = 50, min_severity: int = 7) -> dict:
    """Recent STATUSTEXT messages from the vehicle (preflight failures, sensor notices).
    Severity 0=EMERGENCY .. 7=DEBUG; min_severity=7 returns everything."""
    with _lock:
        items = [m for m in _state["statustext"] if m["severity"] <= min_severity]
    items = items[-n:]
    return {"count": len(items), "messages": [
        {"age_s": _age(m["t"]), "severity": m["severity_name"], "text": m["text"]}
        for m in items]}


@mcp.tool()
def sensors() -> dict:
    """SYS_STATUS sensor present/enabled/healthy bitmasks decoded, plus GPS fix, battery,
    and the latest estimator status if seen."""
    out = {}
    with _lock:
        ss = _state["latest"].get("SYS_STATUS")
        gps = _state["latest"].get("GPS_RAW_INT")
        bat = _state["latest"].get("BATTERY_STATUS")
        ekf = _state["latest"].get("ESTIMATOR_STATUS")
    if ss:
        ts, s = ss
        present = s["onboard_control_sensors_present"]
        enabled = s["onboard_control_sensors_enabled"]
        health = s["onboard_control_sensors_health"]
        enum = mavutil.mavlink.enums["MAV_SYS_STATUS_SENSOR"]
        table = {}
        for val, entry in enum.items():
            if not isinstance(val, int) or val == 0 or entry.name.endswith("_ENUM_END"):
                continue
            if present & val:
                table[entry.name] = {"enabled": bool(enabled & val),
                                     "healthy": bool(health & val)}
        out["sys_status"] = {
            "age_s": _age(ts),
            "unhealthy": [nm for nm, r in table.items() if r["enabled"] and not r["healthy"]],
            "sensors": table,
            "voltage_battery_V": None if s["voltage_battery"] == 65535 else s["voltage_battery"] / 1000,
            "current_battery_A": None if s["current_battery"] == -1 else s["current_battery"] / 100,
            "battery_remaining_pct": None if s["battery_remaining"] == -1 else s["battery_remaining"],
            "load_pct": s["load"] / 10,
        }
    if gps:
        ts, g = gps
        out["gps"] = {"age_s": _age(ts), "fix_type": _enum_name("GPS_FIX_TYPE", g["fix_type"]),
                      "satellites_visible": g["satellites_visible"],
                      "hdop": None if g["eph"] == 65535 else g["eph"] / 100,
                      "alt_m": g["alt"] / 1000}
        if SHOW_PLACE:
            out["gps"]["lat"] = g["lat"] / 1e7
            out["gps"]["lon"] = g["lon"] / 1e7
        else:
            out["gps"]["place"] = _PLACE_LEFT_OUT
    if bat:
        ts, b = bat
        out["battery_status"] = {"age_s": _age(ts), "id": b["id"],
                                 "cells_mV": [c for c in b["voltages"] if c != 65535],
                                 "remaining_pct": b["battery_remaining"]}
    if ekf:
        ts, e = ekf
        out["estimator"] = {"age_s": _age(ts),
                            "flags": _decode_flags("ESTIMATOR_STATUS_FLAGS", e["flags"])}
    if not out:
        out["error"] = "No SYS_STATUS seen yet."
    return out


@mcp.tool()
def traffic() -> dict:
    """Every message type seen, with count, rate (Hz) and age. Useful for checking what
    the vehicle is actually streaming."""
    now = time.time()
    with _lock:
        rows = []
        for t, c in sorted(_state["counts"].items(), key=lambda kv: -kv[1]):
            first = _state["first_seen"][t]
            last = _state["latest"][t][0]
            span = max(last - first, 1e-6)
            rows.append({"type": t, "count": c,
                         "rate_hz": round((c - 1) / span, 2) if c > 1 else None,
                         "age_s": round(now - last, 1)})
    return {"types": len(rows), "messages": rows}


@mcp.tool()
def latest(msg_type: str) -> dict:
    """Raw field dict of the most recent message of the given MAVLink type
    (e.g. 'ATTITUDE', 'RC_CHANNELS', 'EXTENDED_SYS_STATE', 'POWER_STATUS')."""
    with _lock:
        item = _state["latest"].get(msg_type.upper())
        seen = sorted(_state["counts"])
    if item is None:
        return {"error": f"{msg_type.upper()} not seen yet", "seen_types": seen}
    ts, d = item
    return {"type": msg_type.upper(), "age_s": _age(ts), "fields": _without_place(d, msg_type.upper())}


@mcp.tool()
def diff_live_against_file(path: str) -> dict:
    """Compare the live cached parameters against a saved .params file. Shows what has
    changed on the vehicle since that backup was taken."""
    if not os.path.isfile(path):
        return {"error": f"not found: {path}"}
    _, saved = _parse_params_file(path)
    with _lock:
        live = dict(_state["params"])
    changed = {}
    for k in sorted(set(saved) & set(live)):
        lv = live[k]["value"]
        try:
            same = abs(float(saved[k]["value"]) - float(lv)) < 1e-6
        except ValueError:
            same = saved[k]["value"] == str(lv)
        if not same:
            changed[k] = {"file": saved[k]["value"], "live": lv}
    return {"file": path, "live_cached": len(live), "file_count": len(saved),
            "changed": changed,
            "only_in_file": sorted(set(saved) - set(live)),
            "only_live": sorted(set(live) - set(saved))}


# Reading and comparing saved files is the files server's job (mcp/files/), which also
# says what each parameter is. diff_live_against_file stays here: it needs the live cache.

# ---------------------------------------------------------------- entry

def main():
    threading.Thread(target=_listener, daemon=True, name="mavlink-listener").start()
    if "--watch" in sys.argv:
        # Diagnostic mode: print a status line every 2 s instead of serving MCP.
        try:
            while True:
                time.sleep(2)
                s = status()
                v = s.get("vehicle") or {}
                mode = (v.get("mode") or {}).get("name")
                print(f"rx={s['receiving']} types={s['message_types_seen']} "
                      f"params={s['params_received']}/{s['params_expected']} "
                      f"vehicle={v.get('type')} {v.get('autopilot')} "
                      f"mode={mode} armed={v.get('armed')}", flush=True)
        except KeyboardInterrupt:
            pass
        return
    mcp.run()


if __name__ == "__main__":
    main()
