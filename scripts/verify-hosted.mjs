// Checks for the hosted page, as built by scripts/build-hosted.mjs.
//
//   node scripts/verify-hosted.mjs [base path]
//
// It serves out-hosted/ on this computer, under the base path, the way GitHub
// Pages would (a page called dashboard.html answers at /dashboard), and asks for
// what a browser would ask for. The server is for the test and stops with it.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'out-hosted');
const base = process.argv[2] ?? '/flight-companion';

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

if (!existsSync(join(OUT, 'dashboard.html'))) {
  console.log('  skipped: the hosted page is not built here (run "npm run hosted:build")');
  console.log('\nhosted: 0 checks passed, 0 failed, 1 group(s) skipped');
  process.exit(0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(`${base}/`) && path !== base) {
    res.writeHead(404).end('outside the site');
    return;
  }
  const at = normalize(join(OUT, path.slice(base.length) || '/'));
  if (at !== OUT && !at.startsWith(OUT + sep)) {
    res.writeHead(404).end();
    return;
  }
  const file = [at, `${at}.html`, join(at, 'index.html')].find((f) => existsSync(f) && statSync(f).isFile());
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html' }).end(readFileSync(join(OUT, '404.html')));
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const get = async (path) => {
  const r = await fetch(origin + path);
  return { status: r.status, text: await r.text() };
};

try {
  ok('.nojekyll is there, so GitHub Pages serves the _next folder', existsSync(join(OUT, '.nojekyll')));
  const pages = ['dashboard', 'checklists', 'live', 'planner', 'missions', 'parameters', 'logs', 'assistant', 'settings'];
  for (const p of pages) {
    const r = await get(`${base}/${p}`);
    eq(`/${p}: answers`, r.status, 200);
    // every script, style and link the page names must be under the base path, and be there
    const named = [...r.text.matchAll(/(?:src|href)="(\/[^"#?]+)/g)].map((m) => m[1]);
    const outside = named.filter((u) => !u.startsWith(`${base}/`) && u !== base);
    ok(`/${p}: names nothing outside the site's own path`, outside.length === 0, outside.slice(0, 3).join());
    const scripts = [...new Set(named.filter((u) => /\.(js|css)$/.test(u)))];
    let missing = 0;
    for (const u of scripts) if ((await fetch(origin + u)).status !== 200) missing += 1;
    ok(`/${p}: its ${scripts.length} scripts and styles are all there`, scripts.length > 3 && missing === 0, `${missing} missing`);
  }
  // the parts of each page, which the app asks for as it moves between pages
  for (const p of pages) {
    const parts = readdirSync(join(OUT, p), { withFileTypes: true });
    ok(`/${p}: its parts are files with dotted names, not folders`, parts.length >= 3 && parts.every((e) => e.isFile() && e.name.startsWith('__next.') && e.name.endsWith('.txt')), parts.map((e) => e.name).join());
    const part = parts.find((e) => e.name.includes('__PAGE__'));
    eq(`/${p}: the part the app asks for is there`, part ? (await get(`${base}/${p}/${encodeURIComponent(part.name)}`)).status : 0, 200);
  }
  const ref = await get(`${base}/data/px4-v1.16.0-parameters.json`);
  eq('PX4\'s reference: answers under the base path', ref.status === 200 && JSON.parse(ref.text).firmware, 'PX4 v1.16.0');
  // the app asks for it by an address it writes itself: that address must carry the base path
  const chunks = join(OUT, '_next', 'static', 'chunks');
  const all = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []));
  const code = all(chunks).map((f) => readFileSync(f, 'utf8')).join('\n');
  ok('the app asks for the reference under the base path', code.includes(`${base}/data/px4-v1.16.0-parameters.json`) || new RegExp(`"${base}"[^;]{0,80}/data/px4-v1\\.16\\.0-parameters\\.json`).test(code));
  const flight = await get(`${base}/data/practice-telemetry.json`);
  eq('the practice flight: answers under the base path', flight.status === 200 && JSON.parse(flight.text).schema, 'flight-companion/practice-telemetry@1');
  ok('the app asks for the practice flight under the base path', code.includes(`${base}/data/practice-telemetry.json`) || new RegExp(`"${base}"[^;]{0,80}/data/practice-telemetry\\.json`).test(code));
  eq('a page that is not there', (await get(`${base}/no-such-page`)).status, 404);
  eq('the top of the site goes to the app', (await get(`${base}/`)).status, 200);
  ok('nothing of the desktop app is in the hosted pages', !code.includes('assistant:ask') && !existsSync(join(OUT, 'files-server.mjs')));
  ok('no file of this computer is named in the pages', !/[A-Z]:\\\\Users\\\\|\/Users\/[a-z]+\/|OneDrive/.test(code));
} finally {
  server.close();
}

console.log(`\nhosted: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
