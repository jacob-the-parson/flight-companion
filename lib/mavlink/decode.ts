// Reading MAVLink: bytes in, messages out. It reads and does nothing else:
// there is no function in this file that makes a packet.
//
// A packet, as MAVLink's documentation gives it (mavlink.io, "Serialization"):
//
//   MAVLink 2   0xFD  len  incompat  compat  seq  sysid  compid  msgid(3)  payload  crc(2)  [signature(13)]
//   MAVLink 1   0xFE  len                    seq  sysid  compid  msgid(1)  payload  crc(2)
//
// The checksum is CRC-16/MCRF4XX over everything after the first byte and
// before the checksum itself, and then over one more byte, CRC_EXTRA, which
// each end knows for each message and which is never sent. A packet whose
// checksum does not come out right is dropped: it was damaged, or it is a
// message this reader has a different layout for.
//
// In MAVLink 2 the zero bytes at the end of a payload are not sent. The reader
// puts them back.
import { MAV_ENUMS, MAV_MESSAGES, type MavField, type MavMessage, type MavType } from './messages.ts';

export type MavValue = number | bigint | string | number[] | bigint[];

export interface MavPacket {
  /** 1 or 2. */
  version: number;
  seq: number;
  /** Who sent it. A ground station is usually 255. */
  system: number;
  component: number;
  id: number;
  name: string;
  fields: Record<string, MavValue>;
  /** The payload as it was sent, with the zeros MAVLink 2 leaves off the end put back. */
  payload: Uint8Array;
  signed: boolean;
}

export interface DecodeStats {
  packets: number;
  /** Bytes that were not part of any packet. */
  skipped: number;
  /** Packets whose checksum did not come out right. */
  badChecksum: number;
  /** Packets of a message this reader has no layout for. */
  unknown: number;
}

const V2 = 0xfd;
const V1 = 0xfe;
const SIGNED = 0x01;
const SIZE: Record<MavType, number> = {
  uint64_t: 8,
  int64_t: 8,
  double: 8,
  uint32_t: 4,
  int32_t: 4,
  float: 4,
  uint16_t: 2,
  int16_t: 2,
  uint8_t: 1,
  int8_t: 1,
  char: 1,
};

/** CRC-16/MCRF4XX, a byte at a time. */
export function crcAccumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function crcOf(bytes: Uint8Array, from: number, to: number, extra: number): number {
  let crc = 0xffff;
  for (let i = from; i < to; i++) crc = crcAccumulate(bytes[i], crc);
  return crcAccumulate(extra, crc);
}

function one(view: DataView, at: number, type: MavType): number | bigint {
  switch (type) {
    case 'uint8_t':
    case 'char':
      return view.getUint8(at);
    case 'int8_t':
      return view.getInt8(at);
    case 'uint16_t':
      return view.getUint16(at, true);
    case 'int16_t':
      return view.getInt16(at, true);
    case 'uint32_t':
      return view.getUint32(at, true);
    case 'int32_t':
      return view.getInt32(at, true);
    case 'float':
      return view.getFloat32(at, true);
    case 'double':
      return view.getFloat64(at, true);
    case 'uint64_t':
      return view.getBigUint64(at, true);
    case 'int64_t':
      return view.getBigInt64(at, true);
  }
}

const text = new TextDecoder('utf-8', { fatal: false });

function field(view: DataView, at: number, f: MavField): MavValue {
  if (f.length === 0) return one(view, at, f.type);
  if (f.type === 'char') {
    // a string ends at its first zero byte, or at the end of the field
    const bytes = new Uint8Array(view.buffer, view.byteOffset + at, f.length);
    const end = bytes.indexOf(0);
    return text.decode(end < 0 ? bytes : bytes.subarray(0, end));
  }
  const out: (number | bigint)[] = [];
  for (let i = 0; i < f.length; i++) out.push(one(view, at + i * SIZE[f.type], f.type));
  return out as number[] | bigint[];
}

/** A payload at its message's full length. What was not sent is zero. */
export function wholePayload(message: MavMessage, payload: Uint8Array): Uint8Array {
  const whole = new Uint8Array(message.length);
  whole.set(payload.subarray(0, message.length));
  return whole;
}

/** Where a field starts in a whole payload, or -1. */
export function offsetOf(message: MavMessage, name: string): number {
  let at = 0;
  for (const f of message.fields) {
    if (f.name === name) return at;
    at += SIZE[f.type] * (f.length || 1);
  }
  return -1;
}

/** The fields of a payload. The payload may be shorter than the message: what is missing is zero. */
export function decodePayload(message: MavMessage, payload: Uint8Array): Record<string, MavValue> {
  const whole = wholePayload(message, payload);
  const view = new DataView(whole.buffer);
  const out: Record<string, MavValue> = {};
  let at = 0;
  for (const f of message.fields) {
    out[f.name] = field(view, at, f);
    at += SIZE[f.type] * (f.length || 1);
  }
  // given back in the order the definition writes them, which is the order people read them in
  const ordered: Record<string, MavValue> = {};
  for (const name of message.declared) ordered[name] = out[name];
  return ordered;
}

/**
 * Takes bytes as they arrive, in whatever pieces, and gives back the packets in
 * them. It keeps what is left of an unfinished packet for the next call.
 */
export class MavlinkReader {
  private rest = new Uint8Array(0);
  readonly stats: DecodeStats = { packets: 0, skipped: 0, badChecksum: 0, unknown: 0 };

  /** Forget an unfinished packet. A datagram holds whole packets, so what is left of one is not the start of the next. */
  clear(): void {
    this.stats.skipped += this.rest.length;
    this.rest = new Uint8Array(0);
  }

  push(chunk: Uint8Array): MavPacket[] {
    let data = chunk;
    if (this.rest.length > 0) {
      data = new Uint8Array(this.rest.length + chunk.length);
      data.set(this.rest);
      data.set(chunk, this.rest.length);
    }
    const out: MavPacket[] = [];
    let at = 0;
    while (at < data.length) {
      const magic = data[at];
      if (magic !== V2 && magic !== V1) {
        at += 1;
        this.stats.skipped += 1;
        continue;
      }
      const v2 = magic === V2;
      const header = v2 ? 10 : 6;
      if (data.length - at < header) break;
      const len = data[at + 1];
      const signed = v2 && (data[at + 2] & SIGNED) !== 0;
      const total = header + len + 2 + (signed ? 13 : 0);
      if (data.length - at < total) break;

      const id = v2 ? data[at + 7] | (data[at + 8] << 8) | (data[at + 9] << 16) : data[at + 5];
      const message = MAV_MESSAGES[id];
      const sent = data[at + header + len] | (data[at + header + len + 1] << 8);
      if (!message) {
        // without the message's CRC_EXTRA the checksum cannot be checked, so whether this is
        // a packet at all is not known. Step over the one byte and look again.
        this.stats.unknown += 1;
        at += 1;
        continue;
      }
      if (crcOf(data, at + 1, at + header + len, message.crcExtra) !== sent) {
        this.stats.badChecksum += 1;
        at += 1;
        continue;
      }
      // a MAVLink 2 packet with flags this reader does not know must be dropped
      if (v2 && (data[at + 2] & ~SIGNED) !== 0) {
        at += total;
        continue;
      }
      out.push({
        version: v2 ? 2 : 1,
        seq: data[at + (v2 ? 4 : 2)],
        system: data[at + (v2 ? 5 : 3)],
        component: data[at + (v2 ? 6 : 4)],
        id,
        name: message.name,
        fields: decodePayload(message, data.subarray(at + header, at + header + len)),
        payload: wholePayload(message, data.subarray(at + header, at + header + len)),
        signed,
      });
      this.stats.packets += 1;
      at += total;
    }
    this.rest = data.slice(at);
    // a run of bytes that never becomes a packet is not kept for ever
    if (this.rest.length > 4096) {
      this.stats.skipped += this.rest.length;
      this.rest = new Uint8Array(0);
    }
    return out;
  }
}

/** The name of a value in one of MAVLink's lists, or the fallback. */
export function enumName(name: string, value: number, fallback = '?'): string {
  return MAV_ENUMS[name]?.values[value] ?? fallback;
}

/** The names of the flags that are set in a value. */
export function flagNames(name: string, value: number): string[] {
  const e = MAV_ENUMS[name];
  if (!e) return [];
  const out: string[] = [];
  for (const [k, label] of Object.entries(e.values)) {
    const bit = Number(k);
    if (bit === 0 || !Number.isSafeInteger(bit) || label.endsWith('_ENUM_END')) continue;
    // by division, not by &: a flag can be above bit 31
    if (Math.floor(value / bit) % 2 === 1 && (bit & (bit - 1)) === 0) out.push(label);
    else if ((bit & (bit - 1)) !== 0 && bit <= 0x7fffffff && (value & bit) === bit) out.push(label);
  }
  return out;
}
