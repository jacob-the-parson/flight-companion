// The two MCP servers the app ships, as the app describes them: for the Tools
// and Set up screens, and for the list of tools an assistant started by the
// desktop app is allowed. The servers themselves are in mcp/.
//
// The names here are checked against what each server says it has
// (scripts/verify-mcp.mjs, scripts/verify-observer.mjs), so this file cannot
// fall behind them unnoticed.

export interface ServerTool {
  name: string;
  does: string;
  writes?: boolean;
}

export interface ShippedServer {
  /** The name it has in .mcp.json, and in a tool's full name: mcp__<name>__<tool>. */
  name: string;
  label: string;
  folder: string;
  /** What it needs on the computer. */
  needs: string;
  about: string;
  /** True if it hears a live aircraft. */
  live: boolean;
  tools: ServerTool[];
}

export const FILES_SERVER: ShippedServer = {
  name: 'flight-companion',
  label: 'Files server',
  folder: 'mcp/files',
  needs: 'Node 22.18 or newer',
  about: 'Reads flight logs, missions and parameter files on this computer, and looks parameters up in PX4’s reference. It opens no port and cannot reach an aircraft.',
  live: false,
  tools: [
    { name: 'rules', does: 'The rules that bind an assistant here. Read first.' },
    { name: 'read_flight_log', does: 'A .ulg: numbers, findings, modes, messages. No position unless asked.' },
    { name: 'read_mission', does: 'A mission in any format: items in words, checks, what each format would drop.' },
    { name: 'check_mission', does: 'The checks only.' },
    { name: 'read_parameters', does: 'A parameter file: findings, and the parameters asked for, each explained.' },
    { name: 'compare_parameters', does: 'What differs between two parameter files.' },
    { name: 'explain_parameter', does: 'PX4 v1.16.0’s own description of a parameter.' },
    { name: 'search_parameters', does: 'A parameter by what it does.' },
    { name: 'list_formats', does: 'Every format, what it holds, where its definition came from.' },
    { name: 'list_examples', does: 'The examples the app teaches with.' },
    { name: 'convert_mission', does: 'A mission as a NEW file in another format.', writes: true },
    { name: 'convert_parameters', does: 'Parameters as a NEW file in another format.', writes: true },
    { name: 'write_examples', does: 'Every example, as files, into a NEW folder.', writes: true },
  ],
};

export const OBSERVER_SERVER: ShippedServer = {
  name: 'flight-companion-observer',
  label: 'Live observer',
  folder: 'mcp/observer',
  needs: 'Node 22.18 or newer, or the desktop app, which carries its own; and QGroundControl with MAVLink forwarding switched on',
  about:
    'Hears a copy of what the aircraft tells QGroundControl, and answers from what it has heard. It listens on this computer only and cannot send: the code that would send is replaced with code that raises an error. In the desktop app it answers from what the Live screen has heard.',
  live: true,
  tools: [
    { name: 'status', does: 'Is data arriving, vehicle type, armed or not, flight mode, how many parameters are held. Start here.' },
    { name: 'autopilot_version', does: 'Firmware version and git hash, board numbers, and the board’s own identifier.' },
    { name: 'params', does: 'Held parameters whose names start with a prefix.' },
    { name: 'param', does: 'One parameter by name.' },
    { name: 'messages', does: 'The board’s recent text messages, such as why it will not arm.' },
    { name: 'sensors', does: 'Each sensor present, enabled and healthy; GPS fix and satellites; battery. No position unless allowed.' },
    { name: 'traffic', does: 'Every kind of message heard, with count, rate and age.' },
    { name: 'latest', does: 'The fields of the newest message of one kind, such as ATTITUDE.' },
    { name: 'diff_live_against_file', does: 'What differs between the aircraft now and a saved .params file.' },
  ],
};

export const SHIPPED_SERVERS: ShippedServer[] = [FILES_SERVER, OBSERVER_SERVER];

/**
 * What an assistant started by the desktop app may call without asking: every
 * tool that reads. The three that write a file are left for a person to allow.
 */
export function readingTools(server: ShippedServer): string[] {
  return server.tools.filter((t) => !t.writes).map((t) => t.name);
}
