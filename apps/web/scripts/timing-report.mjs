#!/usr/bin/env node
/**
 * Timing report (productization Phase 0; lib/timing.ts): merges the histograms in <DATA_DIR>/timing/*.jsonl and prints
 * count, p50, p95 and max per boundary and name, with browsers' action ids shown by the actions' names.
 *
 *   node scripts/timing-report.mjs                      every file
 *   node scripts/timing-report.mjs 2026-11-28 …         those days (or paths to .jsonl files)
 *   node scripts/timing-report.mjs --since 2026-11-28T19:00 --until 2026-11-28T23:00
 *   node scripts/timing-report.mjs --top 30             more names per boundary (default 15; db always by total time)
 *   node scripts/timing-report.mjs --json baseline.json saves the merged figures (the baseline)
 *   node scripts/timing-report.mjs --compare baseline.json   before / after, side by side
 */
import fs from "node:fs";
import path from "node:path";

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity]; // as lib/timing.ts
const BOUNDARIES = ["browser", "page", "server", "engine", "db"]; // outside in

const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const since = opt("--since"), until = opt("--until"), jsonOut = opt("--json"), compare = opt("--compare"), top = Number(opt("--top") ?? 15);
const dir = path.join(process.env.DATA_DIR ?? "data", "timing");
const files = args.length
  ? args.map((a) => (a.endsWith(".jsonl") ? a : path.join(dir, `${a}.jsonl`)))
  : fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(dir, f)) : [];
if (!files.length) { console.error(`No timing files (looked in ${dir}). Run the server with TIMING=1.`); process.exit(1); }

/** Merges the files' histograms: "boundary\tname" → { count, total, max, buckets }, plus action ids' names. */
function load(paths) {
  const merged = new Map(), names = new Map();
  let first = null, last = null;
  for (const f of paths) {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      if (r.names) { names.set(r.id, r.name); continue; }
      if ((since && r.to < new Date(since).toISOString()) || (until && r.from > new Date(until).toISOString())) continue;
      first = !first || r.from < first ? r.from : first;
      last = !last || r.to > last ? r.to : last;
      const key = `${r.boundary}\t${r.name}`, h = merged.get(key) ?? { count: 0, total: 0, max: 0, buckets: BUCKETS.map(() => 0) };
      h.count += r.count; h.total += r.total; h.max = Math.max(h.max, r.max);
      r.buckets.forEach((n, i) => (h.buckets[i] += n));
      merged.set(key, h);
    }
  }
  // Browsers' action ids by name ("action:planStep"), merging any ids that are the same action.
  const out = new Map();
  for (const [key, h] of merged) {
    const [b, n] = key.split("\t"), id = n.startsWith("action:") ? n.slice(7) : null;
    const k = `${b}\t${id && names.has(id) ? `action:${names.get(id)}` : n}`, was = out.get(k);
    out.set(k, was ? { count: was.count + h.count, total: was.total + h.total, max: Math.max(was.max, h.max), buckets: was.buckets.map((x, i) => x + h.buckets[i]) } : h);
  }
  return { rows: out, first, last };
}

/** The p-th percentile (0..1) from a histogram: within its bucket, linearly; the slowest bucket tops out at the max. */
function pct(h, p) {
  const want = p * h.count;
  let seen = 0;
  for (let i = 0; i < BUCKETS.length; i++) {
    const n = h.buckets[i];
    if (seen + n >= want && n > 0) {
      const lo = i ? BUCKETS[i - 1] : 0, hi = Math.min(BUCKETS[i], h.max);
      return lo + (hi - lo) * ((want - seen) / n);
    }
    seen += n;
  }
  return h.max;
}

const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v >= 10 ? `${v.toFixed(0)} ms` : `${v.toFixed(2)} ms`);
const summary = (h) => ({ count: h.count, total: h.total, p50: pct(h, 0.5), p95: pct(h, 0.95), max: h.max });
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);

const { rows, first, last } = load(files);
const figures = {};
for (const [key, h] of rows) {
  const [b, n] = key.split("\t");
  (figures[b] ??= {})[n] = summary(h);
}
// Each boundary as a whole too ("all"), merging its names.
for (const b of BOUNDARIES) {
  const hs = [...rows].filter(([k]) => k.startsWith(`${b}\t`)).map(([, h]) => h);
  if (hs.length) figures[b].all = summary(hs.reduce((a, h) => ({ count: a.count + h.count, total: a.total + h.total, max: Math.max(a.max, h.max), buckets: a.buckets.map((x, i) => x + h.buckets[i]) })));
}

const before = compare ? JSON.parse(fs.readFileSync(compare, "utf8")).figures : null;
console.log(`Timing ${first ?? "?"} → ${last ?? "?"} (${files.length} file${files.length === 1 ? "" : "s"})${compare ? `, compared with ${compare}` : ""}\n`);
for (const b of BOUNDARIES) {
  if (!figures[b]) continue;
  const names = Object.entries(figures[b]).filter(([n]) => n !== "all").sort((x, y) => y[1].total - x[1].total).slice(0, top);
  console.log(`${b.toUpperCase()}${b === "db" ? " (by total time)" : ""}`);
  const head = before ? `${pad("", 52)}${lpad("count", 8)}${lpad("p50", 11)}${lpad("was", 11)}${lpad("p95", 11)}${lpad("was", 11)}` : `${pad("", 52)}${lpad("count", 8)}${lpad("p50", 11)}${lpad("p95", 11)}${lpad("max", 11)}${lpad("total", 11)}`;
  console.log(head);
  for (const [n, f] of [["all", figures[b].all], ...names]) {
    const w = before?.[b]?.[n];
    console.log(before
      ? `${pad(n.slice(0, 50), 52)}${lpad(f.count, 8)}${lpad(ms(f.p50), 11)}${lpad(w ? ms(w.p50) : "-", 11)}${lpad(ms(f.p95), 11)}${lpad(w ? ms(w.p95) : "-", 11)}`
      : `${pad(n.slice(0, 50), 52)}${lpad(f.count, 8)}${lpad(ms(f.p50), 11)}${lpad(ms(f.p95), 11)}${lpad(ms(f.max), 11)}${lpad(ms(f.total), 11)}`);
  }
  console.log("");
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ from: first, to: last, files: files.map((f) => path.basename(f)), figures }, null, 2));
  console.log(`Saved to ${jsonOut}`);
}
