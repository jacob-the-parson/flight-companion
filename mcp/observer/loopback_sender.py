#!/usr/bin/env python3
"""
A stand-in for QGroundControl's forwarding, for testing the observer with no
aircraft and no QGroundControl.

It sends a few made-up MAVLink messages to the observer ON THIS COMPUTER and
stops. The address is fixed at 127.0.0.1 and cannot be changed: this program
cannot reach an aircraft, a ground station or another computer.

    python loopback_sender.py <port>

The port must be the one the observer under test listens on. 14550 and 14540,
where a ground station and a simulator listen, are refused.
"""

import os
import struct
import sys
import time

os.environ.setdefault("MAVLINK20", "1")
from pymavlink import mavutil  # noqa: E402

mav = mavutil.mavlink
ONLY_HERE = "127.0.0.1"
NOT_THESE = (14550, 14540, 14556, 14557, 14580, 18570)


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print(__doc__)
        return 2
    port = int(sys.argv[1])
    if port in NOT_THESE or port < 1024:
        print(f"refused: {port} is not a port for a test")
        return 2

    out = mavutil.mavlink_connection(f"udpout:{ONLY_HERE}:{port}", source_system=1, source_component=1)
    m = out.mav
    px4_int = lambda v: struct.unpack("<f", struct.pack("<i", v))[0]  # noqa: E731
    for _ in range(5):
        m.heartbeat_send(mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_PX4, 0, (4 << 16) | (3 << 24),
                         mav.MAV_STATE_STANDBY)
        m.param_value_send(b"SYS_AUTOSTART", px4_int(4019), mav.MAV_PARAM_TYPE_INT32, 2, 0)
        m.param_value_send(b"BAT_LOW_THR", 0.3, mav.MAV_PARAM_TYPE_REAL32, 2, 1)
        m.statustext_send(mav.MAV_SEVERITY_INFO, b"loopback test")
        # the default home of PX4's simulator: a place nobody flies
        m.gps_raw_int_send(0, mav.GPS_FIX_TYPE_3D_FIX, 473977420, 85455940, 488000, 90, 120, 0, 0, 14)
        time.sleep(0.2)
    out.close()
    print("sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())
