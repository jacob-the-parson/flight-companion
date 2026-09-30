// The tools the APP offers an assistant, run in the browser on what is open in
// the app and on what is attached to the conversation.
//
// They are the third way in to the same functions: the screens, the terminal
// tool and the MCP server are the others. Like those, they read and they
// explain. None changes anything in the app, writes a file, or can reach an
// aircraft.
//
// The app hands in a ToolContext: a set of functions that look at its state at
// the moment a tool runs. This file knows no store and no screen, so Node can
// run it in the checks.
import { checkMission } from '../mission/checks.ts';
import { missionBrief } from '../mission/brief.ts';
import { readMission, writeMission } from '../mission/formats.ts';
import type { Mission } from '../mission/model.ts';
import { diffSets, valueMeaning } from '../params/analysis.ts';
import { paramsDocument, readParams, writeParams } from '../params/codecs.ts';
import { explainParameters, searchParameters } from '../params/lookup.ts';
import type { ParamReference, ParamSet } from '../params/model.ts';
import { summarize, type FlightSummary } from '../ulog/analysis.ts';
import { logBrief } from '../ulog/brief.ts';
import { ULog } from '../ulog/parser.ts';
import { RULES } from './rules.ts';
import { KIND_LABEL, type AppTool, type Attachment } from './types.ts';

export interface ToolContext {
  mission: () => Mission | null;
  parameters: () => { set: ParamSet | null; other: ParamSet | null };
  reference: () => Promise<ParamReference | null>;
  log: () => { name: string; summary: FlightSummary } | null;
  /** Every file attached in this conversation. */
  attachments: () => Attachment[];
  attachmentBytes: (id: string) => Promise<Uint8Array | null>;
  /** The user's answer to "may the assistant see where flights took place". */
  mayShowPlace: () => boolean;
}

/** Thrown by a tool to say, in words, why it cannot answer. */
export class ToolRefusal extends Error {}

export { RULES };

const TEXT_LIMIT = 20_000;
const LIST_LIMIT = 60;

function filterParameters(doc: Record<string, unknown>, input: Record<string, unknown>): Record<string, unknown> {
  const all = (doc.parameters as Record<string, unknown>[]) ?? [];
  const find = typeof input.find === 'string' ? input.find.toLowerCase().trim() : '';
  const only = typeof input.only === 'string' ? input.only : '';
  if (!find && !only) {
    return {
      ...doc,
      parameters_shown: 0,
      parameters: [],
      how_to_see_parameters: `The set holds ${all.length} parameters. Call again with "find" (a name or part of one) or with "only".`,
    };
  }
  let list = all;
  if (only === 'changed') list = list.filter((p) => 'value_in_the_file_it_was_read_from' in p);
  else if (only === 'not-default') list = list.filter((p) => p.differs_from_firmware_default === true);
  else if (only === 'flagged') list = list.filter((p) => p.outside_limits || p.has_the_shape_of_an_ardupilot_name || p.in_the_reference === false);
  else if (only) throw new ToolRefusal('"only" takes one of: changed, flagged, not-default.');
  if (find) {
    list = list.filter((p) => `${String(p.name)} ${String(p.what_it_is ?? '')} ${String(p.group ?? '')}`.toLowerCase().includes(find));
  }
  return {
    ...doc,
    parameters_found: list.length,
    parameters_shown: Math.min(list.length, LIST_LIMIT),
    parameters: list.slice(0, LIST_LIMIT),
    ...(list.length > LIST_LIMIT ? { more: `${list.length - LIST_LIMIT} more were left out. Narrow "find".` } : null),
  };
}

const PARAM_FILTER = {
  find: { type: 'string', description: 'Return the parameters whose name, group or description has this text, for example "BAT" or "kill".' },
  only: { type: 'string', enum: ['flagged', 'not-default', 'changed'], description: 'flagged: outside limits or not a PX4 name. not-default: differs from the firmware\'s default. changed: edited in the app.' },
};

export function appTools(ctx: ToolContext): AppTool[] {
  const needReference = async (): Promise<ParamReference> => {
    const ref = await ctx.reference();
    if (!ref) throw new ToolRefusal('PX4\'s parameter reference could not be loaded, so parameters cannot be looked up just now.');
    return ref;
  };
  const findAttachment = (name: unknown): Attachment => {
    const all = ctx.attachments();
    if (all.length === 0) throw new ToolRefusal('Nothing is attached to this conversation.');
    const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const hit = all.find((a) => a.name.toLowerCase() === wanted) ?? all.find((a) => wanted !== '' && a.name.toLowerCase().includes(wanted));
    if (hit) return hit;
    throw new ToolRefusal(`No attached file is called "${String(name)}". Attached: ${all.map((a) => a.name).join(', ')}.`);
  };

  return [
    {
      name: 'rules',
      title: 'The rules that bind an assistant here',
      description: 'Read this first. The rules for working with this project\'s data.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => ({ schema: 'flight-companion/rules@1', rules: RULES }),
    },
    {
      name: 'what_is_open',
      title: 'What is open in the app',
      description: 'What the user has open in the app right now (a mission, a set of parameters, a flight log) and what is attached to this conversation. Call this when the user says "this mission", "my log" or "the file".',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const m = ctx.mission();
        const p = ctx.parameters();
        const l = ctx.log();
        return {
          schema: 'flight-companion/open@1',
          mission: m ? { name: m.name, items: m.items.length, read_with: 'open_mission' } : null,
          parameters: p.set ? { name: p.set.name, parameters: p.set.entries.length, compared_with: p.other?.name ?? null, read_with: 'open_parameters' } : null,
          flight_log: l ? { name: l.name, read_with: 'open_log' } : null,
          attached: ctx.attachments().map((a) => ({
            name: a.name,
            kind: KIND_LABEL[a.kind],
            size_bytes: a.bytes,
            can_be_read: a.kind === 'mission' || a.kind === 'parameters' || a.kind === 'log' || a.kind === 'text',
          })),
        };
      },
    },
    {
      name: 'open_mission',
      title: 'The mission that is open',
      description: 'The mission open in the Missions screen: every item in words, the checks, and what each file format would keep or drop.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const m = ctx.mission();
        if (!m) throw new ToolRefusal('No mission is open in the app. The user can open one in Missions, or attach a mission file here.');
        return missionBrief(m);
      },
    },
    {
      name: 'open_parameters',
      title: 'The parameters that are open',
      description: 'The set of parameters open in the Parameters screen: whose they are, what stands out, and the parameters asked for, each with what it is in PX4\'s own words. A set holds about a thousand, so with neither "find" nor "only" only the summary and findings come back.',
      inputSchema: { type: 'object', properties: PARAM_FILTER },
      run: async (input) => {
        const { set } = ctx.parameters();
        if (!set) throw new ToolRefusal('No set of parameters is open in the app. The user can open one in Parameters, or attach a parameter file here.');
        return filterParameters(paramsDocument(set, await ctx.reference()), input);
      },
    },
    {
      name: 'compare_open_parameters',
      title: 'What the open comparison shows',
      description: 'How the open set of parameters differs from the set it is compared with in the Parameters screen, each row with what the parameter is.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const { set, other } = ctx.parameters();
        if (!set || !other) throw new ToolRefusal('No comparison is open. In Parameters, the user opens a set and chooses another to compare it with.');
        const ref = set.autopilot === 'ardupilot' ? null : await ctx.reference();
        const d = diffSets(set, other);
        return {
          schema: 'flight-companion/params-diff@1',
          first: { name: set.name, autopilot: set.autopilot, parameters: set.entries.length },
          second: { name: other.name, autopilot: other.autopilot, parameters: other.entries.length },
          the_same: d.same,
          different: d.changed,
          only_in_first: d.onlyHere,
          only_in_second: d.onlyThere,
          rows_shown: Math.min(d.rows.length, LIST_LIMIT),
          rows: d.rows.slice(0, LIST_LIMIT).map((r) => {
            const meta = ref?.parameters[r.name];
            return {
              name: r.name,
              how: r.kind === 'changed' ? 'different' : r.kind === 'only-here' ? 'only in first' : 'only in second',
              in_first: r.here,
              in_second: r.there,
              ...(r.here !== null && valueMeaning(r.here, meta) ? { in_first_means: valueMeaning(r.here, meta) } : null),
              ...(r.there !== null && valueMeaning(r.there, meta) ? { in_second_means: valueMeaning(r.there, meta) } : null),
              ...(meta ? { what_it_is: meta.short, ...(meta.unit ? { unit: meta.unit } : null) } : { in_the_reference: false }),
            };
          }),
        };
      },
    },
    {
      name: 'open_log',
      title: 'The flight log that is open',
      description: 'The flight log open in the Flight Logs screen: numbers, findings, flight modes, messages from the aircraft, parameters not at their default. Times are seconds from the start of logging. The place is included only if the user has allowed it.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const l = ctx.log();
        if (!l) throw new ToolRefusal('No flight log is open in the app. The user can open one in Flight Logs, or attach a .ulg file here.');
        return logBrief(l.name, l.summary, { withPlace: ctx.mayShowPlace() });
      },
    },
    {
      name: 'read_attachment',
      title: 'Read an attached file',
      description: 'Read a file the user attached to this conversation. A mission, a parameter file or a flight log comes back as the same document the "open" tools give. A text file comes back as text. An image is seen by the assistant directly and needs no tool. A video cannot be read.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The file\'s name, as what_is_open lists it.' }, ...PARAM_FILTER },
        required: ['name'],
      },
      run: async (input) => {
        const a = findAttachment(input.name);
        if (a.kind === 'video') throw new ToolRefusal(`"${a.name}" is a video. It is shown to the user and cannot be read by an assistant.`);
        if (a.kind === 'image') throw new ToolRefusal(`"${a.name}" is an image. An assistant that can see images is given it with the message; there is nothing for a tool to read.`);
        if (a.kind === 'other') throw new ToolRefusal(`"${a.name}" is not a kind of file this app reads.`);
        const bytes = await ctx.attachmentBytes(a.id);
        if (!bytes) throw new ToolRefusal(`"${a.name}" is no longer in this browser's storage. The user can attach it again.`);
        if (a.kind === 'mission') {
          const m = readMission(bytes, a.name);
          return { ...missionBrief(m), checks_in_short: checkMission(m).map((c) => `${c.level}: ${c.title}`) };
        }
        if (a.kind === 'parameters') return filterParameters(paramsDocument(readParams(bytes, a.name, await ctx.reference()), await ctx.reference()), input);
        if (a.kind === 'log') return logBrief(a.name, summarize(new ULog(bytes)), { withPlace: ctx.mayShowPlace() });
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return {
          schema: 'flight-companion/text@1',
          file: a.name,
          characters: text.length,
          text: text.slice(0, TEXT_LIMIT),
          ...(text.length > TEXT_LIMIT ? { cut: `The first ${TEXT_LIMIT} characters are given.` } : null),
        };
      },
    },
    {
      name: 'explain_parameter',
      title: 'What PX4 says a parameter is',
      description: 'PX4 v1.16.0\'s own description of one or more parameters: what it is, unit, limits, firmware default, listed values, whether a change needs a restart. If the name is not in PX4\'s reference the answer says so; do not offer another name in its place.',
      inputSchema: {
        type: 'object',
        properties: { names: { type: 'array', items: { type: 'string' }, description: 'Parameter names, for example ["COM_KILL_DISARM"].' } },
        required: ['names'],
      },
      run: async (input) => {
        const names = Array.isArray(input.names) ? input.names.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
        if (names.length === 0) throw new ToolRefusal('Name one or more parameters.');
        return explainParameters(names.slice(0, 40), await needReference());
      },
    },
    {
      name: 'search_parameters',
      title: 'Find a parameter by what it does',
      description: 'Parameters in PX4 v1.16.0\'s reference whose name, group or description has every word of the text. At most 50 come back.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Words to look for, for example "kill switch".' } },
        required: ['text'],
      },
      run: async (input) => {
        const text = typeof input.text === 'string' ? input.text : '';
        if (text.trim().length < 2) throw new ToolRefusal('Give the text to look for.');
        return searchParameters(text, await needReference());
      },
    },
  ];
}

/**
 * What is open in the app, as files, for an assistant that reads files. The
 * mission and the parameters go as the files a ground station would read; the
 * log goes as its brief, so that where it flew is left out unless allowed.
 */
export async function openFiles(ctx: Pick<ToolContext, 'mission' | 'parameters' | 'reference' | 'log' | 'mayShowPlace'>): Promise<{ name: string; about: string; bytes: Uint8Array }[]> {
  const out: { name: string; about: string; bytes: Uint8Array }[] = [];
  const enc = (s: string) => new TextEncoder().encode(s);
  const m = ctx.mission();
  if (m && m.items.length > 0) {
    out.push({ name: 'open-mission.mission.json', about: `the mission open in the app, "${m.name}"`, bytes: writeMission(m, 'fc-mission').data });
  }
  const { set, other } = ctx.parameters();
  const ref = await ctx.reference();
  if (set && set.entries.length > 0) {
    out.push({ name: 'open-parameters.params', about: `the parameters open in the app, "${set.name}"`, bytes: writeParams(set, 'qgc-params', ref).data });
  }
  if (set && other && other.entries.length > 0) {
    out.push({ name: 'compared-with.params', about: `the parameters the open set is compared with, "${other.name}"`, bytes: writeParams(other, 'qgc-params', ref).data });
  }
  const l = ctx.log();
  if (l) {
    const brief = logBrief(l.name, l.summary, { withPlace: ctx.mayShowPlace() });
    out.push({ name: 'open-log.brief.json', about: `a summary of the flight log open in the app, "${l.name}"`, bytes: enc(`${JSON.stringify(brief, null, 2)}\n`) });
  }
  return out;
}

/** Run a tool by name, and give back what an assistant is told: text, and whether it worked. */
export async function runTool(tools: AppTool[], name: string, input: unknown): Promise<{ ok: boolean; text: string }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, text: JSON.stringify({ error: `There is no tool called "${name}".`, tools: tools.map((t) => t.name) }, null, 2) };
  try {
    const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    return { ok: true, text: JSON.stringify(await tool.run(args), null, 2) };
  } catch (e) {
    // what a tool or a reader refuses in words is passed on; anything else is a fault in the app
    const known = e instanceof ToolRefusal || /(FormatError|ULogError)$/.test((e as Error)?.constructor?.name ?? '');
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, text: JSON.stringify({ error: known ? message : `The tool failed: ${message}`, tool: name }, null, 2) };
  }
}

/**
 * The two messages MCP would carry for one use of a tool, in the shape the
 * protocol gives them (JSON-RPC 2.0, method "tools/call"). For the teaching
 * screen: this is what goes between an assistant and a tools server.
 */
export function mcpExchange(id: number, name: string, input: unknown, result: { ok: boolean; text: string }) {
  return {
    request: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: input ?? {} } },
    response: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result.text }], isError: !result.ok } },
  };
}
