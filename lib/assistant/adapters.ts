// The adapters: the slots an assistant can be put in. The chat asks the one
// that is chosen and knows nothing else about it. To add an assistant, write an
// AssistantAdapter and add it to ADAPTERS.
//
//   practice     Not an AI. Shows how a tool is used, answers from the tools
//                alone, needs nothing. It is what makes the chat work in a
//                browser with no account, and what the checks drive.
//   claude-code  Claude Code, started by the desktop app, under the login the
//                user already has. Needs the desktop app.
//
// Planned, not built: an adapter that takes the user's own API key, and one for
// a model behind an address the user gives. Both would work in the hosted page.
import { runTool } from './tools.ts';
import { desktopBridge, KIND_LABEL, type AssistantAdapter, type AssistantEvent, type SendRequest } from './types.ts';

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/** How fast the practice assistant writes. The checks set it to 0. */
export const practicePace = { msPerWord: 18 };

async function say(text: string, emit: (e: AssistantEvent) => void, signal: AbortSignal): Promise<void> {
  for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
    if (signal.aborted) return;
    emit({ type: 'text', text: piece });
    if (practicePace.msPerWord > 0) await wait(practicePace.msPerWord, signal);
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);

/** A PX4 parameter name as people type one: capitals, digits and at least one underscore. */
const PARAM_NAME = /\b[A-Z][A-Z0-9]{1,15}(?:_[A-Z0-9]+)+\b/g;

function words(level: unknown): string {
  return level === 'critical' ? 'Stop' : level === 'warning' ? 'Check' : level === 'info' ? 'Note' : 'Good';
}

/** What the practice assistant says about what a tool gave back. Every fact in it is from the tool. */
function summarise(tool: string, result: Json): string {
  if (typeof result.error === 'string') return `The tool could not answer: ${result.error}\n\n`;

  if (tool === 'explain_parameter') {
    return list(result.parameters)
      .map((p) => {
        if (p.in_the_reference === false) return `**${String(p.name)}**: ${String(p.note)}\n\n`;
        const facts = [
          p.unit ? `unit ${String(p.unit)}` : null,
          p.firmware_default !== undefined ? `firmware default ${String(p.firmware_default)}${p.firmware_default_means ? ` (${String(p.firmware_default_means)})` : ''}` : null,
          p.lowest !== undefined ? `lowest ${String(p.lowest)}` : null,
          p.highest !== undefined ? `highest ${String(p.highest)}` : null,
          `a change takes effect ${String(p.takes_effect)}`,
        ].filter(Boolean);
        const values = Object.entries(obj(p.values));
        return (
          `**${String(p.name)}**: ${String(p.what_it_is)}${p.more ? ` ${String(p.more)}` : ''}\n\n` +
          `- ${facts.join('\n- ')}\n` +
          (values.length > 0 ? `\nWhat each value means: ${values.slice(0, 12).map(([k, v]) => `${k} is ${String(v)}`).join('; ')}${values.length > 12 ? '; and more' : ''}.\n` : '') +
          '\n'
        );
      })
      .join('') + `Those are PX4's own words, from the ${String(obj(result.reference).firmware)} reference.\n\n`;
  }

  if (tool === 'search_parameters') {
    const found = list(result.parameters);
    if (found.length === 0) return `PX4's reference has no parameter with "${String(result.looked_for)}" in its name or description.\n\n`;
    return `PX4's reference has ${String(result.found)} with "${String(result.looked_for)}":\n\n${found.slice(0, 8).map((p) => `- **${String(p.name)}**: ${String(p.what_it_is)}`).join('\n')}\n\n`;
  }

  if (tool === 'open_mission' || (tool === 'read_attachment' && result.schema === 'flight-companion/mission-brief@1')) {
    const m = obj(result.mission);
    const s = obj(m.summary);
    const checks = list(result.checks);
    return (
      `**${String(m.name)}** has ${String(s.items)} items, ${String(s.waypoints)} of them waypoints, and is ${String(s.length_m)} m long.\n\n` +
      `The checks:\n\n${checks.map((c) => `- **${words(c.level)}.** ${String(c.title)}`).join('\n')}\n\n`
    );
  }

  if (tool === 'open_parameters' || (tool === 'read_attachment' && result.schema === 'flight-companion/params@1')) {
    const findings = list(result.findings);
    const shown = list(result.parameters);
    return (
      `**${String(result.name)}** holds ${String(obj(result.summary).parameters)} parameters of ${result.autopilot === 'px4' ? 'PX4' : result.autopilot === 'ardupilot' ? 'ArduPilot' : 'an autopilot the file does not name'}.\n\n` +
      `What stands out:\n\n${findings.map((f) => `- **${words(f.level)}.** ${String(f.title)}`).join('\n')}\n\n` +
      (shown.length > 0 ? `${shown.slice(0, 10).map((p) => `- **${String(p.name)}** is ${String(p.value)}${p.unit ? ` ${String(p.unit)}` : ''}${p.value_means ? `, which means ${String(p.value_means)}` : ''}`).join('\n')}\n\n` : '')
    );
  }

  if (tool === 'compare_open_parameters') {
    const rows = list(result.rows);
    return (
      `**${String(obj(result.first).name)}** against **${String(obj(result.second).name)}**: ${String(result.different)} differ, ${String(result.the_same)} are the same.\n\n` +
      `${rows.slice(0, 12).map((r) => `- **${String(r.name)}**: ${String(r.in_first)} against ${String(r.in_second)}${r.what_it_is ? `. ${String(r.what_it_is)}` : ''}`).join('\n')}\n\n`
    );
  }

  if (tool === 'open_log' || (tool === 'read_attachment' && result.schema === 'flight-companion/log-brief@1')) {
    const n = obj(result.numbers);
    const findings = list(result.findings);
    return (
      `**${String(result.file)}**: ${String(n.time_in_the_air_s)} s in the air, highest ${String(n.highest_above_takeoff_m)} m above takeoff, battery from ${String(n.battery_at_start_v)} V down to ${String(n.battery_lowest_v)} V.\n\n` +
      `What the log shows:\n\n${findings.slice(0, 8).map((f) => `- **${words(f.level)}.** ${String(f.title)}`).join('\n')}\n\n`
    );
  }

  if (tool === 'read_attachment' && result.schema === 'flight-companion/text@1') {
    return `**${String(result.file)}** is ${String(result.characters)} characters of text. It begins:\n\n> ${String(result.text).slice(0, 280).replace(/\s+/g, ' ')}\n\n`;
  }

  if (tool === 'what_is_open') {
    const lines = [
      result.mission ? `- a mission, **${String(obj(result.mission).name)}**` : null,
      result.parameters ? `- a set of parameters, **${String(obj(result.parameters).name)}**` : null,
      result.flight_log ? `- a flight log, **${String(obj(result.flight_log).name)}**` : null,
      ...list(result.attached).map((a) => `- attached here: **${String(a.name)}** (${String(a.kind)})`),
    ].filter(Boolean);
    return lines.length > 0 ? `Open in the app:\n\n${lines.join('\n')}\n\n` : 'Nothing is open in the app, and nothing is attached here.\n\n';
  }
  return '';
}

const INTRODUCTION =
  'I am the **practice assistant**. I am not an AI: I cannot hold a conversation or reason about your aircraft. ' +
  'I am here to show how an assistant uses tools, and I answer only from what the tools give back.\n\n';

const SUGGESTIONS =
  'Things to try:\n\n' +
  '- Type a parameter name, such as `COM_KILL_DISARM`.\n' +
  '- Ask "find kill switch" to search PX4\'s reference.\n' +
  '- Open an example in Missions or Parameters, then ask "what is open?"\n' +
  '- Attach a mission, a parameter file or a flight log.\n\n' +
  'Open a tool\'s card in my answer to see what was asked and what came back. That exchange is what MCP carries.\n';

export const practiceAdapter: AssistantAdapter = {
  id: 'practice',
  label: 'Practice assistant',
  about: 'Not an AI. It shows how a tool is used and answers from the tools alone. It needs no account and sends nothing anywhere.',
  needs: 'nothing',
  isModel: false,
  takes: { images: false, files: true },
  availability: () => ({ ok: true }),
  send: async (request: SendRequest, emit, signal) => {
    emit({ type: 'started', model: null, sessionId: null, tools: request.tools.map((t) => t.name) });
    const text = request.message.text;
    const lower = text.toLowerCase();
    const calls: { name: string; input: Json }[] = [];

    for (const a of request.message.attachments ?? []) {
      if (a.kind === 'mission' || a.kind === 'parameters' || a.kind === 'log' || a.kind === 'text') {
        calls.push({ name: 'read_attachment', input: { name: a.name } });
      }
    }
    const names = [...new Set(text.match(PARAM_NAME) ?? [])];
    if (names.length > 0) calls.push({ name: 'explain_parameter', input: { names } });
    const search = /\b(?:find|search(?: for)?|look for)\s+(.{2,60})$/i.exec(text.trim());
    if (search && names.length === 0) calls.push({ name: 'search_parameters', input: { text: search[1].replace(/[?.!]+$/, '') } });
    if (/\bcompar/.test(lower)) calls.push({ name: 'compare_open_parameters', input: {} });
    else if (/\bparam/.test(lower) && names.length === 0 && !search) calls.push({ name: 'open_parameters', input: { only: 'flagged' } });
    if (/\bmission|\bwaypoint|\broute/.test(lower)) calls.push({ name: 'open_mission', input: {} });
    if (/\blog\b|\bflight\b|\bflew\b|\bbattery/.test(lower)) calls.push({ name: 'open_log', input: {} });
    if (/what is open|what's open|\bopen\?/.test(lower)) calls.push({ name: 'what_is_open', input: {} });

    const unseen = (request.message.attachments ?? []).filter((a) => a.kind === 'image' || a.kind === 'video' || a.kind === 'other');
    let said = false;
    if (calls.length === 0) {
      await say(INTRODUCTION, emit, signal);
      said = true;
    }
    for (const a of unseen) {
      await say(
        a.kind === 'image'
          ? `I cannot see **${a.name}**: I am not an AI. An assistant that can see images is given the picture with your message.\n\n`
          : a.kind === 'video'
            ? `**${a.name}** is shown for you. No assistant here can watch a video.\n\n`
            : `**${a.name}** is not a kind of file this app reads.\n\n`,
        emit,
        signal,
      );
      said = true;
    }

    let n = 0;
    for (const call of calls) {
      if (signal.aborted) return;
      n += 1;
      const id = `practice-${request.message.id}-${n}`;
      emit({ type: 'tool-call', id, name: call.name, input: call.input });
      const result = await runTool(request.tools, call.name, call.input);
      emit({ type: 'tool-result', id, ok: result.ok, text: result.text });
      let parsed: Json = {};
      try {
        parsed = obj(JSON.parse(result.text));
      } catch {
        /* a tool always answers in JSON; an empty summary is the worst case */
      }
      await say(summarise(call.name, parsed), emit, signal);
      said = true;
    }
    if (calls.length === 0) await say(SUGGESTIONS, emit, signal);
    else if (said) await say('Open a tool\'s card above to see what was asked and what came back.\n', emit, signal);
    if (!signal.aborted) emit({ type: 'done', sessionId: null });
  },
};

export const claudeCodeAdapter: AssistantAdapter = {
  id: 'claude-code',
  label: 'Claude Code',
  about: 'Anthropic\'s Claude Code, installed on this computer and signed in by you. Your own account does the work; this app holds no key. It is started by the desktop app.',
  needs: 'desktop',
  isModel: true,
  takes: { images: true, files: true },
  availability: () =>
    desktopBridge()
      ? { ok: true }
      : { ok: false, why: 'Claude Code is a program on your computer, and a web page cannot start a program. It works in the Flight Companion desktop app.' },
  send: async (request, emit, signal) => {
    const bridge = desktopBridge();
    if (!bridge) {
      emit({ type: 'error', message: 'Claude Code needs the Flight Companion desktop app. In a browser, choose the practice assistant.' });
      return;
    }
    const files: { name: string; about: string; bytes: Uint8Array }[] = [];
    for (const a of request.message.attachments ?? []) {
      const bytes = await request.attachmentBytes(a.id);
      if (bytes) files.push({ name: a.name, about: `attached to this message (${KIND_LABEL[a.kind].toLowerCase()})`, bytes });
    }
    // Claude Code runs outside the page, so what is open in the app goes to it as files
    files.push(...(await request.openFiles()));
    const stop = () => void bridge.stop();
    signal.addEventListener('abort', stop);
    try {
      await bridge.ask(
        { adapter: 'claude-code', conversationId: request.conversationId, prompt: request.message.text, sessionId: request.sessionId, files },
        emit,
      );
    } catch (e) {
      emit({ type: 'error', message: e instanceof Error ? e.message : 'Claude Code could not be started.' });
    } finally {
      signal.removeEventListener('abort', stop);
    }
  },
};

export const ADAPTERS: AssistantAdapter[] = [practiceAdapter, claudeCodeAdapter];

export function adapterById(id: string): AssistantAdapter {
  return ADAPTERS.find((a) => a.id === id) ?? practiceAdapter;
}

/** The adapter to start with: the first real assistant that can answer here, else the practice one. */
export function defaultAdapterId(): string {
  return (ADAPTERS.find((a) => a.isModel && a.availability().ok) ?? practiceAdapter).id;
}
