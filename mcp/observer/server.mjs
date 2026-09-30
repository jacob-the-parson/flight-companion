#!/usr/bin/env node
// flight-companion-observer — a passive MAVLink observer, offered as MCP tools.
// Needs Node and nothing else: no Python.
//
// QGroundControl sends a copy of everything it hears from the aircraft to a UDP
// port when "Enable MAVLink forwarding" is switched on (Application Settings ->
// MAVLink). This program holds that port, remembers what arrives, and answers
// an assistant's questions from what it remembers. An assistant can see what
// the aircraft is reporting. It cannot say anything to the aircraft.
//
// READ-ONLY BY CONSTRUCTION. Nothing here transmits. The socket's ways of
// sending are replaced with a function that raises (listener.ts), and the
// MAVLink reader has no function that makes a packet (lib/mavlink/decode.ts).
//
// WHERE THE AIRCRAFT IS is left out of every answer unless FC_OBSERVER_PLACE=1.
//
// Settings, from the environment:
//     QGC_FWD_PORT          UDP port to listen on (default 14445, QGroundControl's own default)
//     QGC_FWD_HOST          address to listen on (default 127.0.0.1: this computer only)
//     FC_OBSERVER_PLACE     1 to include latitude and longitude (default: left out)
//     FC_OBSERVER_SNAPSHOT  a file the desktop app keeps of what IT has heard. With this
//                           set, this program opens no port at all and answers from the file.
//
// To see that it hears, without an assistant:   node mcp/observer/server.mjs --watch
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as observer from '../../lib/observer/state.ts';
import { listen, settingsFromEnv } from './listener.ts';

export const SERVER_NAME = 'flight-companion-observer';
export const SERVER_VERSION = '2.0.0';

const seconds = () => Date.now() / 1000;
/** A parameter file larger than this is not one. */
const LARGEST_FILE = 5 * 1024 * 1024;

/**
 * Where the answers come from: this program's own listening, or the file the
 * desktop app keeps. Either way `state()` gives what is held now.
 */
export function source(env = process.env) {
  const settings = settingsFromEnv(env);
  const snapshot = env.FC_OBSERVER_SNAPSHOT;
  if (snapshot) {
    return {
      settings,
      from: 'the desktop app',
      state: () => {
        if (!existsSync(snapshot)) {
          const empty = new observer.ObserverState(seconds());
          empty.noteError('The desktop app is not listening. Switch "Listen for the aircraft" on in the app, under Live.', seconds());
          return empty;
        }
        return observer.ObserverState.fromSnapshot(readFileSync(snapshot, 'utf8'));
      },
      stop: async () => undefined,
    };
  }
  const listening = listen(settings);
  return { settings, from: 'its own port', state: () => listening.state, stop: () => listening.stop(), listening };
}

function readParams(path) {
  const full = resolve(path);
  if (!existsSync(full) || !statSync(full).isFile()) return { error: `not found: ${path}` };
  if (statSync(full).size > LARGEST_FILE) return { error: `${path} is too large to be a parameter file` };
  return { text: readFileSync(full, 'utf8') };
}

export function tools(src) {
  const now = seconds;
  return [
    {
      name: 'status',
      title: 'Is the aircraft heard',
      description:
        'Start here. Whether QGroundControl\'s forwarding is reaching the observer, whether a vehicle is alive, its type, armed or not, its flight mode, and how many of its parameters are held. If nothing is heard, the answer says how to switch forwarding on.',
      input: {},
      run: () => ({ ...observer.status(src.state(), now(), src.settings), heard_by: src.from }),
    },
    {
      name: 'autopilot_version',
      title: 'Firmware and board',
      description:
        'The firmware version and its git hash (what QGroundControl shows as "Custom FW Ver"), the board and its vendor and product numbers, the board\'s own identifier, and what the autopilot says it can do. QGroundControl asks the aircraft for this when it connects.',
      input: {},
      run: () => observer.autopilotVersion(src.state(), now()),
    },
    {
      name: 'params',
      title: 'Parameters held',
      description:
        'The parameter values held, optionally only those whose names start with a prefix (letters in either case). The values are the ones QGroundControl downloaded: if they look old, a person presses Refresh in QGroundControl\'s Parameters view. For what a parameter MEANS, ask the files server\'s explain_parameter.',
      input: {
        prefix: z.string().max(16).optional().describe('The start of the names wanted, such as BAT or COM_. Default: all.'),
        limit: z.number().int().min(1).max(3000).optional().describe('Most to return. Default 300.'),
      },
      run: (a) => observer.params(src.state(), a.prefix ?? '', a.limit ?? 300),
    },
    {
      name: 'param',
      title: 'One parameter',
      description: 'One held parameter by its exact name. Never guess a name: if it is not held, say so.',
      input: { name: z.string().min(1).max(16).describe('The parameter\'s name, such as SYS_AUTOSTART.') },
      run: (a) => observer.param(src.state(), a.name),
    },
    {
      name: 'messages',
      title: 'What the board said',
      description:
        'The text messages the aircraft sent lately, such as why it will not arm or a sensor\'s notice. Severity runs from 0 (emergency) to 7 (debug); min_severity 4 gives warnings and worse.',
      input: {
        n: z.number().int().min(1).max(500).optional().describe('Most to return, the newest. Default 50.'),
        min_severity: z.number().int().min(0).max(7).optional().describe('The least severe to include. Default 7: everything.'),
      },
      run: (a) => observer.messages(src.state(), now(), a.n ?? 50, a.min_severity ?? 7),
    },
    {
      name: 'sensors',
      title: 'Sensors, GPS and battery',
      description:
        'Each sensor the aircraft has, whether it is switched on and whether it is healthy; the GPS fix and satellites; the battery; the estimator\'s flags if heard. The position is left out unless the person who set this server up allowed it.',
      input: {},
      run: () => observer.sensors(src.state(), now(), src.settings),
    },
    {
      name: 'traffic',
      title: 'What is being sent',
      description: 'Every kind of message heard, with how many, how often (Hz) and how long ago. For checking what the aircraft is really sending.',
      input: {},
      run: () => observer.traffic(src.state(), now()),
    },
    {
      name: 'latest',
      title: 'The newest message of one kind',
      description:
        'Every field of the newest message of one MAVLink kind, such as ATTITUDE, RC_CHANNELS, EXTENDED_SYS_STATE or POWER_STATUS. Fields that hold a position are left out unless allowed. traffic lists the kinds heard.',
      input: { msg_type: z.string().min(1).max(64).describe('The MAVLink message name, in either case.') },
      run: (a) => observer.latest(src.state(), now(), src.settings, a.msg_type),
    },
    {
      name: 'diff_live_against_file',
      title: 'The aircraft now against a saved file',
      description:
        'What differs between the parameters held now and a saved QGroundControl .params file: what changed on the aircraft since that file was saved. If only some parameters are held, only_in_file is not to be trusted: ask for a Refresh in QGroundControl first. This reads the file and the memory; it changes neither the file nor the aircraft.',
      input: { path: z.string().min(1).describe('The .params file. A path on this computer, absolute or relative to the folder the server was started in.') },
      run: (a) => {
        const file = readParams(a.path);
        return file.error ? file : observer.diffLive(src.state(), file.text, a.path);
      },
    },
  ];
}

export function buildServer(src) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const tool of tools(src)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        // every tool reads what was heard. None changes anything, anywhere.
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(tool.run(args ?? {}), null, 2) }] };
        } catch (e) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `The tool failed: ${e?.message ?? e}`, tool: tool.name }, null, 2) }], isError: true };
        }
      },
    );
  }
  return server;
}

// started as a program, it serves; imported, it only offers what is above
const startedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'));
if (startedDirectly) {
  const src = source();
  if (process.argv.includes('--watch')) {
    // a line every two seconds, for a person to read
    console.log(`listening on ${src.settings.host}:${src.settings.port} (${src.from}). Ctrl+C stops it.`);
    setInterval(() => {
      const s = observer.status(src.state(), seconds(), src.settings);
      const v = s.vehicle ?? {};
      const err = s.recent_errors.at(-1)?.error;
      console.log(`rx=${s.receiving} types=${s.message_types_seen} params=${s.params_received}/${s.params_expected} vehicle=${v.type ?? null} ${v.autopilot ?? null} mode=${v.mode?.name ?? null} armed=${v.armed ?? null}${err ? `  (${err})` : ''}`);
    }, 2000);
  } else {
    // standard output belongs to the protocol: anything else printed there would break it
    await buildServer(src).connect(new StdioServerTransport());
  }
}
