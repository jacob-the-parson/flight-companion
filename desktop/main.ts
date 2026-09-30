// The desktop app's main process. It does four things:
//   1. shows the app, which is the same pages as the web app, built as files;
//   2. starts Claude Code when the chat asks, and passes its answer back;
//   3. listens, when the user switches it on, for the copy of the aircraft's
//      messages that QGroundControl forwards to this computer;
//   4. keeps the page in its box: it can load nothing from the internet but map
//      tiles, open no window of its own, and ask for nothing but what is here.
//
// It holds no link to an aircraft. The one port it opens is for listening, on
// this computer only (127.0.0.1), off until asked for, and its ways of sending
// are replaced with one that raises (mcp/observer/listener.ts). The page talks
// to the main process through the messages listed in preload.ts.
import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Conversation, findClaudeCode, type Found } from './claude.ts';
import type { AssistantEvent } from '../lib/assistant/types.ts';
import type { LiveReply } from '../lib/observer/bridge.ts';
import { liveView } from '../lib/observer/view.ts';
import { listen as hear, settingsFromEnv, type Listening } from '../mcp/observer/listener.ts';

const SCHEME = 'app';
const HOST = 'flight-companion';
const ORIGIN = `${SCHEME}://${HOST}`;
const TILES = 'https://tile.openstreetmap.org';
// who to ask about this app, for OpenStreetMap: the app's public repository (the owner allowed it to be named)
const CONTACT = 'https://github.com/jacob-the-parson/flight-companion';

// where things are: beside this file when run from the folder, in resources when installed
const packaged = app.isPackaged;
const PAGES = packaged ? join(process.resourcesPath, 'pages') : join(__dirname, '..', '..', 'out');
const TOOLS = packaged ? join(process.resourcesPath, 'tools') : __dirname;
const FILES_SERVER_PATH = join(TOOLS, 'files-server.mjs');
const OBSERVER_SERVER_PATH = join(TOOLS, 'observer-server.mjs');
const REFERENCE_PATH = join(PAGES, 'data', 'px4-v1.16.0-parameters.json');

// a folder for tests to use instead of the user's own
if (process.env.FC_USER_DATA) app.setPath('userData', process.env.FC_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

// What a page of the app may load. Scripts and styles: the app's own (Next.js
// writes some of both into the page itself). Pictures: the app's own, ones made
// in the page, and map tiles. Nothing else from anywhere.
const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${TILES}`,
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** The file for an address, or null. Never a file outside the pages folder. */
function fileFor(pathname: string): string | null {
  let wanted: string;
  try {
    wanted = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const base = normalize(join(PAGES, wanted));
  if (base !== PAGES && !base.startsWith(PAGES + sep)) return null;
  const tries = [base, `${base}.html`, join(base, 'index.html')];
  for (const t of tries) if (existsSync(t) && statSync(t).isFile()) return t;
  return null;
}

async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host !== HOST) return new Response('Not found', { status: 404 });
  const file = fileFor(url.pathname) ?? fileFor('/404');
  if (!file) return new Response('Not found', { status: 404 });
  // read here, not fetched: a fetch would pass through the guard below, which lets no file:// through
  const body = await readFile(file);
  const found = fileFor(url.pathname) !== null;
  return new Response(new Uint8Array(body), {
    status: found ? 200 : 404,
    headers: {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-security-policy': POLICY,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

let claude: Found | null = null;
let conversation: Conversation | null = null;

// ---------------------------------------------------------------- listening for the aircraft
// The address is this computer's and cannot be set. The port is QGroundControl's
// own default; QGC_FWD_PORT changes it, for a test or for a ground station set otherwise.
const HEARING = { host: '127.0.0.1', port: settingsFromEnv().port, showPlace: false };
// what has been heard, kept as a file for the assistant's tools to read: they open no port of their own
const heardFile = (): string => join(app.getPath('userData'), 'observer', 'heard.json');
let hearing: Listening | null = null;
let changed = false;
let writing: NodeJS.Timeout | null = null;

function writeHeard(): void {
  if (!hearing || !changed) return;
  changed = false;
  try {
    const file = heardFile();
    mkdirSync(join(file, '..'), { recursive: true });
    // written beside and then moved into place, so that a reader never sees half a file
    writeFileSync(`${file}.part`, hearing.state.toSnapshot(Date.now() / 1000));
    renameSync(`${file}.part`, file);
  } catch {
    // the disk is full or the folder is gone: the screen still works, the assistant's tools say nothing is held
  }
}

function startHearing(): void {
  if (hearing) return;
  hearing = hear(HEARING, {
    onChange: () => {
      changed = true;
    },
  });
  changed = true;
  writing = setInterval(writeHeard, 1000);
}

async function stopHearing(): Promise<void> {
  if (writing) clearInterval(writing);
  writing = null;
  const h = hearing;
  hearing = null;
  if (h) await h.stop();
  // what was heard is not kept once listening stops
  rmSync(heardFile(), { force: true });
  rmSync(`${heardFile()}.part`, { force: true });
}

function heard(): LiveReply {
  return {
    listening: hearing !== null,
    bound: hearing?.bound() ?? false,
    port: HEARING.port,
    view: hearing ? liveView(hearing.state, Date.now() / 1000, HEARING) : null,
  };
}

function assistants(): Found[] {
  claude = findClaudeCode();
  if (claude.found && claude.program) {
    conversation = new Conversation({
      root: join(app.getPath('userData'), 'conversations'),
      program: claude.program,
      // the files server runs in this app's own Node: nothing else has to be installed
      server: {
        command: process.execPath,
        args: [FILES_SERVER_PATH],
        env: { ELECTRON_RUN_AS_NODE: '1', FC_REFERENCE: REFERENCE_PATH },
      },
      // the observer's tools answer from the file this app keeps of what it has heard.
      // Started this way the server opens no port. The position stays out.
      observer: {
        command: process.execPath,
        args: [OBSERVER_SERVER_PATH],
        env: { ELECTRON_RUN_AS_NODE: '1', FC_OBSERVER_SNAPSHOT: heardFile(), FC_OBSERVER_PLACE: '', QGC_FWD_PORT: String(HEARING.port) },
      },
    });
  }
  // the page is told whether it was found and its version, not where it is
  return [{ id: claude.id, found: claude.found, version: claude.version, ...(claude.why ? { why: claude.why } : null) }];
}

/** Only the app's own page may ask, and only from its main frame. */
function fromTheApp(event: Electron.IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && frame.url.startsWith(`${ORIGIN}/`);
}

const isFile = (f: unknown): f is { name: string; about: string; bytes: Uint8Array } =>
  !!f && typeof f === 'object' && typeof (f as { name: unknown }).name === 'string' && typeof (f as { about: unknown }).about === 'string' && (f as { bytes: unknown }).bytes instanceof Uint8Array;

function listen(): void {
  ipcMain.handle('assistant:list', (event) => (fromTheApp(event) ? assistants() : []));

  ipcMain.handle('assistant:ask', async (event, request: unknown, channel: unknown) => {
    if (!fromTheApp(event) || typeof channel !== 'string' || !/^[a-z0-9-]{8,64}$/.test(channel)) return;
    const send = (e: AssistantEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(`assistant:event:${channel}`, e);
    };
    const r = (request ?? {}) as Record<string, unknown>;
    if (r.adapter !== 'claude-code' || typeof r.conversationId !== 'string' || typeof r.prompt !== 'string' || !Array.isArray(r.files) || !r.files.every(isFile)) {
      send({ type: 'error', message: 'The request was not one this app makes.' });
      return;
    }
    if (!conversation) assistants();
    if (!conversation) {
      send({ type: 'error', message: claude?.why ?? 'Claude Code was not found on this computer.' });
      return;
    }
    await conversation.ask(
      { conversationId: r.conversationId, prompt: r.prompt, sessionId: typeof r.sessionId === 'string' ? r.sessionId : null, files: r.files },
      send,
    );
  });

  ipcMain.handle('assistant:stop', (event) => {
    if (fromTheApp(event)) conversation?.stop();
  });

  ipcMain.handle('observer:start', (event) => {
    if (!fromTheApp(event)) return null;
    startHearing();
    return heard();
  });
  ipcMain.handle('observer:stop', async (event) => {
    if (!fromTheApp(event)) return null;
    await stopHearing();
    return heard();
  });
  ipcMain.handle('observer:view', (event) => (fromTheApp(event) ? heard() : null));

  ipcMain.handle('assistant:forget', (event, id: unknown) => {
    if (!fromTheApp(event) || typeof id !== 'string') return;
    try {
      conversation?.forget(id);
    } catch {
      // an id that is not one: nothing to forget
    }
  });
}

function guard(): void {
  const s = session.defaultSession;

  // OpenStreetMap asks an app to say who it is, and not to pass as a browser
  s.webRequest.onBeforeSendHeaders({ urls: [`${TILES}/*`] }, (details, done) => {
    details.requestHeaders['User-Agent'] = `FlightCompanion/${app.getVersion()} (desktop; +${CONTACT})`;
    done({ requestHeaders: details.requestHeaders });
  });

  // the page may fetch its own files and map tiles. Anything else is stopped here,
  // whatever the page's own policy says.
  s.webRequest.onBeforeRequest((details, done) => {
    const u = details.url;
    const ok = u.startsWith(`${ORIGIN}/`) || u.startsWith(`${TILES}/`) || u.startsWith('blob:') || u.startsWith('data:') || u.startsWith('devtools:') || u.startsWith('chrome-extension:');
    done({ cancel: !ok });
  });

  // copying to the clipboard, and nothing else: no camera, no microphone, no position
  s.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));
  s.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write' || permission === 'clipboard-read');
}

function open(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 560,
    show: false,
    backgroundColor: '#f4f4f5',
    title: 'Flight Companion',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // a link in an answer opens in the user's own browser, and only an https one
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // the window shows the app and nothing else
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  void win.loadURL(`${ORIGIN}/dashboard`);
}

if (!app.requestSingleInstanceLock() && !process.env.FC_USER_DATA) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  void app.whenReady().then(() => {
    if (!existsSync(join(PAGES, 'dashboard.html')) && !existsSync(join(PAGES, 'dashboard', 'index.html'))) {
      console.error(`The app's pages are not at ${PAGES}. Run "npm run desktop:build" first.`);
      app.exit(1);
      return;
    }
    // nothing heard in an earlier run is left for an assistant to read as if it were now
    rmSync(heardFile(), { force: true });
    app.on('will-quit', () => {
      rmSync(heardFile(), { force: true });
    });
    protocol.handle(SCHEME, serve);
    guard();
    listen();
    open();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && open());
  });
  app.on('window-all-closed', () => {
    conversation?.stop();
    void stopHearing();
    if (process.platform !== 'darwin') app.quit();
  });
}
