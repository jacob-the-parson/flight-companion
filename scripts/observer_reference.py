"""Write what the Python observer answers, for the JavaScript one to be checked against.

    python scripts/observer_reference.py scripts/fixtures/observer-reference.json

A made-up session is played to the Python observer (mcp/observer/server.py):
packets built by pymavlink, given to the observer's own handler as its listener
would give them, with a clock that this script moves. At several points every
tool is asked, and what it answers is written down with the packets.

scripts/verify-observer-js.mjs plays the same packets to the JavaScript
observer and compares the answers. It needs no Python.

Nothing here is from an aircraft. No socket is opened: the observer's listener
is never started. The position used is the default home of PX4's simulator.
"""
import json
import math
import os
import struct
import sys
import time

os.environ['MAVLINK20'] = '1'
os.environ.pop('FC_OBSERVER_PLACE', None)
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'mcp', 'observer'))

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(2)

clock = [1000.0]
time.time = lambda: clock[0]          # the observer asks the time through this

import server  # noqa: E402
from pymavlink.dialects.v20 import common as mav  # noqa: E402

LAT, LON = 47.397742, 8.545594


class Buffer:
    def __init__(self):
        self.data = bytearray()

    def write(self, b):
        self.data += b


def px4_whole(value, fmt='<i'):
    """PX4 puts a whole-number parameter's bytes where the number with a fraction goes."""
    raw = struct.pack(fmt, value)
    return struct.unpack('<f', raw + b'\0' * (4 - len(raw)))[0]


def plain(v):
    if isinstance(v, float):
        if math.isnan(v):
            return 'nan'
        if math.isinf(v):
            return 'inf' if v > 0 else '-inf'
        return v
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return str(v) if abs(v) > 2 ** 53 - 1 else v
    if isinstance(v, (bytes, bytearray)):
        return v.decode('ascii', errors='replace').rstrip('\0')
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    return v


PARAMS_TEXT = '\n'.join([
    '# Onboard parameters for Vehicle 1',
    '#',
    '# Vehicle-Id Component-Id Name Value Type',
    '1\t1\tBAT_LOW_THR\t0.150000005960464478\t9',      # the same number, written long
    '1\t1\tBAT1_N_CELLS\t4\t6',
    '1\t1\tCOM_RC_LOSS_T\t0.5\t9',                       # differs: the aircraft holds 1.5
    '1\t1\tMPC_XY_VEL_MAX\t12.0\t9',
    '1\t1\tSYS_AUTOSTART\t4001\t6',                      # differs: the aircraft holds 4019
    '1\t1\tONLY_IN_FILE\t1\t6',
    '1\t1\tEKF2_TINY\t0.0000001\t9',                     # see verify-observer-js.mjs
    '',
])

PARAMS_NAME = 'observer-reference.params'
packets = []
points = []
sent = [0]


def feed(system, build, step=0.1):
    """Build packets as `system`, and give each to the observer as its listener would."""
    buf = Buffer()
    m = mav.MAVLink(buf, srcSystem=system, srcComponent=1)
    m.seq = sent[0] % 256
    build(m)
    reader = mav.MAVLink(None)
    reader.robust_parsing = True
    for msg in reader.parse_buffer(bytes(buf.data)) or []:
        clock[0] = round(clock[0] + step, 3)
        raw = bytes(msg.get_msgbuf())
        server._state['bytes_seen'] += len(raw)
        server._handle(msg)
        packets.append({'t': clock[0], 'hex': raw.hex()})
        sent[0] += 1


def ask(name, params_file):
    """Every tool, as the observer answers now."""
    clock[0] = round(clock[0] + 0.3, 3)
    answers = {
        'status': server.status(),
        'autopilot_version': server.autopilot_version(),
        'params': server.params(),
        'params BAT': server.params(prefix='bat'),
        'params limit 2': server.params(limit=2),
        'param SYS_AUTOSTART': server.param('SYS_AUTOSTART'),
        'param lower case': server.param('cbrk_io_safety'),
        'param NOT_THERE': server.param('NOT_THERE'),
        'messages': server.messages(),
        'messages warnings': server.messages(n=10, min_severity=4),
        'messages last 2': server.messages(n=2),
        'sensors': server.sensors(),
        'traffic': server.traffic(),
        'diff_live_against_file': server.diff_live_against_file(params_file),
    }
    for kind in ('HEARTBEAT', 'ATTITUDE', 'GPS_RAW_INT', 'GLOBAL_POSITION_INT', 'HOME_POSITION',
                 'MISSION_ITEM_INT', 'AUTOPILOT_VERSION', 'BATTERY_STATUS', 'SYS_STATUS',
                 'ESTIMATOR_STATUS', 'STATUSTEXT', 'PARAM_VALUE', 'VFR_HUD', 'NOT_A_MESSAGE'):
        answers[f'latest {kind}'] = server.latest(kind)
    answers['latest lower case'] = server.latest('attitude')
    # the file's name and not its path, which would name this computer's user
    answers['diff_live_against_file']['file'] = PARAMS_NAME
    points.append({'name': name, 'after': len(packets), 'now': clock[0], 'place': server.SHOW_PLACE,
                   'answers': plain(answers)})


def main():
    params_file = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), 'observer-reference.params.tmp')
    with open(params_file, 'w', encoding='utf-8', newline='\n') as f:
        f.write(PARAMS_TEXT)
    started = server._state['started']

    ask('before anything is heard', params_file)

    # the ground station's own traffic, which is not the aircraft's
    feed(255, lambda m: m.heartbeat_send(mav.MAV_TYPE_GCS, mav.MAV_AUTOPILOT_INVALID, 192, 0, mav.MAV_STATE_ACTIVE))
    feed(255, lambda m: m.param_request_list_send(1, 1))
    ask('only the ground station has spoken', params_file)

    loiter = (4 << 16) | (3 << 24)
    posctl = 3 << 16

    def first(m):
        m.heartbeat_send(mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_PX4, 81, loiter, mav.MAV_STATE_STANDBY)
        m.sys_status_send(0x8C21802F, 0x8C01802F, 0x8C21800F, 412, 15870, 123, 87, 0, 0, 0, 0, 0, 0)
        m.gps_raw_int_send(123456789, mav.GPS_FIX_TYPE_3D_FIX, int(LAT * 1e7), int(LON * 1e7), 488123,
                           90, 120, 0, 0, 14)
        m.global_position_int_send(1000, int(LAT * 1e7), int(LON * 1e7), 488123, 1500, 0, 0, 0, 9000)
        m.home_position_send(int(LAT * 1e7), int(LON * 1e7), 488000, 0, 0, 0, [1, 0, 0, 0], 0, 0, 0)
        m.attitude_send(1000, 0.0125, -0.03, 1.5707964, 0.001, -0.002, 0.0)
        m.vfr_hud_send(0.0, 0.0, 90, 0, 0.12, float('nan'))
        m.battery_status_send(0, mav.MAV_BATTERY_FUNCTION_ALL, mav.MAV_BATTERY_TYPE_LIPO, 2710,
                              [3967, 3968, 3966, 3969, 65535, 65535, 65535, 65535, 65535, 65535],
                              123, 410, 23000, 87)
        m.estimator_status_send(2000, 831, 0.1, 0.2, 0.05, 0.01, 0.02, 0.03, 0.4, 0.6)
        m.autopilot_version_send(0x000000000000E5EF, 0x011000FF, 0x011000FF, 0x0B0000FF, 0x00320000,
                                 [0x3e, 0x5a, 0x45, 0x9d, 0x30, 0x20, 0x44, 0x3e],
                                 [0x3e, 0x5a, 0x45, 0x9d, 0x30, 0x20, 0x44, 0x3e],
                                 [0xc2, 0x8b, 0x49, 0x63, 0x17, 0x2d, 0x61, 0x7a],
                                 0x3185, 0x0038, 0xA1B2C3D4E5F60718,
                                 [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 250])
        m.mission_item_int_send(0, 0, 1, mav.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT, mav.MAV_CMD_NAV_WAYPOINT,
                                0, 1, 0, 0, 0, 0, int(LAT * 1e7) + 1000, int(LON * 1e7) - 1000, 20)
        m.statustext_send(mav.MAV_SEVERITY_INFO, b'Ready for takeoff')
        m.statustext_send(mav.MAV_SEVERITY_WARNING, b'Preflight Fail: made-up reason')
        m.statustext_send(mav.MAV_SEVERITY_CRITICAL, b'x' * 50)     # fills the field, in one piece
    feed(1, first)
    ask('a first round of everything', params_file)

    count = 9

    def some_params(m):
        m.param_value_send(b'SYS_AUTOSTART', px4_whole(4019), mav.MAV_PARAM_TYPE_INT32, count, 0)
        m.param_value_send(b'BAT_LOW_THR', 0.15, mav.MAV_PARAM_TYPE_REAL32, count, 1)
        m.param_value_send(b'BAT1_N_CELLS', px4_whole(4), mav.MAV_PARAM_TYPE_INT32, count, 2)
        m.param_value_send(b'CBRK_IO_SAFETY', px4_whole(22027), mav.MAV_PARAM_TYPE_INT32, count, 3)
        m.param_value_send(b'COM_RC_LOSS_T', 1.5, mav.MAV_PARAM_TYPE_REAL32, count, 4)
        m.param_value_send(b'MPC_XY_VEL_MAX', 12.0, mav.MAV_PARAM_TYPE_REAL32, count, 5)
        # -1 as bytes is "not a number" when read as a number with a fraction
        m.param_value_send(b'BAT1_R_INTERNAL_', px4_whole(-1), mav.MAV_PARAM_TYPE_INT32, count, 6)   # 16 letters: fills the field
        m.param_value_send(b'MADE_UP_NEG', px4_whole(-2147483648), mav.MAV_PARAM_TYPE_INT32, count, 7)
        m.param_value_send(b'EKF2_TINY', 5e-7, mav.MAV_PARAM_TYPE_REAL32, count, 8)
    feed(1, some_params, step=0.05)

    def pieces(m):
        # a long message, in pieces: two that fill the field and one that ends it
        text = ('Preflight Fail: a made-up message that is long enough to need three pieces, '
                'as a real one sometimes is, and then some more.')
        parts = [text[i:i + 50] for i in range(0, len(text), 50)]
        for n, part in enumerate(parts):
            m.statustext_send(mav.MAV_SEVERITY_ERROR, part.encode('ascii'), 7, n)
    feed(1, pieces)
    for _ in range(4):
        feed(1, lambda m: m.heartbeat_send(mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_PX4, 81 | 128, posctl,
                                           mav.MAV_STATE_ACTIVE), step=1.0)
        feed(1, lambda m: m.attitude_send(2000, 0.02, -0.01, 1.6, 0.0, 0.0, 0.0), step=0.02)
    ask('parameters held, a long message, armed', params_file)

    server.SHOW_PLACE = True
    ask('the same, with the place allowed', params_file)
    server.SHOW_PLACE = False

    # after a restart the aircraft has a different number of parameters
    feed(1, lambda m: m.param_value_send(b'SYS_AUTOSTART', px4_whole(4019), mav.MAV_PARAM_TYPE_INT32, count + 2, 0))
    feed(1, lambda m: m.param_value_send(b'MADE_UP_U8', px4_whole(200, '<B'), mav.MAV_PARAM_TYPE_UINT8, count + 2, 1))
    feed(1, lambda m: m.param_value_send(b'MADE_UP_I16', px4_whole(-300, '<h'), mav.MAV_PARAM_TYPE_INT16, count + 2, 2))
    clock[0] += 12.0
    ask('after a restart, and then silence', params_file)

    os.remove(params_file)
    out = {
        'schema': 'flight-companion/observer-reference@1',
        'about': 'What the Python observer answers to a made-up session. Nothing here is from an aircraft; the position '
                 'is the default home of the PX4 simulator.',
        'started': started,
        'params_file': PARAMS_NAME,
        'params_text': PARAMS_TEXT,
        'packets': packets,
        'points': points,
    }
    with open(sys.argv[1], 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{len(packets)} packets, {len(points)} points, {sum(len(p["answers"]) for p in points)} answers '
          f'-> {sys.argv[1]} ({os.path.getsize(sys.argv[1]) // 1024} KB)')


main()
