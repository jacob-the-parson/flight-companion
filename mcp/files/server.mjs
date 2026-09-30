#!/usr/bin/env node
// flight-companion-files — an MCP server over the app's own functions.
//
// MCP (Model Context Protocol) is how an assistant such as Claude Code or Codex
// is given extra tools. The assistant starts this program, asks it what tools
// it has, and calls them. They talk over this program's standard input and
// output. Nothing here listens on a network.
//
// What the tools do: read a flight log, a mission or a parameter file that is
// on this computer, and say what is in it. Two of them write a file, and only
// where they are told to, and never over a file that is already there.
//
// What no tool here can do: reach an aircraft. There is no serial port, no
// socket and no MAVLink in this program. A mission or a parameter file reaches
// an aircraft only when a person loads it in a ground station.
//
// Every tool is one of the commands in bin/commands.mjs, the same ones
// `node bin/fc.mjs` runs. Start it by hand to see that it starts:
//     node mcp/files/server.mjs          (it waits for an assistant; Ctrl+C stops it)
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COMMANDS, HELP, isRefusal, Refusal } from '../../bin/commands.mjs';

export const SERVER_NAME = 'flight-companion-files';
export const SERVER_VERSION = '1.0.0';

const MISSION_FORMATS = ['qgc-plan', 'qgc-wpl', 'dji-wpml', 'garmin-fpl', 'kml', 'gpx', 'csv', 'fc-mission'];
const PARAM_FORMATS = ['qgc-params', 'mp-param', 'csv', 'fc-params'];

const path = (what) => z.string().min(1).describe(`${what}. A path on this computer, absolute or relative to the folder the server was started in.`);

/** A file a tool is about to write must not be there already. */
function mustBeNew(out) {
  if (existsSync(resolve(out))) {
    throw new Refusal(`There is already a file at ${resolve(out)}. This tool does not write over a file. Choose another name, or ask the person to remove it.`);
  }
}

// name, what it is for, its inputs, whether it writes, and the command it runs
const TOOLS = [
  {
    name: 'read_flight_log',
    title: 'Read a flight log',
    description:
      'Read a PX4 flight log (.ulg) and return its numbers, findings, flight modes, messages from the aircraft and the parameters not at their default. Times are seconds from the start of logging. Holds no latitude or longitude unless with_place is true: a takeoff point is somebody\'s address, so ask the person before turning it on.',
    input: {
      path: path('The .ulg file'),
      with_place: z.boolean().optional().describe('Include the takeoff latitude and longitude. Default false.'),
      max_messages: z.number().int().min(1).max(2000).optional().describe('Most messages to return; the most severe are kept. Default 200.'),
    },
    run: (a) => COMMANDS.log({ positional: [a.path], options: { ...(a.with_place ? { 'with-place': true } : null), ...(a.max_messages ? { messages: String(a.max_messages) } : null) } }),
  },
  {
    name: 'read_mission',
    title: 'Read a mission',
    description:
      'Read a mission file in any format the app reads (QGroundControl .plan, .waypoints, DJI .kmz, Garmin .fpl, KML, GPX, CSV, the app\'s own .mission.json). Returns every item in words, the checks, and what each format would keep or drop if the mission were written in it. The format is worked out from what is in the file.',
    input: { path: path('The mission file') },
    run: (a) => COMMANDS.mission({ positional: [a.path], options: {} }),
  },
  {
    name: 'check_mission',
    title: 'Check a mission',
    description: 'The checks on a mission and nothing else: shorter than read_mission. The checks read the mission only; they do not know the ground, the airspace or the weather.',
    input: { path: path('The mission file') },
    run: (a) => COMMANDS['mission-check']({ positional: [a.path], options: {} }),
  },
  {
    name: 'convert_mission',
    title: 'Write a mission in another format',
    writes: true,
    description:
      'Read a mission and WRITE it as a new file in another format. Returns what was kept, changed and dropped: pass that on to the person. It does not write over a file that is already there. The file goes no further than the disk: a person opens it in a ground station and uploads it from there.',
    input: {
      path: path('The mission file to read'),
      to: z.enum(MISSION_FORMATS).describe('The format to write'),
      out: path('The file to write. It must not exist yet'),
      dji_aircraft: z.string().optional().describe('Needed when "to" is dji-wpml: the aircraft the route is for, for example m3e or m30. A DJI route is made for one model. Ask the person; do not choose for them.'),
    },
    run: (a) => {
      mustBeNew(a.out);
      return COMMANDS['mission-convert']({ positional: [a.path], options: { to: a.to, out: a.out, ...(a.dji_aircraft ? { dji: a.dji_aircraft } : null) } });
    },
  },
  {
    name: 'read_parameters',
    title: 'Read a parameter file',
    description:
      'Read a parameter file (QGroundControl .params, Mission Planner .param). Returns whose parameters they are, what stands out, and the parameters asked for, each with what it is in PX4\'s own words, its unit, limits and the firmware\'s default. A file holds about a thousand parameters, so with neither "find" nor "only" the list is left out and only the summary and findings come back.',
    input: {
      path: path('The parameter file'),
      find: z.string().optional().describe('Return the parameters whose name, group or description has this text, for example "BAT" or "kill".'),
      only: z.enum(['flagged', 'not-default', 'changed']).optional().describe('flagged: outside limits or not a PX4 name. not-default: differs from the firmware\'s default, which choosing an airframe does to many. changed: edited in the app.'),
    },
    run: async (a) => {
      const doc = await COMMANDS.params({ positional: [a.path], options: { ...(a.find ? { find: a.find } : null), ...(a.only ? { only: a.only } : null) } });
      if (a.find || a.only) return doc;
      return {
        ...doc,
        parameters_shown: 0,
        parameters: [],
        how_to_see_parameters: `The file holds ${doc.summary.parameters} parameters. Call again with "find" (a name or part of one) or with "only".`,
      };
    },
  },
  {
    name: 'compare_parameters',
    title: 'Compare two parameter files',
    description:
      'What differs between two parameter files, each row with what the parameter is and what each value means. This is how a change to an aircraft is checked: a file saved before, a file saved after, and every row that moved explained. "path" is usually the later file and "other" the earlier.',
    input: { path: path('The first file, usually the later one'), other: path('The file to compare it with, usually the earlier one') },
    run: (a) => COMMANDS['params-diff']({ positional: [a.path, a.other], options: {} }),
  },
  {
    name: 'convert_parameters',
    title: 'Write parameters in another format',
    writes: true,
    description:
      'Read a parameter file and WRITE it as a new file in another format. It does not write over a file that is already there. Changing the format does not change whose parameters they are: PX4 parameters in a Mission Planner file are still PX4 parameters. The file goes no further than the disk.',
    input: {
      path: path('The parameter file to read'),
      to: z.enum(PARAM_FORMATS).describe('The format to write'),
      out: path('The file to write. It must not exist yet'),
    },
    run: (a) => {
      mustBeNew(a.out);
      return COMMANDS['params-convert']({ positional: [a.path], options: { to: a.to, out: a.out } });
    },
  },
  {
    name: 'explain_parameter',
    title: 'What PX4 says a parameter is',
    description:
      'PX4 v1.16.0\'s own description of one or more parameters: what it is, unit, limits, firmware default, listed values, whether a change needs a restart. Use this instead of memory: never state a parameter\'s meaning, limits or default from recollection. If the name is not in PX4\'s reference the answer says so; do not offer another name in its place.',
    input: { names: z.array(z.string().min(1)).min(1).max(40).describe('Parameter names, for example ["COM_KILL_DISARM", "BAT_LOW_THR"]') },
    run: (a) => COMMANDS.explain({ positional: a.names, options: {} }),
  },
  {
    name: 'search_parameters',
    title: 'Find a parameter by what it does',
    description: 'Parameters in PX4 v1.16.0\'s reference whose name, group or description has every word of the text. At most 50 come back.',
    input: { text: z.string().min(2).describe('Words to look for, for example "kill switch" or "battery low"') },
    run: (a) => COMMANDS.search({ positional: a.text.split(/\s+/), options: {} }),
  },
  {
    name: 'list_formats',
    title: 'The file formats',
    description: 'Every file format the app reads and writes, what each can hold, who uses it, and where its definition was taken from.',
    input: {},
    run: () => COMMANDS.formats({ positional: [], options: {} }),
  },
  {
    name: 'list_examples',
    title: 'The examples',
    description: 'The example missions and parameter sets the app teaches with, and the steps to try with each. Every one is made by the app; none is a recording of a real flight.',
    input: {},
    run: () => COMMANDS.samples({ positional: [], options: {} }),
  },
  {
    name: 'write_examples',
    title: 'Write the examples as files',
    writes: true,
    description: 'WRITE every example, in every format, into a folder that does not exist yet: 63 files to practise on.',
    input: { folder: path('The folder to make. It must not exist yet') },
    run: (a) => {
      if (existsSync(resolve(a.folder))) throw new Refusal(`There is already something at ${resolve(a.folder)}. Name a folder that does not exist yet.`);
      return COMMANDS['samples-write']({ positional: [a.folder], options: {} });
    },
  },
  {
    name: 'rules',
    title: 'The rules that bind an assistant here',
    description: 'Read this first. The rules for working with this project\'s data, and what has and has not been checked.',
    input: {},
    run: () => ({
      schema: 'flight-companion/rules@1',
      rules: [
        ...HELP.rules,
        'Never state a parameter\'s meaning, limits or default from memory: call explain_parameter or search_parameters.',
        'When an ArduPilot parameter name turns up in PX4 work, the decision it stood for still stands, and the PX4 parameter that carries it out has to be found in PX4\'s documentation. There is no table between the two.',
        'A finding says what was measured. Pass the evidence on with the conclusion.',
        'A takeoff point is somebody\'s address. Ask before asking a tool for it, and before repeating it.',
      ],
      not_checked: [
        'No file written by this app has been opened in DJI Pilot 2, on a Garmin device or in Mission Planner, and none has been flown.',
        'No parameter file written by this app after an edit has been loaded into an aircraft.',
        'The thresholds behind the log findings and the mission checks are rules of thumb, except the 120 m ceiling.',
      ],
      these_tools_cannot: ['reach an aircraft', 'open a network connection', 'write over a file that exists', 'delete anything'],
    }),
  },
];

export function buildServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          readOnlyHint: !tool.writes,
          destructiveHint: false,
          idempotentHint: !tool.writes,
          // nothing here reaches beyond this computer's disk
          openWorldHint: false,
        },
      },
      async (args) => {
        try {
          const result = await tool.run(args ?? {});
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          const error = isRefusal(e) ? e.message : `The tool failed: ${e?.message ?? e}`;
          return { content: [{ type: 'text', text: JSON.stringify({ error, tool: tool.name }, null, 2) }], isError: true };
        }
      },
    );
  }
  return server;
}

export const TOOL_LIST = TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, writes: !!t.writes, inputs: Object.keys(t.input) }));

// started as a program, it serves; imported, it only offers buildServer and TOOL_LIST
const startedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
if (startedDirectly) {
  // standard output belongs to the protocol: anything else printed there would break it
  await buildServer().connect(new StdioServerTransport());
}
