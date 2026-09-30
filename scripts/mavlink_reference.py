"""Write what pymavlink makes of MAVLink, for the app's own reader to be checked against.

    python scripts/mavlink_reference.py scripts/fixtures/mavlink-reference.json

pymavlink is the MAVLink project's own Python library. For every message of the
"common" dialect this script has it BUILD packets with made-up values and then
READ them back, and writes down the bytes and what pymavlink read. It also
writes down what pymavlink knows of each message's layout.

Everything in the output is made up. The values come from a random number
generator with a fixed seed; no aircraft, log or position is involved. The
output is the same every time.

Needs pymavlink (pip install pymavlink). scripts/verify-mavlink.mjs reads the
output and needs no Python.
"""
import json
import math
import os
import random
import struct
import sys

os.environ['MAVLINK20'] = '1'
import pymavlink  # noqa: E402
from pymavlink.dialects.v10 import common as v1  # noqa: E402
from pymavlink.dialects.v20 import common as v2  # noqa: E402

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(2)

rnd = random.Random(20260929)
RANGE = {
    'uint8_t': (0, 2 ** 8 - 1), 'int8_t': (-2 ** 7, 2 ** 7 - 1),
    'uint16_t': (0, 2 ** 16 - 1), 'int16_t': (-2 ** 15, 2 ** 15 - 1),
    'uint32_t': (0, 2 ** 32 - 1), 'int32_t': (-2 ** 31, 2 ** 31 - 1),
    'uint64_t': (0, 2 ** 64 - 1), 'int64_t': (-2 ** 63, 2 ** 63 - 1),
}
LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_ -.'


class Buffer:
    def __init__(self):
        self.data = bytearray()

    def write(self, b):
        self.data += b


def float32(v):
    return struct.unpack('<f', struct.pack('<f', v))[0]


def value(kind, how):
    """One value of a type. how: 'zero', 'edge' or 'any'."""
    if kind in ('float', 'double'):
        if how == 'zero':
            return 0.0
        v = rnd.choice([1.0, -1.0, 0.5, 1e-7, 3.4e38 if kind == 'float' else 1.7e308, -273.15]) if how == 'edge' \
            else rnd.uniform(-1, 1) * 10 ** rnd.randint(-6, 9)
        return float32(v) if kind == 'float' else v
    lo, hi = RANGE[kind]
    if how == 'zero':
        return 0
    if how == 'edge':
        return rnd.choice([lo, hi, 1, hi - 1])
    return rnd.randint(lo, hi)


def arguments(cls, how):
    out = []
    # pymavlink gives the types in the order the fields are written, and the array lengths in the order on the wire
    lengths = dict(zip(cls.ordered_fieldnames, cls.array_lengths))
    for name, kind in zip(cls.fieldnames, cls.fieldtypes):
        n = lengths[name]
        if kind == 'char':
            if how == 'zero':
                text = ''
            elif how == 'edge':
                text = ''.join(rnd.choice(LETTERS) for _ in range(max(n, 1)))   # fills the field: no ending zero
            else:
                text = ''.join(rnd.choice(LETTERS) for _ in range(rnd.randint(0, max(n, 1))))
            out.append(text.encode('ascii') if n else (text[:1].encode('ascii') or b'\0'))
        elif n:
            out.append([value(kind, how) for _ in range(n)])
        else:
            out.append(value(kind, how))
    return out


def plain(v):
    """A value as JSON can hold it exactly."""
    if isinstance(v, (bytes, bytearray)):
        return v.decode('ascii', errors='replace').rstrip('\0')
    if isinstance(v, str):
        return v.rstrip('\0')
    if isinstance(v, float):
        if math.isnan(v):
            return 'NaN'
        if math.isinf(v):
            return 'Infinity' if v > 0 else '-Infinity'
        return v
    if isinstance(v, int):
        # beyond what JavaScript's numbers hold exactly: as text
        return str(v) if abs(v) > 2 ** 53 else v
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    return v


def read_back(module, data):
    reader = module.MAVLink(None)
    # without this pymavlink raises on a packet it cannot read, instead of saying so
    reader.robust_parsing = True
    got = reader.parse_buffer(bytes(data)) or []
    return [m for m in got if m.get_type() != 'BAD_DATA']


layouts = []
for mid in sorted(v2.mavlink_map):
    c = v2.mavlink_map[mid]
    layouts.append({
        'id': mid, 'name': c.msgname, 'crc_extra': c.crc_extra,
        'declared': list(c.fieldnames), 'wire': list(c.ordered_fieldnames),
        'types': dict(zip(c.fieldnames, c.fieldtypes)),
        'lengths': dict(zip(c.ordered_fieldnames, c.array_lengths)),
        'payload_bytes': c.unpacker.size,
    })

packets = []
stream = bytearray()
stream_names = []
seq = 0
for mid in sorted(v2.mavlink_map):
    for version, module in ((2, v2), (1, v1)):
        if version == 1 and (mid > 255 or mid not in module.mavlink_map):
            continue
        cls = module.mavlink_map[mid]
        for how in ('zero', 'edge', 'any', 'any'):
            buf = Buffer()
            system, component = rnd.randint(1, 250), rnd.randint(1, 250)
            mav = module.MAVLink(buf, srcSystem=system, srcComponent=component)
            mav.seq = seq % 256
            seq += 1
            try:
                msg = cls(*arguments(cls, how))
                mav.send(msg)
            except Exception as err:  # noqa: BLE001
                print(f'  could not build {cls.msgname} ({how}, v{version}): {err}')
                continue
            back = read_back(module, buf.data)
            if len(back) != 1:
                print(f'  pymavlink did not read back its own {cls.msgname} ({how}, v{version})')
                continue
            d = back[0].to_dict()
            d.pop('mavpackettype', None)
            packets.append({
                'name': cls.msgname, 'id': mid, 'version': version, 'how': how,
                'system': system, 'component': component, 'seq': back[0].get_seq(),
                'hex': bytes(buf.data).hex(),
                'fields': {k: plain(v) for k, v in d.items()},
            })
            if how == 'any':
                # a stream: packets end to end, with bytes between that are no packet
                stream += bytes(rnd.randint(0, 255) for _ in range(rnd.randint(0, 3))) + buf.data
                stream_names.append(cls.msgname)

# signed packets: thirteen more bytes after the checksum, which a reader steps over
signed = []
for mid in (0, 1, 24, 30, 253):
    cls = v2.mavlink_map[mid]
    buf = Buffer()
    mav = v2.MAVLink(buf, srcSystem=1, srcComponent=1)
    mav.signing.secret_key = bytes(range(32))
    mav.signing.link_id = 0
    mav.signing.timestamp = 1
    mav.signing.sign_outgoing = True
    mav.send(cls(*arguments(cls, 'any')))
    reader = v2.MAVLink(None)
    got = [m for m in (reader.parse_buffer(bytes(buf.data)) or []) if m.get_type() != 'BAD_DATA']
    d = got[0].to_dict()
    d.pop('mavpackettype', None)
    signed.append({'name': cls.msgname, 'hex': bytes(buf.data).hex(), 'fields': {k: plain(v) for k, v in d.items()}})

# damaged packets: one byte changed in the payload. pymavlink reads none of them as the message.
damaged = []
for p in rnd.sample([p for p in packets if p['how'] == 'any' and len(p['hex']) > 40], 60):
    raw = bytearray.fromhex(p['hex'])
    at = rnd.randint(10 if p['version'] == 2 else 6, len(raw) - 3)
    raw[at] ^= 1 << rnd.randint(0, 7)
    module = v2 if p['version'] == 2 else v1
    names = [m.get_type() for m in read_back(module, raw)]
    if p['name'] not in names:
        damaged.append({'name': p['name'], 'hex': bytes(raw).hex()})

out = {
    'schema': 'flight-companion/mavlink-reference@1',
    'about': 'What pymavlink makes of MAVLink: the layout of every message of the common dialect, and packets it built '
             'from made-up values with what it read back from them. Nothing here is from an aircraft.',
    'pymavlink': getattr(pymavlink, '__version__', 'unknown'),
    'layouts': layouts,
    'packets': packets,
    'signed': signed,
    'damaged': damaged,
    'stream': {'hex': bytes(stream).hex(), 'names': stream_names},
}
with open(sys.argv[1], 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, separators=(',', ':'))
print(f'{len(layouts)} layouts, {len(packets)} packets, {len(signed)} signed, {len(damaged)} damaged, '
      f'a stream of {len(stream_names)} -> {sys.argv[1]} ({os.path.getsize(sys.argv[1]) // 1024} KB)')
