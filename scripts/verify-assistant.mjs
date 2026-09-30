// Checks for the assistant's library: the Claude Code stream reader against a
// recording of the real program, the tools the app runs, and the practice
// assistant.
//
//   node scripts/verify-assistant.mjs [--live]
//
// --live  also starts the Claude Code installed on this computer, once, with
//         the command line this app builds and the MCP server in mcp/files/.
//         It uses the account Claude Code is signed in to. Off by default.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, adapterById, claudeCodeAdapter, defaultAdapterId, practiceAdapter, practicePace } from '../lib/assistant/adapters.ts';
import { claudeCodeArgs, ClaudeCodeStream } from '../lib/assistant/claudeCode.ts';
import { appTools, mcpExchange, openFiles, RULES, runTool } from '../lib/assistant/tools.ts';
import { readMission } from '../lib/mission/formats.ts';
import { readParams } from '../lib/params/codecs.ts';
import { FILES_SERVER, OBSERVER_SERVER, readingTools } from '../lib/assistant/servers.ts';
import { attachmentKind, toolDisplayName } from '../lib/assistant/types.ts';
import { writeMission } from '../lib/mission/formats.ts';
import { MISSION_SAMPLES } from '../lib/mission/samples.ts';
import { writeParams } from '../lib/params/codecs.ts';
import { PARAM_SAMPLES } from '../lib/params/samples.ts';

const live = process.argv.includes('--live');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;
let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
practicePace.msPerWord = 0;

const ref = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'px4-v1.16.0-parameters.json'), 'utf8'));

// ------------------------------------------------------------ small things
{
  eq('kind: a picture', attachmentKind('a.PNG', 'image/png'), 'image');
  eq('kind: a video', attachmentKind('flight.mp4', 'video/mp4'), 'video');
  eq('kind: a log', attachmentKind('2026.ulg', ''), 'log');
  eq('kind: a plan', attachmentKind('field.plan', 'application/octet-stream'), 'mission');
  eq('kind: parameters', attachmentKind('after.params', ''), 'parameters');
  eq('kind: something else', attachmentKind('setup.exe', 'application/x-msdownload'), 'other');
  eq('tool name: from an MCP server', toolDisplayName('mcp__flight-companion__explain_parameter'), 'explain parameter');
  eq('tool name: the app\'s own', toolDisplayName('open_mission'), 'open mission');
}

// ------------------------------------------------------------ the Claude Code stream, as recorded
{
  const recording = readFileSync(join(ROOT, 'scripts', 'fixtures', 'claude-code-stream.jsonl'), 'utf8');
  ok('recording: holds nothing of the computer it was made on', !/Users|AppData|@gmail/.test(recording));

  // fed whole, and fed seven characters at a time: the same events either way
  const whole = new ClaudeCodeStream();
  const events = [...whole.push(recording), ...whole.end(0)];
  const bits = new ClaudeCodeStream();
  const pieces = [];
  for (let i = 0; i < recording.length; i += 7) pieces.push(...bits.push(recording.slice(i, i + 7)));
  pieces.push(...bits.end(0));
  eq('stream: the same events however the text is cut up', JSON.stringify(pieces), JSON.stringify(events));

  eq('stream: begins with started', events[0].type, 'started');
  eq('stream: the model it names', events[0].model, 'claude-fable-5-1');
  ok('stream: a session to continue with', typeof events[0].sessionId === 'string' && events[0].sessionId.length > 10);
  eq('stream: thirteen tools, all from our server', events[0].tools.filter((t) => t.startsWith('mcp__flight-companion__')).length, 13);
  const kinds = events.map((e) => e.type);
  eq('stream: order', [...new Set(kinds)].join(), 'started,tool-call,tool-result,text,done');
  const call = events.find((e) => e.type === 'tool-call');
  eq('stream: the tool it called', call.name, 'mcp__flight-companion__explain_parameter');
  eq('stream: with what', JSON.stringify(call.input), '{"names":["COM_KILL_DISARM"]}');
  const result = events.find((e) => e.type === 'tool-result');
  ok('stream: the result belongs to the call, and worked', result.id === call.id && result.ok === true);
  eq('stream: the result is our document', JSON.parse(result.text).schema, 'flight-companion/parameter-explained@1');
  const said = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  ok('stream: the answer, once and whole', /seconds/.test(said) && /default of 5/.test(said) && said.match(/COM_KILL_DISARM/g).length === 1, said);
  eq('stream: ends with done', kinds.at(-1), 'done');

  // without the pieces, the whole message is the text
  const noPieces = recording.split('\n').filter((l) => !l.includes('"stream_event"')).join('\n');
  const plain = new ClaudeCodeStream();
  const text2 = [...plain.push(noPieces), ...plain.end(0)].filter((e) => e.type === 'text').map((e) => e.text).join('');
  eq('stream: without streamed pieces the answer is the same', text2, said);

  // things that go wrong
  const cut = new ClaudeCodeStream();
  const ended = [...cut.push(recording.split('\n').slice(0, 5).join('\n') + '\n'), ...cut.end(1, 'warning\nNot logged in. Run claude and sign in.\n')];
  eq('stream: a program that stops early says why', ended.at(-1).message, 'Claude Code stopped with code 1: Not logged in. Run claude and sign in.');
  const junk = new ClaudeCodeStream();
  eq('stream: a line that is not the protocol is passed over', junk.push('(node:1) Warning: something\n{"type":"unknown"}\n').length, 0);
  const failedRun = new ClaudeCodeStream();
  const f = failedRun.push('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"The request failed.","session_id":"x"}\n');
  eq('stream: a failed run is an error, with its words', `${f[0].type} ${f[0].message}`, 'error The request failed.');
  const denied = new ClaudeCodeStream();
  const dn = denied.push('{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"x","permission_denials":[{"tool_name":"Bash"}]}\n');
  ok('stream: a refused tool is said', dn[0].type === 'notice' && /Bash/.test(dn[0].text) && dn[1].type === 'done');
  const sub = new ClaudeCodeStream();
  eq('stream: a subagent\'s messages are not the answer', sub.push('{"type":"assistant","parent_tool_use_id":"toolu_1","message":{"content":[{"type":"text","text":"inner"}]}}\n').length, 0);
}

// ------------------------------------------------------------ the command line
{
  const args = claudeCodeArgs({
    prompt: 'What is "; rm -rf / ?',
    sessionId: null,
    mcpConfigPath: '/tmp/mcp.json',
    servers: [
      { name: 'flight-companion', tools: ['explain_parameter', 'read_mission'] },
      { name: 'flight-companion-observer', tools: ['status'] },
    ],
    builtIn: [],
    folders: ['/tmp/chat'],
    instructions: 'Be plain.',
  });
  ok('args: what the user typed is nowhere on the command line', !args.some((a) => a.includes('rm -rf')));
  eq('args: print, streamed as JSON', args.slice(0, 5).join(' '), '--print --output-format stream-json --verbose --include-partial-messages');
  ok('args: only our servers', args.includes('--strict-mcp-config') && args[args.indexOf('--mcp-config') + 1] === '/tmp/mcp.json');
  eq('args: no built-in tool', args[args.indexOf('--tools') + 1], '');
  eq('args: the tools it may use without asking', args[args.indexOf('--allowedTools') + 1], 'mcp__flight-companion__explain_parameter,mcp__flight-companion__read_mission,mcp__flight-companion-observer__status');
  eq('args: anything else is refused', args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  ok('args: never the mode that skips the user\'s login', !args.includes('--bare'));
  ok('args: never the mode that skips permissions', !args.some((a) => /dangerously|bypassPermissions/.test(a)));
  ok('args: no resume on a first message', !args.includes('--resume'));
  const byFile = claudeCodeArgs({ prompt: 'x', sessionId: null, mcpConfigPath: 'm', servers: [], builtIn: ['Read'], folders: [], instructions: 'not used', instructionsFile: '/tmp/rules.md' });
  ok('args: instructions from a file, when one is given', byFile[byFile.indexOf('--append-system-prompt-file') + 1] === '/tmp/rules.md' && !byFile.includes('--append-system-prompt') && !byFile.includes('not used'));
  const next = claudeCodeArgs({ prompt: 'x', sessionId: 'abc', mcpConfigPath: 'm', servers: [], builtIn: ['Read'], folders: [], instructions: '' });
  ok('args: resume on the next', next[next.indexOf('--resume') + 1] === 'abc' && next[next.indexOf('--tools') + 1] === 'Read');
}

// ------------------------------------------------------------ the servers, as the app describes them
{
  eq('servers: the files server has thirteen tools, the observer nine', `${FILES_SERVER.tools.length} ${OBSERVER_SERVER.tools.length}`, '13 9');
  eq('servers: an assistant is allowed the ten that read', readingTools(FILES_SERVER).length, 10);
  ok('servers: and none that writes', !readingTools(FILES_SERVER).some((t) => /^(convert|write)_/.test(t)));
  ok('servers: the observer has none that writes', OBSERVER_SERVER.tools.every((t) => !t.writes) && OBSERVER_SERVER.live);
  ok('servers: no tool of either sends, arms or sets', ![...FILES_SERVER.tools, ...OBSERVER_SERVER.tools].some((t) => /(^|_)(send|upload|arm|disarm|set|command|reboot)(_|$)/.test(t.name)));
}

// ------------------------------------------------------------ the tools the app runs
const mission = MISSION_SAMPLES.find((s) => s.id === 'inspection').build();
const sets = Object.fromEntries(PARAM_SAMPLES.map((s) => [s.id, s.build(ref)]));
const files = new Map();
const attach = (name, bytes, mime = '') => {
  const a = { id: `a${files.size + 1}`, name, mime, bytes: bytes.length, kind: attachmentKind(name, mime) };
  files.set(a.id, { a, bytes });
  return a;
};
const state = { mission: null, set: null, other: null, log: null, place: false, reference: ref };
const ctx = {
  mission: () => state.mission,
  parameters: () => ({ set: state.set, other: state.other }),
  reference: async () => state.reference,
  log: () => state.log,
  attachments: () => [...files.values()].map((f) => f.a),
  attachmentBytes: async (id) => files.get(id)?.bytes ?? null,
  mayShowPlace: () => state.place,
};
const tools = appTools(ctx);
const run = async (name, input = {}) => {
  const r = await runTool(tools, name, input);
  return { ...r, json: JSON.parse(r.text) };
};
{
  eq('tools: nine', tools.length, 9);
  ok('tools: every one has a name, a purpose and a schema', tools.every((t) => /^[a-z_]+$/.test(t.name) && t.description.length > 40 && t.inputSchema.type === 'object'));
  ok('tools: none sends, uploads, arms, sets, writes or connects', !tools.some((t) => /(^|_)(send|upload|arm|disarm|set|write|save|delete|connect|command)(_|$)/.test(t.name)), tools.map((t) => t.name).join());
  ok('tools: the source opens nothing', !/fetch\(|XMLHttpRequest|WebSocket|navigator\.serial|node:(net|dgram|http|child_process)/.test(readFileSync(join(ROOT, 'lib', 'assistant', 'tools.ts'), 'utf8')));
  eq('rules', (await run('rules')).json.rules.length, RULES.length);

  // nothing open: each tool says so, and says what to do
  for (const name of ['open_mission', 'open_parameters', 'compare_open_parameters', 'open_log']) {
    const r = await run(name);
    ok(`${name}: with nothing open, says so in words`, !r.ok && /^No |^Nothing/.test(r.json.error), r.json.error);
  }
  eq('what_is_open: nothing', JSON.stringify((await run('what_is_open')).json), '{"schema":"flight-companion/open@1","mission":null,"parameters":null,"flight_log":null,"attached":[]}');
  ok('read_attachment: nothing attached', /Nothing is attached/.test((await run('read_attachment', { name: 'x' })).json.error));

  state.mission = mission;
  state.set = sets['after-bench'];
  state.other = sets.defaults;
  const open = (await run('what_is_open')).json;
  ok('what_is_open: a mission and a set', open.mission.name === 'Looking at a tower' && open.parameters.compared_with === 'Firmware defaults');
  const m = (await run('open_mission')).json;
  eq('open_mission', `${m.schema} ${m.mission.summary.waypoints}`, 'flight-companion/mission-brief@1 4');
  const p = await run('open_parameters');
  ok('open_parameters: with no filter, no list, and small', p.json.parameters.length === 0 && /find/.test(p.json.how_to_see_parameters) && p.text.length < 12_000, String(p.text.length));
  const pf = (await run('open_parameters', { find: 'BAT1_N' })).json;
  eq('open_parameters: find', pf.parameters.map((x) => `${x.name}=${x.value} ${x.value_means}`).join(), 'BAT1_N_CELLS=4 4S Battery');
  state.set = sets['wrong-names'];
  eq('open_parameters: only flagged', (await run('open_parameters', { only: 'flagged' })).json.parameters.map((x) => x.name).join(), 'FRAME_CLASS,SERIAL1_PROTOCOL,BATT_MONITOR');
  ok('open_parameters: a filter that does not exist', /takes one of/.test((await run('open_parameters', { only: 'everything' })).json.error));
  state.set = sets['after-bench'];
  const d = (await run('compare_open_parameters')).json;
  eq('compare_open_parameters', `${d.different} ${d.rows.find((r) => r.name === 'BAT1_N_CELLS').in_first_means}`, '5 4S Battery');

  const e = (await run('explain_parameter', { names: ['com_kill_disarm', 'FRAME_CLASS'] })).json;
  eq('explain_parameter: PX4\'s words', e.parameters[0].what_it_is, 'Timeout value for disarming when kill switch is engaged.');
  ok('explain_parameter: no PX4 name offered for an ArduPilot one', e.parameters[1].in_the_reference === false && !/use [A-Z0-9_]{4,}/.test(e.parameters[1].note));
  ok('search_parameters', (await run('search_parameters', { text: 'kill switch' })).json.parameters.some((x) => x.name === 'RC_MAP_KILL_SW'));
  state.reference = null;
  ok('explain_parameter: without the reference, says so and guesses nothing', /could not be loaded/.test((await run('explain_parameter', { names: ['BAT_LOW_THR'] })).json.error));
  state.reference = ref;
  ok('a tool that does not exist', /no tool called/.test((await run('arm_aircraft')).json.error));

  // attachments
  const plan = attach('field.plan', writeMission(mission, 'qgc-plan').data);
  attach('after.params', writeParams(sets.outside, 'qgc-params', ref).data);
  attach('notes.txt', new TextEncoder().encode('Props off before the bench test.\n'), 'text/plain');
  attach('hover.mp4', new Uint8Array(10), 'video/mp4');
  attach('breakout.jpg', new Uint8Array(10), 'image/jpeg');
  const am = (await run('read_attachment', { name: 'field.plan' })).json;
  eq('read_attachment: a mission', `${am.schema} ${am.mission.summary.waypoints}`, 'flight-companion/mission-brief@1 4');
  eq('read_attachment: by part of its name', (await run('read_attachment', { name: 'field' })).json.mission.read_from_file, plan.name);
  const ap = (await run('read_attachment', { name: 'after.params', find: 'BAT_CRIT' })).json;
  eq('read_attachment: parameters, filtered', ap.parameters.map((x) => `${x.name} ${x.outside_limits}`).join(), 'BAT_CRIT_THR true');
  eq('read_attachment: text', (await run('read_attachment', { name: 'notes.txt' })).json.text, 'Props off before the bench test.\n');
  ok('read_attachment: a video cannot be read, and it says so', /is a video/.test((await run('read_attachment', { name: 'hover.mp4' })).json.error));
  ok('read_attachment: an image needs no tool', /is an image/.test((await run('read_attachment', { name: 'breakout.jpg' })).json.error));
  ok('read_attachment: a name that is not there lists what is', /Attached: field\.plan/.test((await run('read_attachment', { name: 'other.plan' })).json.error));
  files.set('broken', { a: { id: 'broken', name: 'broken.plan', mime: '', bytes: 3, kind: 'mission' }, bytes: new TextEncoder().encode('{"a') });
  ok('read_attachment: a broken file is refused in the reader\'s words', /not valid JSON/.test((await run('read_attachment', { name: 'broken.plan' })).json.error));

  // what is open, as files, for an assistant that runs outside the page
  const asFiles = await openFiles(ctx);
  eq('open files: the mission and both sets of parameters', asFiles.map((f) => f.name).join(), 'open-mission.mission.json,open-parameters.params,compared-with.params');
  ok('open files: each says what it is', asFiles.every((f) => f.about.length > 20));
  eq('open files: the mission reads back whole', readMission(asFiles[0].bytes, asFiles[0].name).items.length, mission.items.length);
  eq('open files: the parameters read back whole', readParams(asFiles[1].bytes, asFiles[1].name, ref).entries.length, state.set.entries.length);
  state.mission = null;
  eq('open files: nothing open, nothing sent', (await openFiles({ ...ctx, parameters: () => ({ set: null, other: null }) })).length, 0);
  state.mission = mission;

  const x = mcpExchange(7, 'explain_parameter', { names: ['BAT_LOW_THR'] }, { ok: true, text: '{}' });
  eq('exchange: the request MCP would carry', JSON.stringify(x.request), '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"explain_parameter","arguments":{"names":["BAT_LOW_THR"]}}}');
  eq('exchange: and the response', JSON.stringify(x.response), '{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{}"}],"isError":false}}');
}

// ------------------------------------------------------------ the adapters
{
  eq('adapters: two', ADAPTERS.map((a) => a.id).join(), 'practice,claude-code');
  ok('adapters: each says whose account does the work', ADAPTERS.every((a) => a.about.length > 60));
  eq('adapters: the practice one is not a model, and says so', `${practiceAdapter.isModel} ${/Not an AI/.test(practiceAdapter.about)}`, 'false true');
  const where = claudeCodeAdapter.availability();
  ok('adapters: Claude Code is not there without the desktop app, and says why', !where.ok && /desktop app/.test(where.why));
  eq('adapters: so the one to start with is the practice one', defaultAdapterId(), 'practice');
  eq('adapters: an unknown id falls back', adapterById('nothing').id, 'practice');

  const ask = async (adapter, text, attachments = []) => {
    const events = [];
    const message = { id: `m${Math.random()}`, role: 'user', at: 0, text, attachments };
    await adapter.send({ history: [], message, sessionId: null, tools, attachmentBytes: ctx.attachmentBytes, conversationId: 'c1', openFiles: () => openFiles(ctx) }, (e) => events.push(e), new AbortController().signal);
    return { events, text: events.filter((e) => e.type === 'text').map((e) => e.text).join(''), calls: events.filter((e) => e.type === 'tool-call') };
  };
  const hello = await ask(practiceAdapter, 'hello');
  ok('practice: says it is not an AI', /I am not an AI/.test(hello.text) && hello.calls.length === 0);
  eq('practice: begins and ends', `${hello.events[0].type} ${hello.events.at(-1).type}`, 'started done');
  const kill = await ask(practiceAdapter, 'what is COM_KILL_DISARM and BAT_LOW_THR?');
  eq('practice: a parameter name is looked up', JSON.stringify(kill.calls.map((c) => [c.name, c.input])), '[["explain_parameter",{"names":["COM_KILL_DISARM","BAT_LOW_THR"]}]]');
  ok('practice: and the answer is PX4\'s words', /Timeout value for disarming when kill switch is engaged\./.test(kill.text) && /unit s/.test(kill.text) && /firmware default 5/.test(kill.text));
  ok('practice: every call gets its result', kill.events.filter((e) => e.type === 'tool-result').every((r) => kill.calls.some((c) => c.id === r.id)));
  const wrong = await ask(practiceAdapter, 'FRAME_CLASS');
  ok('practice: an ArduPilot name gets no PX4 name', /no parameter by this name/.test(wrong.text) && /no table/.test(wrong.text));
  eq('practice: find', (await ask(practiceAdapter, 'find kill switch')).calls[0].name, 'search_parameters');
  const mi = await ask(practiceAdapter, 'tell me about the mission');
  ok('practice: the open mission', mi.calls[0].name === 'open_mission' && /Looking at a tower/.test(mi.text) && /4 of them waypoints/.test(mi.text));
  eq('practice: a comparison', (await ask(practiceAdapter, 'compare the parameters')).calls.map((c) => c.name).join(), 'compare_open_parameters');
  const at = [...files.values()].map((f) => f.a).filter((a) => a.name === 'field.plan' || a.name === 'hover.mp4' || a.name === 'breakout.jpg');
  const withFiles = await ask(practiceAdapter, 'here you go', at);
  ok('practice: reads what it can of what is attached', withFiles.calls.length === 1 && withFiles.calls[0].input.name === 'field.plan');
  ok('practice: and says what it cannot', /cannot see \*\*breakout\.jpg\*\*/.test(withFiles.text) && /No assistant here can watch a video/.test(withFiles.text));
  state.log = null;
  const noLog = await ask(practiceAdapter, 'how was the battery in the flight?');
  ok('practice: a tool that refuses is passed on in its words', /No flight log is open/.test(noLog.text));
  // stopped part way
  practicePace.msPerWord = 5;
  const stop = new AbortController();
  const got = [];
  setTimeout(() => stop.abort(), 30);
  await practiceAdapter.send({ history: [], message: { id: 's', role: 'user', at: 0, text: 'hello' }, sessionId: null, tools, attachmentBytes: ctx.attachmentBytes, conversationId: 'c1', openFiles: () => openFiles(ctx) }, (e) => got.push(e), stop.signal);
  practicePace.msPerWord = 0;
  ok('practice: stops when told to, and does not say done', got.length > 1 && got.at(-1).type !== 'done' && got.filter((e) => e.type === 'text').length < 40, String(got.length));

  const none = await ask(claudeCodeAdapter, 'hello');
  ok('claude code: asked without the desktop app, answers with the reason', none.events.length === 1 && none.events[0].type === 'error' && /desktop app/.test(none.events[0].message));
}

// ------------------------------------------------------------ the real program, when asked for
if (live) {
  const work = mkdtempSync(join(tmpdir(), 'fc-cc-'));
  try {
    const config = join(work, 'mcp.json');
    writeFileSync(config, JSON.stringify({ mcpServers: { 'flight-companion': { command: process.execPath, args: ['--no-warnings', join(ROOT, 'mcp', 'files', 'server.mjs')] } } }));
    const args = claudeCodeArgs({
      prompt: '',
      sessionId: null,
      mcpConfigPath: config,
      servers: [{ name: FILES_SERVER.name, tools: ['explain_parameter'] }],
      builtIn: [],
      folders: [],
      instructions: 'Answer in one short sentence.',
    });
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    const candidates = found.stdout.split(/\s*\n\s*/).filter(Boolean);
    const program = candidates.find((c) => /\.exe$/i.test(c)) ?? candidates[0] ?? 'claude';
    ok('live: Claude Code is a program that can be started directly', process.platform !== 'win32' || /\.exe$/i.test(program), program);
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const events = await new Promise((resolve) => {
      // started directly, never through a shell: a shell drops the empty argument after --tools,
      // and what follows it is then read as its value
      const child = spawn(program, args, { cwd: work, env, shell: false });
      const stream = new ClaudeCodeStream();
      const out = [];
      let err = '';
      child.stdout.on('data', (c) => out.push(...stream.push(c.toString('utf8'))));
      child.stderr.on('data', (c) => (err += c.toString('utf8')));
      child.on('error', (e) => resolve([{ type: 'error', message: `Claude Code could not be started: ${e.message}` }]));
      child.on('close', (code) => resolve([...out, ...stream.end(code, err)]));
      child.stdin.end('Use the explain_parameter tool on BAT_LOW_THR. What is its firmware default?');
    });
    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    const call = events.find((e) => e.type === 'tool-call');
    eq('live: started', events[0]?.type, 'started');
    eq('live: called our tool', call?.name, 'mcp__flight-companion__explain_parameter');
    ok('live: answered from it', /0\.15/.test(text), text);
    eq('live: finished', events.at(-1)?.type, 'done');
    console.log(`  live: ${events[0]?.model}, ${events.length} events, answer: ${text.trim().slice(0, 120)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
} else {
  console.log('  skipped: the real Claude Code (run with --live; it uses the account Claude Code is signed in to)');
}

console.log(`\nassistant: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
