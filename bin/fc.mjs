#!/usr/bin/env node
// fc — Flight Companion from a terminal.
//
// The same functions the app's screens use, with JSON on standard output, so
// that a person, a script or a coding assistant (Claude Code, Codex, any
// other) can read a flight log, a mission or a parameter file without the
// browser. Run `node bin/fc.mjs help`.
//
// What it does: reads files, prints JSON, and writes a file ONLY where --out
// says. What it never does: open a serial port, a socket or a network
// connection. It cannot reach an aircraft.
//
// The commands themselves are in bin/commands.mjs, which the MCP server in
// mcp/files/ uses too. Needs Node 22.18 or newer (it runs the app's TypeScript
// as it is).
import { COMMANDS, isRefusal, parse, Refusal } from './commands.mjs';

const [command = 'help', ...rest] = process.argv.slice(2);
const run = COMMANDS[command];
try {
  if (!run) throw new Refusal(`There is no command "${command}". Run "node bin/fc.mjs help".`);
  const result = await run(parse(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (e) {
  // what the libraries refuse in words is passed on as it is; anything else is a fault in the tool
  const error = isRefusal(e) ? e.message : `The tool failed: ${e?.message ?? e}`;
  process.stderr.write(`${JSON.stringify({ error, command }, null, 2)}\n`);
  process.exitCode = 1;
}
