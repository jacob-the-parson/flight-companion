// Compare the TypeScript ULog reader against pyulog, field by field, on real logs.
// Usage: node scripts/verify-ulog.mjs <logs dir> <reference.json>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ULog } from "../lib/ulog/parser.ts";

const [dir, refPath] = process.argv.slice(2);
const ref = JSON.parse(readFileSync(refPath, "utf8"));
let checked = 0, failed = 0;
const fail = (msg) => { failed++; if (failed <= 30) console.log("  FAIL", msg); };
const close = (a, b) => {
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-9 * scale;
};

for (const file of readdirSync(dir).filter((f) => f.endsWith(".ulg")).sort()) {
  const t0 = performance.now();
  const u = new ULog(readFileSync(join(dir, file)));
  const ms = performance.now() - t0;
  const r = ref[file];
  if (!r) { console.log("no reference for", file); continue; }
  if (u.startTimestamp !== r.start) fail(`${file} start ${u.startTimestamp} != ${r.start}`);
  if (u.lastTimestamp !== r.last) fail(`${file} last ${u.lastTimestamp} != ${r.last}`);
  const refKeys = Object.keys(r.topics).sort();
  const ourKeys = u.topics.filter((t) => t.count > 0).map((t) => t.key).sort();
  if (JSON.stringify(refKeys) !== JSON.stringify(ourKeys)) {
    fail(`${file} topic list differs: only ref ${refKeys.filter((k) => !ourKeys.includes(k))} only ours ${ourKeys.filter((k) => !refKeys.includes(k))}`);
  }
  let fields = 0;
  for (const key of refKeys) {
    const topic = u.topicByKey(key);
    if (!topic) continue;
    const refFields = r.topics[key];
    const names = topic.fields.map((f) => f.name).sort();
    // pyulog keeps the padding bytes of nested messages as fields; this reader drops them.
    const refNames = Object.keys(refFields).filter((n) => !n.includes("_padding")).sort();
    if (JSON.stringify(names) !== JSON.stringify(refNames)) {
      fail(`${file} ${key} field names differ: ${refNames.filter((n) => !names.includes(n))} / ${names.filter((n) => !refNames.includes(n))}`);
      continue;
    }
    for (const name of names) {
      const col = u.column(key, name);
      // pyulog reads bool as a signed byte. Uninitialised flags (seen: 164) differ by 256.
      if (topic.fields.find((f) => f.name === name).type === "bool") {
        for (let i = 0; i < col.length; i++) if (col[i] > 127) col[i] -= 256;
      }
      const rf = refFields[name];
      fields++; checked++;
      if (col.length !== rf.n) { fail(`${file} ${key}.${name} n ${col.length} != ${rf.n}`); continue; }
      let sum = 0, nan = 0;
      for (const x of col) { if (Number.isFinite(x)) sum += x; else nan++; }
      if (nan !== rf.nan) fail(`${file} ${key}.${name} nan ${nan} != ${rf.nan}`);
      if (!close(sum, rf.sum)) fail(`${file} ${key}.${name} sum ${sum} != ${rf.sum}`);
      if (rf.first !== null && !close(col[0], rf.first)) fail(`${file} ${key}.${name} first ${col[0]} != ${rf.first}`);
      if (rf.last !== null && !close(col[col.length - 1], rf.last)) fail(`${file} ${key}.${name} last`);
    }
  }
  const pn = Object.keys(r.params);
  if (pn.length !== Object.keys(u.params).length) fail(`${file} param count ${Object.keys(u.params).length} != ${pn.length}`);
  for (const n of pn) if (!close(u.params[n], r.params[n])) fail(`${file} param ${n} ${u.params[n]} != ${r.params[n]}`);
  if (u.paramChanges.length !== r.changed) fail(`${file} changed params ${u.paramChanges.length} != ${r.changed}`);
  if (u.messages.length !== r.messages.length) fail(`${file} messages ${u.messages.length} != ${r.messages.length}`);
  r.messages.forEach((m, i) => {
    const o = u.messages[i];
    if (!o || o.timestamp !== m[0] || o.text !== m[2]) fail(`${file} message ${i}: ${JSON.stringify(o)} vs ${JSON.stringify(m)}`);
  });
  if (u.dropouts.length !== r.dropouts) fail(`${file} dropouts ${u.dropouts.length} != ${r.dropouts}`);
  for (const [k, val] of Object.entries(r.info)) {
    if (typeof val === "string" && typeof u.info[k] === "string" && u.info[k] !== val) fail(`${file} info ${k}: ${u.info[k]} != ${val}`);
    if (typeof val === "number" && u.info[k] !== val) fail(`${file} info ${k}: ${u.info[k]} != ${val}`);
  }
  console.log(`${file}: ${ourKeys.length} topics, ${fields} fields, ${Object.keys(u.params).length} params, ${u.messages.length} messages, indexed in ${ms.toFixed(0)} ms${u.truncated ? " (truncated)" : ""}`);
}
console.log(`\nchecked ${checked} fields, ${failed} failures`);
process.exit(failed ? 1 : 0);
