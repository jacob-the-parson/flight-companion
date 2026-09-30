"""Write the practice flight the Live screen plays when no aircraft is connected.

    python scripts/observer_practice.py public/data/practice-telemetry.json

One minute of MADE-UP telemetry: an aircraft that stands, arms, climbs to five
metres, hovers with a little wobble while its battery sags, lands and disarms.
The packets are built by pymavlink, so they are real MAVLink with made-up
numbers in it, and the app reads them with the same reader it uses for an
aircraft.

Nothing here is from an aircraft or a log. The position is the default home of
PX4's simulator. Every text message begins "Practice:" so that nobody takes it
for something PX4 said.
"""
import json
import math
import os
import struct
import sys

os.environ['MAVLINK20'] = '1'
from pymavlink.dialects.v20 import common as mav  # noqa: E402

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(2)

LAT, LON, GROUND = 47.397742, 8.545594, 488.0
SECONDS = 60
ARM, UP, DOWN, LANDED = 8.0, 12.0, 45.0, 52.0
HOVER = 5.0


class Buffer:
    def __init__(self):
        self.data = bytearray()

    def write(self, b):
        self.data += b


buf = Buffer()
m = mav.MAVLink(buf, srcSystem=1, srcComponent=1)
packets = []


def put(t, send):
    buf.data = bytearray()
    send()
    packets.append([round(t, 2), bytes(buf.data).hex()])


def whole(v):
    return struct.unpack('<f', struct.pack('<i', v))[0]


def height(t):
    if t < ARM + 1:
        return 0.0
    if t < UP:
        return HOVER * (t - ARM - 1) / (UP - ARM - 1)
    if t < DOWN:
        return HOVER + 0.15 * math.sin(t * 0.9)
    if t < LANDED:
        return max(0.0, HOVER * (1 - (t - DOWN) / (LANDED - DOWN - 0.5)))
    return 0.0


def flying(t):
    return ARM + 1 <= t < LANDED - 0.5


def armed(t):
    return ARM <= t < LANDED


def volts(t):
    rest = 16.6 - 0.004 * t
    return rest - (0.75 + 0.006 * (t - ARM) if flying(t) else 0.0)


POSCTL = 3 << 16
steps = int(SECONDS * 20)
for i in range(steps):
    t = i / 20
    ms = int(t * 1000)
    if i % 20 == 0:                                   # once a second
        put(t, lambda: m.heartbeat_send(mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_PX4,
                                        81 | (128 if armed(t) else 0), POSCTL,
                                        mav.MAV_STATE_ACTIVE if armed(t) else mav.MAV_STATE_STANDBY))
        mv = int(volts(t) * 1000)
        amps = 14.2 + 0.6 * math.sin(t) if flying(t) else 0.4
        left = max(0, int(96 - (t - ARM) * 0.45)) if t > ARM else 96
        put(t, lambda: m.sys_status_send(0x0C21802F, 0x0C01802F, 0x0C21802F, 380 if flying(t) else 210,
                                         mv, int(amps * 100), left, 0, 0, 0, 0, 0, 0))
        put(t, lambda: m.gps_raw_int_send(ms * 1000, mav.GPS_FIX_TYPE_3D_FIX, int(LAT * 1e7), int(LON * 1e7),
                                          int((GROUND + height(t)) * 1000), 80, 110, 0, 0, 14))
        put(t, lambda: m.extended_sys_state_send(mav.MAV_VTOL_STATE_UNDEFINED,
                                                 mav.MAV_LANDED_STATE_IN_AIR if flying(t) else mav.MAV_LANDED_STATE_ON_GROUND))
    if i % 40 == 0:                                   # every two seconds
        cell = int(volts(t) * 1000 / 4)
        put(t, lambda: m.battery_status_send(0, mav.MAV_BATTERY_FUNCTION_ALL, mav.MAV_BATTERY_TYPE_LIPO, 2600,
                                             [cell + 2, cell - 1, cell, cell - 1] + [65535] * 6,
                                             int((14.2 if flying(t) else 0.4) * 100), int(max(0, t - ARM) * 4), -1,
                                             max(0, int(96 - (t - ARM) * 0.45)) if t > ARM else 96))
    if i % 2 == 0:                                    # ten times a second
        wobble = 1.0 if flying(t) else 0.0
        roll = math.radians(2.2 * math.sin(t * 1.7) + 0.6 * math.sin(t * 5.1)) * wobble
        pitch = math.radians(1.8 * math.sin(t * 1.3 + 1.0) + 0.5 * math.sin(t * 4.3)) * wobble
        yaw = math.radians(90 + (max(0.0, min(t, DOWN) - UP) * 4.0 if t > UP else 0.0))
        yaw = (yaw + math.pi) % (2 * math.pi) - math.pi
        put(t, lambda: m.attitude_send(ms, roll, pitch, yaw, 0.0, 0.0, math.radians(4.0) if UP < t < DOWN else 0.0))
    if i % 5 == 0:                                    # four times a second
        h = height(t)
        climb = (height(t + 0.25) - h) / 0.25
        heading = int(90 + (max(0.0, min(t, DOWN) - UP) * 4.0 if t > UP else 0.0)) % 360
        put(t, lambda: m.global_position_int_send(ms, int(LAT * 1e7), int(LON * 1e7), int((GROUND + h) * 1000),
                                                  int(h * 1000), 0, 0, int(-climb * 100), heading * 100))
        put(t, lambda: m.vfr_hud_send(0.0, 0.2 if flying(t) else 0.0, heading, 52 if flying(t) else 0,
                                      GROUND + h, climb))

    # things that happen once
    if i == 2:
        put(t, lambda: m.autopilot_version_send(0xE5EF, 0x011000FF, 0x011000FF, 0x0B0000FF, 0x00320000,
                                                [0] * 8, [0] * 8, [0] * 8, 0x3185, 0x0038, 0, [0] * 18))
        for n, (name, value, kind) in enumerate([
                (b'SYS_AUTOSTART', whole(4001), mav.MAV_PARAM_TYPE_INT32),
                (b'BAT1_N_CELLS', whole(4), mav.MAV_PARAM_TYPE_INT32),
                (b'BAT_LOW_THR', 0.15, mav.MAV_PARAM_TYPE_REAL32),
                (b'MPC_XY_VEL_MAX', 12.0, mav.MAV_PARAM_TYPE_REAL32)]):
            put(t, lambda: m.param_value_send(name, value, kind, 4, n))
        put(t, lambda: m.statustext_send(mav.MAV_SEVERITY_INFO, b'Practice: this flight is made up'))
    for when, severity, text in [
            (ARM, mav.MAV_SEVERITY_INFO, b'Practice: armed'),
            (ARM + 1, mav.MAV_SEVERITY_INFO, b'Practice: taking off'),
            (30.0, mav.MAV_SEVERITY_WARNING, b'Practice: battery getting low'),
            (DOWN, mav.MAV_SEVERITY_INFO, b'Practice: landing'),
            (LANDED, mav.MAV_SEVERITY_INFO, b'Practice: landed, disarmed')]:
        if i == int(when * 20):
            put(t, lambda: m.statustext_send(severity, text))

packets.sort(key=lambda p: p[0])
out = {
    'schema': 'flight-companion/practice-telemetry@1',
    'about': 'One minute of made-up telemetry for the Live screen. Built by pymavlink from made-up numbers. '
             'Nothing here is from an aircraft; the position is the default home of the PX4 simulator.',
    'seconds': SECONDS,
    'packets': packets,
}
with open(sys.argv[1], 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, separators=(',', ':'))
print(f'{len(packets)} packets over {SECONDS} s -> {sys.argv[1]} ({os.path.getsize(sys.argv[1]) // 1024} KB)')
