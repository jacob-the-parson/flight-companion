// Puts right what `next build` with output: "export" gets wrong ON WINDOWS.
//
// For each page the export writes the parts of the page as files, which the
// app asks for as it moves between pages. The name is made from the part's path
// with every "/" turned into ".":
//
//     planner/__next.!KG1haW4p.planner.__PAGE__.txt
//
// On Windows the path arrives with "\" in it, the "/" is not found, and the file
// is written into folders instead:
//
//     planner/__next.!KG1haW4p/planner/__PAGE__.txt
//
// The page asks for the first and is told 404. Pages still load, since the app
// falls back to the whole page, but not as quickly.
//
// Where: next/dist/export/index.js, which joins the folder with
// convertSegmentPathToStaticExportFilename(segmentPath); that function, in
// next/dist/shared/lib/segment-cache/segment-value-encoding.js, replaces only
// "/". Seen in Next.js 16.3.7 on Windows 11. On macOS and Linux the export is
// right and this does nothing.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under a folder, as the list of names that lead to it. */
function filesUnder(dir, trail = []) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name), [...trail, e.name]) : [[...trail, e.name]],
  );
}

/** Returns how many files were moved. */
export function fixExport(out) {
  let moved = 0;
  const visit = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const at = join(dir, e.name);
      if (e.name.startsWith('__next.')) {
        // a folder where a file was meant: each file in it takes its dotted name, beside it
        for (const trail of filesUnder(at)) {
          const to = join(dir, [e.name, ...trail].join('.'));
          mkdirSync(dir, { recursive: true });
          if (existsSync(to)) rmSync(to);
          renameSync(join(at, ...trail), to);
          moved += 1;
        }
        rmSync(at, { recursive: true, force: true });
      } else if (e.name !== '_next') {
        visit(at);
      }
    }
  };
  if (existsSync(out) && statSync(out).isDirectory()) visit(out);
  return moved;
}

// run by hand: node scripts/fix-export.mjs <folder>
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/fix-export.mjs')) {
  const out = process.argv[2];
  if (!out) {
    console.error('Name the folder the pages were built into.');
    process.exit(2);
  }
  console.log(`  ${fixExport(out)} file(s) given the name the pages ask for`);
}
