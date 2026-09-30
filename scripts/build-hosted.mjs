// Builds the app as plain files for a hosted page, into out-hosted/.
//
//   node scripts/build-hosted.mjs [base path]
//
// The base path is where the pages will be served from, if not the top of the
// site. GitHub Pages serves a repository called flight-companion at
// /flight-companion, which is the default here. Give "" for the top of a site.
//
// What is hosted is the same app. Everything still happens in the visitor's
// browser: files they open are read there and are not uploaded. The chat is
// answered by the practice assistant, since a web page cannot start a program.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixExport } from './fix-export.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const base = process.argv[2] ?? '/flight-companion';
const out = join(ROOT, 'out-hosted');
rmSync(out, { recursive: true, force: true });

const next = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const r = spawnSync(process.execPath, [next, 'build', '--webpack'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, FC_EXPORT: '1', FC_OUT: 'out-hosted', FC_BASE_PATH: base },
});
if (r.status !== 0) process.exit(r.status ?? 1);
if (!existsSync(join(out, 'dashboard.html'))) {
  console.error('The pages were built, and out-hosted/dashboard.html is not there.');
  process.exit(1);
}
const moved = fixExport(out);
if (moved > 0) console.log(`  ${moved} file(s) given the name the pages ask for (scripts/fix-export.mjs says why)`);
// GitHub Pages leaves out folders that begin with an underscore, such as _next,
// unless this file is there
writeFileSync(join(out, '.nojekyll'), '');
console.log(`  out-hosted/   the pages, to be served under "${base || '/'}"`);
