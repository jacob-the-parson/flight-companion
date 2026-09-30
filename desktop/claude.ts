// Starting Claude Code for one answer. This is the part of the app that starts
// a program, and the only one.
//
// What it starts is the Claude Code the user has installed and signed in to.
// The app holds no key: the user's own account does the work.
//
// What Claude Code is given:
//   - a folder of its own for the conversation, holding the files attached to
//     the messages and what is open in the app;
//   - this app's files server, and every tool of it that reads;
//   - this app's observer, which says what a connected aircraft is reporting, if
//     the user has switched listening on. It reads a file the app keeps; it
//     opens no port, and nothing it has can reach the aircraft;
//   - one built-in tool, Read, so that it can look at a picture in that folder.
// What it is not given: a shell, a tool that edits or writes, the web, or any
// folder but its own. Whatever else it asks for is refused, not prompted for:
// nobody is there to be asked.
//
// The program is started directly, never through a shell, and what the user
// typed goes to its standard input, never onto the command line.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { claudeCodeArgs, ClaudeCodeStream } from '../lib/assistant/claudeCode.ts';
import { FILES_SERVER, OBSERVER_SERVER, readingTools } from '../lib/assistant/servers.ts';
import { RULES } from '../lib/assistant/rules.ts';
import type { AssistantEvent } from '../lib/assistant/types.ts';

export interface Found {
  id: string;
  found: boolean;
  version: string | null;
  why?: string;
  /** The program's path. Kept on this side; the page is not told it. */
  program?: string;
}

/** Characters that mean something to cmd.exe. A .cmd script is only started with arguments free of them. */
const CMD_SPECIAL = /[&|<>^%"!\r\n]/;

export function findClaudeCode(): Found {
  const windows = process.platform === 'win32';
  const asked = spawnSync(windows ? 'where' : 'which', ['claude'], { encoding: 'utf8', shell: false });
  const paths = (asked.stdout ?? '')
    .split(/\s*\n\s*/)
    .map((p) => p.trim())
    .filter((p) => p && existsSync(p));
  // an .exe can be started as it is; a .cmd script needs cmd.exe in front of it
  const program = (windows ? (paths.find((p) => /\.exe$/i.test(p)) ?? paths.find((p) => /\.cmd$/i.test(p))) : paths[0]) ?? null;
  if (!program) {
    return {
      id: 'claude-code',
      found: false,
      version: null,
      why: 'Claude Code was not found on this computer. Install it from claude.com/claude-code, run it once in a terminal to sign in, then start this app again.',
    };
  }
  const v = run(program, ['--version'], { timeoutMs: 15000 });
  const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1] ?? null;
  if (v.status !== 0 || !version) {
    return { id: 'claude-code', found: false, version: null, why: `Claude Code is at ${program} and did not answer when asked its version.` };
  }
  return { id: 'claude-code', found: true, version, program };
}

function command(program: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32' && /\.cmd$/i.test(program)) {
    const bad = [program, ...args].find((a) => CMD_SPECIAL.test(a));
    if (bad !== undefined) throw new Error('Claude Code is installed as a script, and a path on this computer holds a character that a script cannot be given safely. Install Claude Code with its own installer, which gives a program.');
    if (args.includes('')) throw new Error('Claude Code is installed as a script, which cannot be given an empty argument.');
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', program, ...args] };
  }
  return { file: program, args };
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // set when this app is itself started from inside Claude Code; they would make the new one think it is nested
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function run(program: string, args: string[], o: { timeoutMs: number }): { status: number | null; stdout: string } {
  try {
    const c = command(program, args);
    const r = spawnSync(c.file, c.args, { encoding: 'utf8', shell: false, timeout: o.timeoutMs, env: cleanEnv(), windowsHide: true });
    return { status: r.status, stdout: r.stdout ?? '' };
  } catch {
    return { status: null, stdout: '' };
  }
}

/** A name that is safe as a file in the conversation's folder, and no more than a name. */
export function safeName(name: string, taken: Set<string>): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  let out = base;
  for (let n = 2; taken.has(out.toLowerCase()); n++) {
    const dot = base.lastIndexOf('.');
    out = dot > 0 ? `${base.slice(0, dot)}-${n}${base.slice(dot)}` : `${base}-${n}`;
  }
  taken.add(out.toLowerCase());
  return out;
}

export function safeId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 80);
  if (!clean) throw new Error('The conversation has no usable id.');
  return clean;
}

export interface Ask {
  conversationId: string;
  prompt: string;
  sessionId: string | null;
  files: { name: string; about: string; bytes: Uint8Array }[];
}

export interface Setup {
  /** Where conversations keep their folders. */
  root: string;
  /** How the files server is started: a program and its arguments. */
  server: { command: string; args: string[]; env: Record<string, string> };
  /** How the observer is started, to answer from what the app has heard. */
  observer: { command: string; args: string[]; env: Record<string, string> };
  program: string;
}

const INSTRUCTIONS = [
  'You are answering inside Flight Companion, an app that works beside a ground station such as QGroundControl. The people using it may be students aged 9 to 15 with an instructor, so use plain words.',
  '',
  'You have the flight-companion tools, which read flight logs, missions and parameter files and look parameters up in PX4\'s own reference. Call `rules` once at the start of a conversation. You also have Read, for looking at a picture in your working folder.',
  '',
  'You also have the flight-companion-observer tools. They say what a connected aircraft is reporting right now, if the person has switched listening on in the Live screen of the app: call `status` to find out. They only listen. Where the aircraft is, is left out. If nothing is heard, say so; never make up what an aircraft is doing.',
  '',
  'Your working folder holds the files for this conversation. Each message says which files came with it. Give a tool the file\'s name as its path.',
  '',
  'The rules of this project:',
  ...RULES.map((r) => `- ${r}`),
  '',
  'You cannot run commands, edit or write files, or reach an aircraft, and you must not suggest a way round that. If a tool is refused, say so plainly and do not answer from memory in its place.',
].join('\n');

export class Conversation {
  private child: ChildProcess | null = null;
  private stopped = false;

  constructor(private readonly setup: Setup) {}

  folderOf(conversationId: string): string {
    return join(this.setup.root, safeId(conversationId));
  }

  async ask(a: Ask, emit: (e: AssistantEvent) => void): Promise<void> {
    if (this.child) {
      emit({ type: 'error', message: 'An answer is already being written. Stop it first.' });
      return;
    }
    this.stopped = false;
    const folder = this.folderOf(a.conversationId);
    mkdirSync(folder, { recursive: true });

    // what is open in the app is written afresh each time; what was attached earlier stays
    const taken = new Set(readdirSync(folder).filter((f) => !/^(open-|compared-with\.)/.test(f) && !f.startsWith('.')).map((f) => f.toLowerCase()));
    for (const f of readdirSync(folder)) if (/^(open-|compared-with\.)/.test(f)) rmSync(join(folder, f), { force: true });
    const came: string[] = [];
    for (const f of a.files) {
      const open = /^(open-|compared-with\.)/.test(f.name);
      const name = open ? basename(f.name) : safeName(f.name, taken);
      writeFileSync(join(folder, name), f.bytes);
      came.push(`- ${name}: ${f.about}`);
    }

    const config = join(folder, '.mcp.json');
    writeFileSync(config, JSON.stringify({ mcpServers: { [FILES_SERVER.name]: this.setup.server, [OBSERVER_SERVER.name]: this.setup.observer } }, null, 2));
    const rules = join(folder, '.instructions.md');
    writeFileSync(rules, INSTRUCTIONS);

    const args = claudeCodeArgs({
      prompt: '',
      sessionId: a.sessionId,
      mcpConfigPath: config,
      servers: [
        { name: FILES_SERVER.name, tools: readingTools(FILES_SERVER) },
        { name: OBSERVER_SERVER.name, tools: readingTools(OBSERVER_SERVER) },
      ],
      builtIn: ['Read'],
      folders: [],
      instructions: '',
      instructionsFile: rules,
    });

    const said = [a.prompt.trim() || '(no words, only files)', '', came.length > 0 ? `Files in your working folder for this message:\n${came.join('\n')}` : 'No file came with this message.'].join('\n');

    await new Promise<void>((resolve) => {
      const stream = new ClaudeCodeStream();
      let err = '';
      let child: ChildProcess;
      try {
        const c = command(this.setup.program, args);
        child = spawn(c.file, c.args, { cwd: folder, env: cleanEnv(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : 'Claude Code could not be started.' });
        resolve();
        return;
      }
      this.child = child;
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (c: string) => {
        for (const e of stream.push(c)) if (!this.stopped) emit(e);
      });
      child.stderr?.on('data', (c: string) => {
        err = (err + c).slice(-4000);
      });
      child.on('error', (e) => {
        this.child = null;
        emit({ type: 'error', message: `Claude Code could not be started: ${e.message}` });
        resolve();
      });
      child.on('close', (code) => {
        this.child = null;
        // stopped by the user: the page has already marked the answer as stopped
        if (!this.stopped) for (const e of stream.end(code, err)) emit(e);
        resolve();
      });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(said, 'utf8');
    });
  }

  stop(): void {
    const c = this.child;
    if (!c) return;
    this.stopped = true;
    if (process.platform === 'win32' && c.pid) {
      // the program may have started others (the tools server); end the whole tree
      spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { shell: false, windowsHide: true });
    } else {
      c.kill('SIGINT');
      setTimeout(() => c.exitCode === null && c.kill('SIGKILL'), 3000).unref();
    }
  }

  forget(conversationId: string): void {
    rmSync(this.folderOf(conversationId), { recursive: true, force: true });
  }
}
