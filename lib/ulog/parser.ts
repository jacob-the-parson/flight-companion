/**
 * PX4 ULog reader.
 *
 * Format reference: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 *
 * Design: one pass over the file builds an index (where every data message of every
 * topic starts). Values are decoded on demand, per field, straight from the file's
 * bytes. Memory use is the file plus the index, whatever the log length.
 *
 * This file has no imports on purpose, so it runs unchanged in the browser, in a Web
 * Worker, and under plain Node for verification against pyulog.
 */

export type ULogScalarType =
  | "int8_t"
  | "uint8_t"
  | "int16_t"
  | "uint16_t"
  | "int32_t"
  | "uint32_t"
  | "int64_t"
  | "uint64_t"
  | "float"
  | "double"
  | "bool"
  | "char";

const TYPE_SIZE: Record<ULogScalarType, number> = {
  int8_t: 1,
  uint8_t: 1,
  int16_t: 2,
  uint16_t: 2,
  int32_t: 4,
  uint32_t: 4,
  int64_t: 8,
  uint64_t: 8,
  float: 4,
  double: 8,
  bool: 1,
  char: 1,
};

function isScalar(t: string): t is ULogScalarType {
  return Object.prototype.hasOwnProperty.call(TYPE_SIZE, t);
}

interface FormatField {
  type: string;
  arrayLength: number; // 0 = not an array
  name: string;
}

export interface ULogField {
  /** Flattened name, pyulog style: `xyz[0]`, `q[3]`, `voltage_cell_v[2]`, `nested.value`. */
  name: string;
  type: ULogScalarType;
  /** Byte offset inside the data message payload. */
  offset: number;
}

export interface ULogTopic {
  /** `name` for instance 0, `name#1` for further instances. */
  key: string;
  name: string;
  multiId: number;
  msgId: number;
  fields: ULogField[];
  /** Number of data messages logged for this topic. */
  count: number;
}

export interface ULogLoggedMessage {
  /** Microseconds since boot. */
  timestamp: number;
  /** syslog level 0 (emergency) to 7 (debug). */
  level: number;
  tag: number | null;
  text: string;
}

export interface ULogParamChange {
  timestamp: number;
  name: string;
  value: number;
}

export interface ULogDropout {
  timestamp: number;
  durationMs: number;
}

export type ULogInfoValue = string | number | number[];

export class ULogError extends Error {}

const MAGIC = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];
const KNOWN_TYPES = new Set("BFIMPQARDLCSO".split("").map((c) => c.charCodeAt(0)));

const T_FLAG = 66; // B
const T_FORMAT = 70; // F
const T_INFO = 73; // I
const T_MULTI = 77; // M
const T_PARAM = 80; // P
const T_PARAM_DEFAULT = 81; // Q
const T_ADD = 65; // A
const T_REMOVE = 82; // R
const T_DATA = 68; // D
const T_LOG = 76; // L
const T_LOG_TAGGED = 67; // C
const T_SYNC = 83; // S
const T_DROPOUT = 79; // O

interface TopicBuild {
  topic: ULogTopic;
  offsets: number[];
  lengths: number[];
}

export class ULog {
  readonly byteLength: number;
  readonly version: number;
  /** Microseconds since boot at which logging started (file header). */
  readonly headerTimestamp: number;
  /**
   * Zero of the time axis, microseconds since boot: the moment logging started (same
   * convention as pyulog and Flight Review). A topic that was last published before
   * logging started keeps its older timestamp and so shows up at a negative time.
   */
  startTimestamp = 0;
  /** Latest data timestamp seen, microseconds since boot. */
  lastTimestamp = 0;

  readonly info: Record<string, ULogInfoValue> = {};
  readonly multiInfo: Record<string, string[]> = {};
  /** Parameter values at the start of the log. */
  readonly params: Record<string, number> = {};
  readonly paramTypes: Record<string, "int32" | "float"> = {};
  /** Firmware defaults, and the defaults of the selected airframe. */
  readonly systemDefaults: Record<string, number> = {};
  readonly airframeDefaults: Record<string, number> = {};
  readonly paramChanges: ULogParamChange[] = [];
  readonly messages: ULogLoggedMessage[] = [];
  readonly dropouts: ULogDropout[] = [];
  readonly topics: ULogTopic[] = [];
  /** True when the file ended in the middle of a message (power cut, card pulled). */
  truncated = false;
  /** Bytes skipped while re-synchronising after corrupt data. */
  corruptBytes = 0;

  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly formats = new Map<string, FormatField[]>();
  private readonly byMsgId = new Map<number, TopicBuild>();
  private readonly byKey = new Map<string, TopicBuild>();
  private readonly indexOffsets = new Map<string, Float64Array>();
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(buffer: ArrayBuffer | Uint8Array) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.byteLength = bytes.byteLength;

    if (bytes.byteLength < 16) throw new ULogError("File is too short to be a ULog.");
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) {
        throw new ULogError("This is not a PX4 ULog file (wrong file signature).");
      }
    }
    this.version = bytes[7];
    this.headerTimestamp = this.u64(8);
    this.startTimestamp = this.headerTimestamp;
    this.index();
  }

  // ------------------------------------------------------------------ access

  topic(name: string, multiId = 0): ULogTopic | undefined {
    return this.byKey.get(multiId === 0 ? name : `${name}#${multiId}`)?.topic;
  }

  topicByKey(key: string): ULogTopic | undefined {
    return this.byKey.get(key)?.topic;
  }

  hasField(key: string, field: string): boolean {
    return !!this.byKey.get(key)?.topic.fields.some((f) => f.name === field);
  }

  /** Decode one field of one topic. Always returns a Float64Array of length topic.count. */
  column(key: string, field: string): Float64Array {
    const build = this.byKey.get(key);
    if (!build) throw new ULogError(`Topic not in this log: ${key}`);
    const f = build.topic.fields.find((x) => x.name === field);
    if (!f) throw new ULogError(`Field not in ${key}: ${field}`);
    const n = build.offsets.length;
    const out = new Float64Array(n);
    const v = this.view;
    const o = f.offset;
    const size = TYPE_SIZE[f.type];
    const offs = build.offsets;
    const lens = build.lengths;
    for (let i = 0; i < n; i++) {
      // A field can only be missing if the message was cut short by corruption.
      if (o + size > lens[i]) {
        out[i] = Number.NaN;
        continue;
      }
      const p = offs[i] + o;
      switch (f.type) {
        case "float":
          out[i] = v.getFloat32(p, true);
          break;
        case "double":
          out[i] = v.getFloat64(p, true);
          break;
        case "uint64_t":
          out[i] = v.getUint32(p, true) + v.getUint32(p + 4, true) * 4294967296;
          break;
        case "int64_t":
          out[i] = v.getUint32(p, true) + v.getInt32(p + 4, true) * 4294967296;
          break;
        case "int32_t":
          out[i] = v.getInt32(p, true);
          break;
        case "uint32_t":
          out[i] = v.getUint32(p, true);
          break;
        case "int16_t":
          out[i] = v.getInt16(p, true);
          break;
        case "uint16_t":
          out[i] = v.getUint16(p, true);
          break;
        case "int8_t":
          out[i] = v.getInt8(p);
          break;
        default:
          out[i] = v.getUint8(p);
      }
    }
    return out;
  }

  /** Timestamps of a topic in seconds since logging started. */
  time(key: string): Float64Array {
    const t = this.column(key, "timestamp");
    const t0 = this.startTimestamp;
    for (let i = 0; i < t.length; i++) t[i] = (t[i] - t0) / 1e6;
    return t;
  }

  /** Length of the log in seconds. */
  get duration(): number {
    return Math.max(0, (this.lastTimestamp - this.startTimestamp) / 1e6);
  }

  // ------------------------------------------------------------------ indexing

  private u64(p: number): number {
    return this.view.getUint32(p, true) + this.view.getUint32(p + 4, true) * 4294967296;
  }

  private str(start: number, end: number): string {
    return this.decoder.decode(this.bytes.subarray(start, end));
  }

  private index(): void {
    const v = this.view;
    const len = this.byteLength;
    let pos = 16;
    let lastTs = 0;

    while (pos + 3 <= len) {
      const size = v.getUint16(pos, true);
      const type = v.getUint8(pos + 2);
      const p = pos + 3;

      if (!KNOWN_TYPES.has(type)) {
        const next = this.resync(pos + 1);
        if (next < 0) {
          this.corruptBytes += len - pos;
          break;
        }
        this.corruptBytes += next - pos;
        pos = next;
        continue;
      }
      if (p + size > len) {
        this.truncated = true;
        break;
      }

      switch (type) {
        case T_DATA: {
          if (size < 2) break;
          const msgId = v.getUint16(p, true);
          const build = this.byMsgId.get(msgId);
          if (build) {
            build.offsets.push(p + 2);
            build.lengths.push(size - 2);
            if (size >= 10) {
              const ts = this.u64(p + 2);
              if (ts > 0) {
                if (ts > this.lastTimestamp) this.lastTimestamp = ts;
                lastTs = ts;
              }
            }
          }
          break;
        }
        case T_ADD:
          this.readAdd(p, size);
          break;
        case T_FORMAT:
          this.readFormat(p, size);
          break;
        case T_LOG: {
          if (size < 9) break;
          this.messages.push({
            level: v.getUint8(p) - 48,
            tag: null,
            timestamp: this.u64(p + 1),
            text: this.str(p + 9, p + size),
          });
          break;
        }
        case T_LOG_TAGGED: {
          if (size < 11) break;
          this.messages.push({
            level: v.getUint8(p) - 48,
            tag: v.getUint16(p + 1, true),
            timestamp: this.u64(p + 3),
            text: this.str(p + 11, p + size),
          });
          break;
        }
        case T_PARAM:
          this.readParam(p, size, lastTs, -1);
          break;
        case T_PARAM_DEFAULT:
          if (size >= 2) this.readParam(p + 1, size - 1, lastTs, v.getUint8(p));
          break;
        case T_INFO:
          this.readInfo(p, size);
          break;
        case T_MULTI:
          this.readMultiInfo(p, size);
          break;
        case T_DROPOUT:
          if (size >= 2) {
            this.dropouts.push({ timestamp: lastTs, durationMs: v.getUint16(p, true) });
          }
          break;
        case T_FLAG: {
          if (size >= 16) {
            // Incompatible flag bit 0 (appended data) is handled by reading on to
            // the end of the file. Any other incompatible bit means a newer format.
            const inc0 = v.getUint8(p + 8) & ~1;
            let unknown = inc0 !== 0;
            for (let i = 1; i < 8; i++) if (v.getUint8(p + 8 + i) !== 0) unknown = true;
            if (unknown) {
              throw new ULogError(
                "This log uses a newer ULog feature this reader does not understand.",
              );
            }
          }
          break;
        }
        case T_REMOVE:
        case T_SYNC:
        default:
          break;
      }
      pos = p + size;
    }
    if (pos < len && pos + 3 > len) this.truncated = true;

    for (const build of this.byMsgId.values()) {
      build.topic.count = build.offsets.length;
      this.topics.push(build.topic);
    }
    this.topics.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** After corrupt bytes, find the next position that looks like a real message header. */
  private resync(from: number): number {
    const v = this.view;
    const len = this.byteLength;
    for (let pos = from; pos + 3 <= len; pos++) {
      const size = v.getUint16(pos, true);
      const type = v.getUint8(pos + 2);
      if (!KNOWN_TYPES.has(type)) continue;
      const end = pos + 3 + size;
      if (end > len) continue;
      if (type === T_DATA) {
        if (size < 10) continue;
        if (!this.byMsgId.has(v.getUint16(pos + 3, true))) continue;
      }
      // The message after it must look valid too, or be the end of the file.
      if (end + 3 <= len && !KNOWN_TYPES.has(v.getUint8(end + 2))) continue;
      return pos;
    }
    return -1;
  }

  private readFormat(p: number, size: number): void {
    const text = this.str(p, p + size);
    const colon = text.indexOf(":");
    if (colon < 0) return;
    const name = text.slice(0, colon);
    const fields: FormatField[] = [];
    for (const part of text.slice(colon + 1).split(";")) {
      if (!part) continue;
      const space = part.indexOf(" ");
      if (space < 0) continue;
      let type = part.slice(0, space);
      const fname = part.slice(space + 1);
      let arrayLength = 0;
      const br = type.indexOf("[");
      if (br >= 0) {
        arrayLength = parseInt(type.slice(br + 1, type.indexOf("]")), 10) || 0;
        type = type.slice(0, br);
      }
      fields.push({ type, arrayLength, name: fname });
    }
    this.formats.set(name, fields);
  }

  private flatten(formatName: string, prefix: string, base: number, out: ULogField[]): number {
    const fmt = this.formats.get(formatName);
    if (!fmt) throw new ULogError(`Log refers to an undefined message format: ${formatName}`);
    let offset = base;
    for (const f of fmt) {
      const n = Math.max(1, f.arrayLength);
      const padding = f.name.startsWith("_padding");
      for (let i = 0; i < n; i++) {
        const name = prefix + f.name + (f.arrayLength > 0 ? `[${i}]` : "");
        if (isScalar(f.type)) {
          if (!padding) out.push({ name, type: f.type, offset });
          offset += TYPE_SIZE[f.type];
        } else {
          offset = this.flatten(f.type, name + ".", offset, out);
        }
      }
    }
    return offset;
  }

  private readAdd(p: number, size: number): void {
    if (size < 3) return;
    const multiId = this.view.getUint8(p);
    const msgId = this.view.getUint16(p + 1, true);
    const name = this.str(p + 3, p + size);
    const key = multiId === 0 ? name : `${name}#${multiId}`;
    const existing = this.byKey.get(key);
    if (existing) {
      // Re-subscription after a removal: keep appending to the same topic.
      this.byMsgId.set(msgId, existing);
      return;
    }
    const fields: ULogField[] = [];
    try {
      this.flatten(name, "", 0, fields);
    } catch {
      return; // format missing: skip this topic, keep reading the rest
    }
    const build: TopicBuild = {
      topic: { key, name, multiId, msgId, fields, count: 0 },
      offsets: [],
      lengths: [],
    };
    this.byMsgId.set(msgId, build);
    this.byKey.set(key, build);
  }

  private readKeyed(p: number, size: number): { type: string; name: string; at: number; end: number } | null {
    if (size < 1) return null;
    const keyLen = this.view.getUint8(p);
    if (1 + keyLen > size) return null;
    const key = this.str(p + 1, p + 1 + keyLen);
    const space = key.indexOf(" ");
    if (space < 0) return null;
    return {
      type: key.slice(0, space),
      name: key.slice(space + 1),
      at: p + 1 + keyLen,
      end: p + size,
    };
  }

  private readParam(p: number, size: number, ts: number, defaultTypes: number): void {
    const k = this.readKeyed(p, size);
    if (!k || k.end - k.at < 4) return;
    let value: number;
    let type: "int32" | "float";
    if (k.type === "int32_t") {
      value = this.view.getInt32(k.at, true);
      type = "int32";
    } else if (k.type === "float") {
      value = this.view.getFloat32(k.at, true);
      type = "float";
    } else {
      return;
    }
    if (defaultTypes >= 0) {
      if (defaultTypes & 1) this.systemDefaults[k.name] = value;
      if (defaultTypes & 2) this.airframeDefaults[k.name] = value;
      return;
    }
    this.paramTypes[k.name] = type;
    // Parameters written before any data are the initial set; later ones are changes.
    if (this.byMsgId.size === 0 || !(k.name in this.params)) {
      this.params[k.name] = value;
    } else {
      this.paramChanges.push({ timestamp: ts, name: k.name, value });
    }
  }

  private readValue(k: { type: string; at: number; end: number }): ULogInfoValue | undefined {
    const v = this.view;
    const br = k.type.indexOf("[");
    const base = br >= 0 ? k.type.slice(0, br) : k.type;
    if (base === "char") return this.str(k.at, k.end).replace(/\0+$/, "");
    if (!isScalar(base)) return undefined;
    const size = TYPE_SIZE[base];
    const count = Math.floor((k.end - k.at) / size);
    const read = (p: number): number => {
      switch (base) {
        case "float":
          return v.getFloat32(p, true);
        case "double":
          return v.getFloat64(p, true);
        case "uint64_t":
          return this.u64(p);
        case "int64_t":
          return v.getUint32(p, true) + v.getInt32(p + 4, true) * 4294967296;
        case "int32_t":
          return v.getInt32(p, true);
        case "uint32_t":
          return v.getUint32(p, true);
        case "int16_t":
          return v.getInt16(p, true);
        case "uint16_t":
          return v.getUint16(p, true);
        case "int8_t":
          return v.getInt8(p);
        default:
          return v.getUint8(p);
      }
    };
    if (count < 1) return undefined;
    if (br < 0) return read(k.at);
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push(read(k.at + i * size));
    return arr;
  }

  private readInfo(p: number, size: number): void {
    const k = this.readKeyed(p, size);
    if (!k) return;
    const value = this.readValue(k);
    if (value !== undefined) this.info[k.name] = value;
  }

  private readMultiInfo(p: number, size: number): void {
    if (size < 2) return;
    const continued = this.view.getUint8(p) !== 0;
    const k = this.readKeyed(p + 1, size - 1);
    if (!k) return;
    const value = this.readValue(k);
    if (value === undefined) return;
    const text = typeof value === "string" ? value : String(value);
    const list = (this.multiInfo[k.name] ??= []);
    if (continued && list.length > 0) list[list.length - 1] += text;
    else list.push(text);
  }
}
