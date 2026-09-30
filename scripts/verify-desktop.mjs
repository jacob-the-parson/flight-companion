// Checks for the desktop app. It starts the real thing (Electron, with the pages
// and scripts that `npm run desktop:build` made) and asks it questions through
// the browser's own debugging port.
//
//   node scripts/verify-desktop.mjs [--live] [--app <path to an installed or unpacked app>]
//
// --live  also sends one message in the chat and waits for Claude Code to answer.
//         It uses the account Claude Code is signed in to. Off by default.
// --app   check a packaged app (release/win-unpacked/Flight Companion.exe) instead
//         of the one in this folder.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const live = process.argv.includes('--live');
// made whole, since the app is started from another folder
const packagedApp = arg('--app') ? resolve(arg('--app')) : null;
const electron = join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const program = packagedApp ?? electron;
const resources = packagedApp ? join(packagedApp, '..', 'resources') : null;
const serverFile = resources ? join(resources, 'tools', 'files-server.mjs') : join(ROOT, 'desktop', 'dist', 'files-server.mjs');
const observerFile = resources ? join(resources, 'tools', 'observer-server.mjs') : join(ROOT, 'desktop', 'dist', 'observer-server.mjs');
// made-up packets, for sending to the app ON THIS COMPUTER, on a port asked of the system
const reference = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'observer-reference.json'), 'utf8'));
const NOT_THESE = [14445, 14550, 14540, 14556, 14557, 14580, 18570];
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
async function freeUdpPort() {
  for (;;) {
    const p = await new Promise((resolve) => {
      const s = createSocket('udp4');
      s.bind(0, '127.0.0.1', () => {
        const port = s.address().port;
        s.close(() => resolve(port));
      });
    });
    if (!NOT_THESE.includes(p)) return p;
  }
}
const canTake = (port) =>
  new Promise((resolve) => {
    const s = createSocket({ type: 'udp4', reuseAddr: false });
    s.once('error', () => resolve(false));
    s.bind({ port, address: '127.0.0.1', exclusive: true }, () => s.close(() => resolve(true)));
  });
async function play(port, packets) {
  if (NOT_THESE.includes(port) || port < 1024) throw new Error(`refused: ${port} is not a port for a test`);
  const s = createSocket('udp4');
  for (const p of packets) await new Promise((resolve, reject) => s.send(bytes(p.hex), port, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
  await new Promise((resolve) => s.close(resolve));
}
const pages = resources ? join(resources, 'pages') : join(ROOT, 'out');

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(program) || !existsSync(serverFile) || !existsSync(observerFile) || !existsSync(join(pages, 'dashboard.html'))) {
  console.log(`  skipped: the desktop app is not built here (run "npm run desktop:build"). Looked for ${program}, ${serverFile} and ${pages}`);
  console.log('\ndesktop: 0 checks passed, 0 failed, 1 group(s) skipped');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'fc-desktop-'));
let child = null;

try {
  // ---------------------------------------------------------- what is in the box
  {
    const main = packagedApp ? '' : readFileSync(join(ROOT, 'desktop', 'dist', 'main.cjs'), 'utf8');
    if (!packagedApp) {
      ok('main: the page is sandboxed, isolated and without Node', /sandbox:\s*true/.test(main) && /contextIsolation:\s*true/.test(main) && /nodeIntegration:\s*false/.test(main));
      ok('main: opens no server, and no port but the one for listening', !/createServer|node:net"|require\("net"\)|require\("http"\)/.test(main) && (main.match(/createSocket\)?\(/g) ?? []).length === 1);
      ok('main: the listening socket refuses to send, and listens on this computer only', /the observer never transmits/.test(main) && /host:\s*"127\.0\.0\.1"/.test(main) && !/0\.0\.0\.0/.test(main));
      ok('main: never the flag that skips permissions, never the mode that skips the login', !/dangerously|bypassPermissions|"--bare"/.test(main));
      ok('main: starts programs without a shell', !/shell:\s*true/.test(main) && (main.match(/shell:\s*false/g) ?? []).length >= 3);
    }
    const pre = packagedApp ? '' : readFileSync(join(ROOT, 'desktop', 'dist', 'preload.cjs'), 'utf8');
    if (!packagedApp) {
      eq('preload: seven messages, and no other', [...new Set(pre.match(/(assistant|observer):[a-z]+/g))].sort().join(), 'assistant:ask,assistant:event,assistant:forget,assistant:list,assistant:stop,observer:start,observer:stop,observer:view');
      ok('preload: gives the page no Node', !/require\("(fs|child_process|path|os)"\)/.test(pre));
    }
  }

  // ---------------------------------------------------------- the tools server, as the app runs it
  {
    const transport = new StdioClientTransport({
      command: program,
      args: [serverFile],
      cwd: work,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FC_REFERENCE: join(pages, 'data', 'px4-v1.16.0-parameters.json') },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'verify-desktop', version: '1.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      eq('tools server: one file, run by the app\'s own Node, offers thirteen tools', tools.length, 13);
      const r = await client.callTool({ name: 'explain_parameter', arguments: { names: ['COM_KILL_DISARM'] } });
      const doc = JSON.parse(r.content[0].text);
      eq('tools server: finds PX4\'s reference where the app put it', doc.parameters?.[0]?.what_it_is, 'Timeout value for disarming when kill switch is engaged.');
      const f = await client.callTool({ name: 'list_formats', arguments: {} });
      eq('tools server: the formats', JSON.parse(f.content[0].text).missions.length, 8);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------- the observer, as the app gives it to Claude Code
  {
    const transport = new StdioClientTransport({
      command: program,
      args: [observerFile],
      cwd: work,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FC_OBSERVER_SNAPSHOT: join(work, 'not-there.json'), FC_OBSERVER_PLACE: '', QGC_FWD_PORT: '14445' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'verify-desktop', version: '1.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      eq('observer: one file, run by the app\'s own Node, offers nine tools', tools.length, 9);
      const r = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text);
      ok('observer: with the app not listening it says so, and opens no port', r.vehicle === null && /desktop app is not listening/.test(r.recent_errors?.at(-1)?.error ?? '') && r.heard_by === 'the desktop app', JSON.stringify(r).slice(0, 300));
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------- the app itself
  const udp = await freeUdpPort();
  const port = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const env = { ...process.env, FC_USER_DATA: join(work, 'user-data'), QGC_FWD_PORT: String(udp) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  child = spawn(program, [...(packagedApp ? [] : [ROOT]), `--remote-debugging-port=${port}`, '--remote-allow-origins=*'], { env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let log = '';
  child.stdout.on('data', (c) => (log += c));
  child.stderr.on('data', (c) => (log += c));

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await wait(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith('app://')) ?? null;
    } catch {
      /* not up yet */
    }
  }
  ok('the app starts and shows a page of its own', !!target, log.slice(-400));
  if (!target) throw new Error('the app did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not reach the page'));
  });
  let seq = 0;
  const waiting = new Map();
  const errors = [];
  const blocked = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) {
      waiting.get(d.id)(d);
      waiting.delete(d.id);
    } else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') blocked.push(d.params.entry.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const page = async (expression) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  const go = async (path) => {
    await send('Page.navigate', { url: `app://flight-companion${path}` });
    await wait(1500);
  };
  await wait(1500);

  eq('page: its address', await page('return location.origin + location.pathname'), 'app://flight-companion/dashboard');
  ok('page: the dashboard', /Dashboard/.test((await page('return document.body.innerText')) ?? ''));
  eq('page: has no Node', await page('return [typeof process, typeof require, typeof module].join()'), 'undefined,undefined,undefined');
  eq('page: is told it is in the desktop app, and given four functions', await page('return window.flightCompanion.desktop + " " + Object.keys(window.flightCompanion.assistant).sort().join()'), 'true ask,assistants,forget,stop,version');
  eq('page: and three for listening', await page('return Object.keys(window.flightCompanion.observer).sort().join()'), 'start,stop,version,view');
  eq('page: keeps what it stores', await page('localStorage.setItem("fc-test", "1"); const v = localStorage.getItem("fc-test"); localStorage.removeItem("fc-test"); return v'), '1');
  eq('page: can use its database', await page('return await new Promise((r) => { const q = indexedDB.open("fc-test"); q.onsuccess = () => { q.result.close(); indexedDB.deleteDatabase("fc-test"); r("ok"); }; q.onerror = () => r("no"); })'), 'ok');
  eq('page: loads PX4\'s reference from the app', await page('const r = await fetch("/data/px4-v1.16.0-parameters.json"); return (await r.json()).firmware'), 'PX4 v1.16.0');

  // the box it is kept in
  const out = await page('try { await fetch("https://example.com/"); return "reached" } catch (e) { return "refused" }');
  eq('box: the page cannot reach the internet', out, 'refused');
  const img = await page('return await new Promise((r) => { const i = new Image(); i.onload = () => r("loaded"); i.onerror = () => r("refused"); i.src = "https://example.com/x.png?" + Date.now(); })');
  eq('box: nor load a picture from it', img, 'refused');
  const up = await page('try { const r = await fetch("/../package.json"); return r.status } catch (e) { return "refused" }');
  ok('box: nor read a file outside its pages', up === 404 || up === 'refused', String(up));
  const enc = await page('try { const r = await fetch("/%2e%2e/%2e%2e/package.json"); return r.status } catch (e) { return "refused" }');
  ok('box: however the path is written', enc === 404 || enc === 'refused', String(enc));
  eq('box: a page that is not there says so', await page('return (await fetch("/no-such-page")).status'), 404);
  eq('box: a window of its own is not opened', await page('const w = window.open("https://example.com/"); return w === null ? "refused" : "opened"'), 'refused');

  // every domain's page
  for (const path of ['/checklists', '/live', '/planner', '/missions', '/parameters', '/logs', '/assistant', '/settings']) {
    await go(path);
    const where = await page('return location.pathname + " " + document.querySelectorAll("footer > div").length');
    eq(`page ${path}: shown, with its five footer slots`, where, `${path} 5`);
  }

  // the map, and who the app says it is when it asks for a tile
  await go('/missions');
  await page('const b = [...document.querySelectorAll("main button")].find((x) => x.textContent.trim().startsWith("Three waypoints")); b?.click(); return !!b');
  await wait(3500);
  const tiles = await page('return [...document.querySelectorAll(".leaflet-tile")].map((t) => ({ src: t.src, ok: t.complete && t.naturalWidth > 0 }))');
  ok('map: tiles are asked of OpenStreetMap', Array.isArray(tiles) && tiles.length > 0 && tiles.every((t) => t.src.startsWith('https://tile.openstreetmap.org/')), JSON.stringify(tiles?.slice?.(0, 2)));
  if (Array.isArray(tiles) && !tiles.some((t) => t.ok)) console.log('  note: no tile arrived; this computer may be offline. The app works without them.');
  ok('map: OpenStreetMap is named on it', /OpenStreetMap/.test((await page('return document.querySelector(".leaflet-control-attribution")?.innerText ?? ""')) ?? ''));

  // listening for the aircraft: off at the start, on when asked, and only on this computer
  await go('/live');
  const heardFile = join(work, 'user-data', 'observer', 'heard.json');
  const before = await page('return await window.flightCompanion.observer.view()');
  ok('live: the app is not listening when it starts', before?.listening === false && before?.view === null && (await canTake(udp)), JSON.stringify(before));
  ok('live: the page offers to listen, and says the practice flight is made up', /Listen for the aircraft/.test((await page('return document.body.innerText')) ?? '') && /made-up/.test((await page('return document.body.innerText')) ?? ''));
  await page('const b = [...document.querySelectorAll("main button")].find((x) => /Listen for the aircraft/.test(x.textContent) && !x.disabled); b?.click(); return !!b');
  await wait(1200);
  const on = await page('return await window.flightCompanion.observer.view()');
  ok('live: switched on from the page, it holds the port', on?.listening === true && on?.bound === true && on?.port === udp && !(await canTake(udp)), JSON.stringify(on));
  await play(udp, reference.packets.slice(0, -3));
  await wait(2500);
  const heard = await page('return await window.flightCompanion.observer.view()');
  ok('live: what was sent is heard', heard?.view?.vehicle?.type === 'Quadrotor' && heard.view.vehicle.mode === 'POSCTL' && heard.view.vehicle.armed === true, JSON.stringify(heard?.view?.vehicle));
  ok('live: no position reaches the page', !/47397|85455|47\.39|8\.54/.test(JSON.stringify(heard)));
  const shown = (await page('return document.body.innerText')) ?? '';
  ok('live: and the screen shows it', /Quadrotor/.test(shown) && /POSCTL/.test(shown) && /Armed/.test(shown) && /Listening on this computer/.test(shown), shown.slice(0, 300));
  ok('live: what is heard is written for the assistant\'s tools, without the position', existsSync(heardFile) && /HEARTBEAT/.test(readFileSync(heardFile, 'utf8')) && /observer-snapshot/.test(readFileSync(heardFile, 'utf8')), heardFile);
  {
    // the observer, as Claude Code would be given it now, reads that file
    const transport = new StdioClientTransport({ command: program, args: [observerFile], cwd: work, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FC_OBSERVER_SNAPSHOT: heardFile, FC_OBSERVER_PLACE: '', QGC_FWD_PORT: String(udp) }, stderr: 'pipe' });
    const client = new Client({ name: 'verify-desktop', version: '1.0.0' });
    try {
      await client.connect(transport);
      const s = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text);
      eq('live: the assistant\'s observer answers from it', s.vehicle?.type, 'MAV_TYPE_QUADROTOR');
      const p = JSON.parse((await client.callTool({ name: 'param', arguments: { name: 'SYS_AUTOSTART' } })).content[0].text);
      eq('live: a parameter, whole', p.value, 4019);
      const h = JSON.parse((await client.callTool({ name: 'latest', arguments: { msg_type: 'HOME_POSITION' } })).content[0].text);
      ok('live: the position is left out of what the assistant is told', /left out/.test(String(h.fields?.latitude)), JSON.stringify(h).slice(0, 200));
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
  const off = await page('return await window.flightCompanion.observer.stop()');
  await wait(600);
  ok('live: stopped, the port is free and nothing heard is kept', off?.listening === false && (await canTake(udp)) && !existsSync(heardFile), JSON.stringify(off));

  // the assistant
  await go('/assistant');
  const found = await page('return await window.flightCompanion.assistant.assistants()');
  ok('assistant: the app looks for Claude Code, and says what it found', Array.isArray(found) && found[0]?.id === 'claude-code' && typeof found[0].found === 'boolean', JSON.stringify(found));
  ok('assistant: the page is not told where the program is', !JSON.stringify(found).includes('program') && !/[A-Za-z]:\\\\|\/usr\/|\/home\//.test(JSON.stringify(found).replace(/"why":"[^"]*"/, '')), JSON.stringify(found));
  const has = found?.[0]?.found === true;
  console.log(`  Claude Code on this computer: ${has ? `found, version ${found[0].version}` : `not found (${found?.[0]?.why ?? ''})`}`);
  const text = (await page('return document.body.innerText')) ?? '';
  ok('assistant: Claude Code is who answers here', /Claude Code/.test(text) && !/Practice assistant\s*not an AI/i.test(text.split('\n').slice(0, 12).join('\n')), text.slice(0, 200));
  const refusedAsk = await page('const got = []; await window.flightCompanion.assistant.ask({ adapter: "something-else", conversationId: "x", prompt: "hi", sessionId: null, files: [] }, (e) => got.push(e)); return got');
  ok('assistant: a request the app does not make is refused', refusedAsk?.[0]?.type === 'error', JSON.stringify(refusedAsk));
  const badId = await page('const got = []; await window.flightCompanion.assistant.ask({ adapter: "claude-code", conversationId: "../../x", prompt: "hi", sessionId: null, files: [{ name: "../../../evil.txt", about: "a test", bytes: new Uint8Array([1]) }] }, (e) => got.push(e)).catch((e) => got.push({ type: "thrown", message: String(e) })); await window.flightCompanion.assistant.stop(); return got.map((e) => e.type)');
  await wait(1500);
  const conv = join(work, 'user-data', 'conversations');
  const made = existsSync(conv) ? readdirSync(conv) : [];
  ok('assistant: a conversation\'s folder is inside the app\'s own, whatever its id', made.every((d) => /^[A-Za-z0-9_-]+$/.test(d)) && !existsSync(join(work, 'x')) && !existsSync(join(work, 'user-data', 'x')), `${JSON.stringify(made)} ${JSON.stringify(badId)}`);
  ok('assistant: a file\'s name cannot put it outside that folder', !existsSync(join(work, 'evil.txt')) && !existsSync(join(work, 'user-data', 'evil.txt')) && !existsSync(join(conv, 'evil.txt')));

  if (live && has) {
    await go('/assistant');
    await page('const s = JSON.parse(localStorage.getItem("fc-assistant") ?? "{}"); return 1');
    const typed = await page(`
      const box = document.querySelector('main textarea[aria-label="Your message"]');
      box.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Use your tools. What is the firmware default of BAT_LOW_THR, and its unit? One sentence.');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('main button[aria-label="Send"]').click();
      return true`);
    ok('live: the message was sent', typed === true);
    let answer = '';
    for (let i = 0; i < 240; i++) {
      await wait(500);
      const busy = await page('return !!document.querySelector(\'button[aria-label="Stop the answer"]\')');
      answer = (await page('return [...document.querySelectorAll("main [role=log] article")].at(-1)?.innerText ?? ""')) ?? '';
      if (!busy && i > 4) break;
    }
    ok('live: Claude Code answered in the chat', /CLAUDE CODE/i.test(answer) && !/Could not answer/.test(answer), answer.slice(0, 400));
    ok('live: it used the app\'s tool, and the card shows it', /TOOL\s*(explain parameter|search parameters)/i.test(answer), answer.slice(0, 300));
    ok('live: and answered from it', /0\.15/.test(answer), answer.slice(-300));
    const kept = await page('return JSON.parse(localStorage.getItem("fc-assistant")).state.conversations[0]');
    ok('live: the conversation can be continued', typeof kept?.sessionId === 'string' && kept.sessionId.length > 10 && kept.adapter === 'claude-code', JSON.stringify(kept));
    const folder = join(conv, kept?.id ?? 'none');
    ok('live: its folder holds the rules and the server\'s entry, and nothing of a key', existsSync(join(folder, '.instructions.md')) && existsSync(join(folder, '.mcp.json')) && !/api[_-]?key|token|secret/i.test(readFileSync(join(folder, '.mcp.json'), 'utf8')));
    console.log(`  live: ${answer.replace(/\s+/g, ' ').slice(0, 260)}`);

    // a second question, with the app listening and the made-up aircraft heard
    await page('await window.flightCompanion.observer.start(); return 1');
    await wait(800);
    await play(udp, reference.packets.slice(0, -3));
    await wait(2500);
    await page(`
      const box = document.querySelector('main textarea[aria-label="Your message"]');
      box.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Use your observer tools. Is an aircraft being heard right now? If so, say its type, flight mode and whether it is armed, in one sentence.');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector('main button[aria-label="Send"]').click();
      return true`);
    let second = '';
    for (let i = 0; i < 240; i++) {
      await wait(500);
      const busy = await page('return !!document.querySelector(\'button[aria-label="Stop the answer"]\')');
      second = (await page('return [...document.querySelectorAll("main [role=log] article")].at(-1)?.innerText ?? ""')) ?? '';
      if (!busy && i > 4) break;
    }
    ok('live: Claude Code used the observer\'s tool', /TOOL\s*status/i.test(second), second.slice(0, 300));
    ok('live: and said what is heard', /quad(rotor|copter)/i.test(second) && /POSCTL/.test(second) && /armed/i.test(second), second.slice(-400));
    ok('live: without the position', !/47\.39|8\.54/.test(second));
    await page('await window.flightCompanion.observer.stop(); return 1');
    console.log(`  live: ${second.replace(/\s+/g, ' ').slice(0, 300)}`);
  } else {
    console.log(`  skipped: a real answer from Claude Code (${has ? 'run with --live; it uses the account Claude Code is signed in to' : 'Claude Code is not on this computer'})`);
  }

  ok('no error was thrown in any page', errors.length === 0, errors.slice(0, 2).map((e) => String(e).split('\n')[0]).join(' | '));
  ws.close();
} catch (e) {
  failed++;
  console.log(`  FAIL the check itself stopped: ${e?.message ?? e}`);
} finally {
  if (child?.pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { shell: false });
    else child.kill('SIGKILL');
  }
  await wait(800);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`\ndesktop: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
