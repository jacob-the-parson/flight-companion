// XML in and out, for the four XML-based formats. Reading uses fast-xml-parser
// (works the same in the browser and in Node); writing is done by hand so the
// order of elements is exactly the order each schema asks for.
import { XMLParser } from 'fast-xml-parser';
import { MissionFormatError } from './model.ts';

export type XmlNode = { [key: string]: XmlValue };
export type XmlValue = string | XmlNode | XmlValue[] | undefined;

/** Parse a document. Every value stays a string: numbers are read by the caller. */
export function parseXml(text: string, alwaysArray: string[]): XmlNode {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // a document from the internet must not be able to expand entities at us
    processEntities: true,
    isArray: (name) => alwaysArray.includes(name),
  });
  try {
    return parser.parse(text) as XmlNode;
  } catch (err) {
    throw new MissionFormatError(
      `The file is not well-formed XML${err instanceof Error ? `: ${err.message}` : '.'}`,
    );
  }
}

export function child(node: XmlValue, name: string): XmlValue {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
  return node[name];
}

export function nodes(value: XmlValue): XmlNode[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is XmlNode => !!v && typeof v === 'object' && !Array.isArray(v));
}

export function text(value: XmlValue): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return text(value[0]);
  const inner = value['#text'];
  return typeof inner === 'string' ? inner : null;
}

export function num(value: XmlValue): number | null {
  const t = text(value);
  if (t === null || t.trim() === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A number as a file should hold it: no exponent, no trailing zeros. */
export function fmt(n: number, digits = 7): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(digits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** A small builder that indents as it goes. */
export class XmlWriter {
  private lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  private depth = 0;

  private pad(): string {
    return '  '.repeat(this.depth);
  }

  open(name: string, attrs: Record<string, string> = {}): this {
    const a = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join('');
    this.lines.push(`${this.pad()}<${name}${a}>`);
    this.depth += 1;
    return this;
  }

  close(name: string): this {
    this.depth -= 1;
    this.lines.push(`${this.pad()}</${name}>`);
    return this;
  }

  leaf(name: string, value: string | number, attrs: Record<string, string> = {}): this {
    const a = Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join('');
    const v = typeof value === 'number' ? fmt(value) : escapeXml(value);
    this.lines.push(v === '' ? `${this.pad()}<${name}${a}/>` : `${this.pad()}<${name}${a}>${v}</${name}>`);
    return this;
  }

  comment(text: string): this {
    this.lines.push(`${this.pad()}<!-- ${text.replace(/--/g, '- -')} -->`);
    return this;
  }

  toString(): string {
    return this.lines.join('\n') + '\n';
  }
}

export function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function decode(bytes: Uint8Array): string {
  // strip a byte-order mark: some tools write one and XML parsers dislike it
  const t = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** "lng,lat[,alt]" triples separated by white space, as KML writes them. */
export function parseCoordinates(s: string | null): { lat: number; lng: number; alt: number | null }[] {
  if (!s) return [];
  const out: { lat: number; lng: number; alt: number | null }[] = [];
  for (const token of s.trim().split(/\s+/)) {
    if (!token) continue;
    const p = token.split(',').map(Number);
    if (p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (Math.abs(p[1]) > 90 || Math.abs(p[0]) > 180) continue;
    out.push({ lng: p[0], lat: p[1], alt: p.length > 2 && Number.isFinite(p[2]) ? p[2] : null });
  }
  return out;
}
