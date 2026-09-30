// Builds what the desktop app is made of:
//   out/                        the app's pages, as files (next build, exported)
//   desktop/dist/main.cjs       the main process
//   desktop/dist/preload.cjs    what the page is given
//   desktop/dist/files-server.mjs   the MCP files server, as one file
//   desktop/dist/observer-server.mjs  the MCP observer, as one file
//
//   node desktop/build.mjs            all of it
//   node desktop/build.mjs --no-pages the three scripts only
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { fixExport } from '../scripts/fix-export.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'desktop', 'dist');
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const common = { bundle: true, platform: 'node', target: 'node22', logLevel: 'warning', legalComments: 'none' };

await build({ ...common, entryPoints: [join(ROOT, 'desktop', 'main.ts')], outfile: join(DIST, 'main.cjs'), format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: [join(ROOT, 'desktop', 'preload.ts')], outfile: join(DIST, 'preload.cjs'), format: 'cjs', external: ['electron'] });
// the server and everything it needs, so that the installed app carries one file and no node_modules
await build({
  ...common,
  entryPoints: [join(ROOT, 'mcp', 'files', 'server.mjs')],
  outfile: join(DIST, 'files-server.mjs'),
  format: 'esm',
  // packages written for require() ask for it by name
  banner: { js: "import { createRequire as __fcRequire } from 'node:module'; const require = __fcRequire(import.meta.url);" },
});
await build({
  ...common,
  entryPoints: [join(ROOT, 'mcp', 'observer', 'server.mjs')],
  outfile: join(DIST, 'observer-server.mjs'),
  format: 'esm',
  banner: { js: "import { createRequire as __fcRequire } from 'node:module'; const require = __fcRequire(import.meta.url);" },
});
for (const f of ['main.cjs', 'preload.cjs', 'files-server.mjs', 'observer-server.mjs']) {
  console.log(`  ${f.padEnd(20)} ${Math.round(statSync(join(DIST, f)).size / 1024)} KB`);
}

if (!process.argv.includes('--no-pages')) {
  const next = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const r = spawnSync(process.execPath, [next, 'build', '--webpack'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, FC_EXPORT: '1' } });
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (!existsSync(join(ROOT, 'out', 'dashboard.html'))) {
    console.error('The pages were built, and out/dashboard.html is not there.');
    process.exit(1);
  }
  const moved = fixExport(join(ROOT, 'out'));
  if (moved > 0) console.log(`  ${moved} file(s) given the name the pages ask for (scripts/fix-export.mjs says why)`);
  console.log('  out/                 the pages');
}
