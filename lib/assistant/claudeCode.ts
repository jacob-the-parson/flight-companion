// Claude Code, driven from another program.
//
// Two pure pieces, both checked against a recording of the real program:
//   claudeCodeArgs   the command line that starts one answer
//   ClaudeCodeStream what it prints, turned into this app's events
// Starting the program is the desktop app's job (desktop/), because a web page
// cannot start a program.
//
// Source for every flag and every field: code.claude.com/docs/en/headless, and
// `claude --help` of version 2.1.285, both read 2026-09-29.
//
// The user's own login does the work: started WITHOUT --bare, Claude Code uses
// the login it already has. The documentation says --bare will become the
// default for -p in a future release; when it does, this has to change.
import type { AssistantEvent } from './types.ts';

export interface ClaudeCodeOptions {
  prompt: string;
  /** To continue a conversation: the session id of its last answer. */
  sessionId: string | null;
  /** A file naming the MCP servers the assistant may use. */
  mcpConfigPath: string;
  /** The MCP servers in that file, by the name each has there, and the tools of each it may call without asking. */
  servers: { name: string; tools: string[] }[];
  /** Built-in tools it may use. Empty: none, so it can read and run nothing of its own. */
  builtIn: string[];
  /** Folders it may read, for attached files. */
  folders: string[];
  /** Said to it before the conversation. */
  instructions: string;
  /** The same, as a file: what the desktop app uses, so that no text is on the command line. */
  instructionsFile?: string;
}

/**
 * The arguments for one answer. The prompt is NOT among them: it is written to
 * the program's standard input, so nothing a user types is ever part of a
 * command line.
 */
export function claudeCodeArgs(o: ClaudeCodeOptions): string[] {
  const allowed = [...o.servers.flatMap((s) => s.tools.map((t) => `mcp__${s.name}__${t}`)), ...o.builtIn];
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // only the servers named here: nothing from the folder or the user's own settings
    '--mcp-config',
    o.mcpConfigPath,
    '--strict-mcp-config',
    // the built-in tools it has at all
    '--tools',
    o.builtIn.join(','),
    // and what it may use without a person saying yes
    '--allowedTools',
    allowed.join(','),
    // anything else is refused: nobody is there to be asked
    '--permission-mode',
    'dontAsk',
  ];
  for (const f of o.folders) args.push('--add-dir', f);
  if (o.instructionsFile) args.push('--append-system-prompt-file', o.instructionsFile);
  else if (o.instructions) args.push('--append-system-prompt', o.instructions);
  if (o.sessionId) args.push('--resume', o.sessionId);
  return args;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (isObj(c) && c.type === 'text' ? (str(c.text) ?? '') : isObj(c) ? `[${str(c.type) ?? 'content'}]` : ''))
    .join('\n');
}

/** Turns the lines Claude Code prints into events. One object per conversation turn. */
export class ClaudeCodeStream {
  private buffer = '';
  private sawPieces = false;
  private sessionId: string | null = null;
  private finished = false;

  /** Text as it arrives from the program, in whatever pieces. */
  push(chunk: string): AssistantEvent[] {
    this.buffer += chunk;
    const out: AssistantEvent[] = [];
    let at = this.buffer.indexOf('\n');
    while (at >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (line) out.push(...this.line(line));
      at = this.buffer.indexOf('\n');
    }
    return out;
  }

  /** The program has ended. Says so if it ended without a result. */
  end(exitCode: number | null, stderr = ''): AssistantEvent[] {
    const out = this.buffer.trim() ? this.line(this.buffer.trim()) : [];
    this.buffer = '';
    if (!this.finished) {
      this.finished = true;
      const why = stderr.trim().split('\n').pop()?.trim();
      out.push({
        type: 'error',
        message:
          exitCode === 0 || exitCode === null
            ? 'Claude Code ended without an answer.'
            : `Claude Code stopped with code ${exitCode}${why ? `: ${why}` : '.'}`,
      });
    }
    return out;
  }

  private line(line: string): AssistantEvent[] {
    let d: unknown;
    try {
      d = JSON.parse(line);
    } catch {
      // not part of the protocol: a warning printed by something else
      return [];
    }
    if (!isObj(d)) return [];

    if (d.type === 'system' && d.subtype === 'init') {
      this.sessionId = str(d.session_id);
      const servers = Array.isArray(d.mcp_servers) ? d.mcp_servers.filter(isObj) : [];
      const out: AssistantEvent[] = [
        {
          type: 'started',
          model: str(d.model),
          sessionId: this.sessionId,
          tools: Array.isArray(d.tools) ? d.tools.filter((t): t is string => typeof t === 'string') : [],
        },
      ];
      for (const s of servers) {
        if (s.status !== 'connected') {
          out.push({ type: 'notice', text: `The tools server "${str(s.name) ?? '?'}" did not start (${str(s.status) ?? 'unknown'}). The assistant can answer, and cannot read files.` });
        }
      }
      return out;
    }

    if (d.type === 'system' && d.subtype === 'api_retry') {
      return [{ type: 'notice', text: `The service did not answer (${str(d.error) ?? 'unknown'}). Trying again, attempt ${String(d.attempt ?? '')}.` }];
    }

    if (d.type === 'stream_event' && isObj(d.event)) {
      const e = d.event;
      if (e.type === 'message_start') this.sawPieces = false;
      if (e.type === 'content_block_delta' && isObj(e.delta) && e.delta.type === 'text_delta') {
        const text = str(e.delta.text);
        if (text) {
          this.sawPieces = true;
          return [{ type: 'text', text }];
        }
      }
      return [];
    }

    if (d.type === 'assistant' && isObj(d.message) && Array.isArray(d.message.content)) {
      // a subagent's messages carry the id of the call that started it; they are not the answer
      if (d.parent_tool_use_id) return [];
      const out: AssistantEvent[] = [];
      for (const b of d.message.content.filter(isObj)) {
        if (b.type === 'tool_use') {
          out.push({ type: 'tool-call', id: str(b.id) ?? '', name: str(b.name) ?? 'tool', input: b.input ?? {} });
        } else if (b.type === 'text' && !this.sawPieces) {
          // no pieces were streamed for this message, so the whole text is the piece
          const text = str(b.text);
          if (text) out.push({ type: 'text', text });
        }
      }
      return out;
    }

    if (d.type === 'user' && isObj(d.message) && Array.isArray(d.message.content)) {
      if (d.parent_tool_use_id) return [];
      const out: AssistantEvent[] = [];
      for (const b of d.message.content.filter(isObj)) {
        if (b.type === 'tool_result') {
          out.push({ type: 'tool-result', id: str(b.tool_use_id) ?? '', ok: b.is_error !== true, text: resultText(b.content) });
        }
      }
      return out;
    }

    if (d.type === 'result') {
      this.finished = true;
      const sessionId = str(d.session_id) ?? this.sessionId;
      const out: AssistantEvent[] = [];
      const denied = Array.isArray(d.permission_denials) ? d.permission_denials.filter(isObj) : [];
      if (denied.length > 0) {
        const names = [...new Set(denied.map((p) => str(p.tool_name) ?? 'a tool'))];
        out.push({ type: 'notice', text: `The assistant asked to use ${names.join(', ')} and was refused: it is not among the tools it is allowed.` });
      }
      if (d.is_error === true || (typeof d.subtype === 'string' && d.subtype !== 'success')) {
        out.push({ type: 'error', message: str(d.result) ?? `Claude Code could not finish (${str(d.subtype) ?? 'error'}).` });
      } else {
        out.push({ type: 'done', sessionId });
      }
      return out;
    }

    return [];
  }
}
