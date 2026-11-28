/**
 * Timing at the application's boundaries (productization, Phase 0): a performance baseline now, measured the same way
 * after the refactor, so the two compare like for like. Off unless TIMING=1.
 *
 * Each sample goes into a histogram per boundary and name (log-scale buckets, in milliseconds), and every 30 s the
 * histograms are written as JSON lines to <DATA_DIR>/timing/<date>.jsonl and cleared. A whole play session costs
 * a few lines a minute; scripts/timing-report.mjs turns the files into counts and p50 / p95 / max per boundary.
 *
 * Boundaries:
 * - db: one database statement (by its SQL, shortened)
 * - server: a server action, from call to return
 * - page: a page render on the server
 * - browser: from the click in the browser to the result arriving back (the full round trip)
 * - engine: the game's own work inside a request (resolving a round)
 */
import fs from "node:fs";
import path from "node:path";

export type Boundary = "db" | "server" | "page" | "browser" | "engine";

/** Bucket upper bounds (ms); the last catches everything slower. */
export const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];

export const timingOn = () => process.env.TIMING === "1";

type Histogram = { count: number; total: number; max: number; buckets: number[] };
let open = new Map<string, Histogram>(); // "boundary\tname" → its samples since the last flush
let since = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

/** One sample: `ms` spent at `boundary` doing `name`. */
export function record(boundary: Boundary, name: string, ms: number): void {
  if (!timingOn() || !Number.isFinite(ms)) return;
  const key = `${boundary}\t${name}`;
  const h = open.get(key) ?? { count: 0, total: 0, max: 0, buckets: BUCKETS.map(() => 0) };
  h.count++;
  h.total += ms;
  h.max = Math.max(h.max, ms);
  h.buckets[BUCKETS.findIndex((b) => ms <= b)]++;
  open.set(key, h);
  timer ??= setInterval(flushTiming, 30_000);
  timer.unref?.();
}

/** Times `f` at `boundary` as `name` (sync or async). */
export function timed<T>(boundary: Boundary, name: string, f: () => T): T {
  if (!timingOn()) return f();
  const t0 = performance.now();
  const done = () => record(boundary, name, performance.now() - t0);
  let out: T;
  try {
    out = f();
  } catch (e) {
    done();
    throw e;
  }
  if (out instanceof Promise) return out.finally(done) as T;
  done();
  return out;
}

/** Writes the histograms gathered since the last flush (one JSON line each) and starts afresh. */
export function flushTiming(): void {
  if (!open.size) return;
  const dir = path.join(process.env.DATA_DIR ?? "data", "timing"), to = new Date();
  const lines = [...open].map(([key, h]) => {
    const [boundary, name] = key.split("\t");
    return JSON.stringify({ from: new Date(since).toISOString(), to: to.toISOString(), boundary, name, ...h });
  });
  open = new Map();
  since = to.getTime();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${to.toISOString().slice(0, 10)}.jsonl`), lines.join("\n") + "\n");
}

/** What's been gathered and not yet written (tests). */
export const pendingTiming = () => new Map(open);
