import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BUCKETS, flushTiming, pendingTiming, record, timed } from "@/lib/timing";
import { db } from "@/lib/db/connection";

test("timing: off unless TIMING=1; on, samples go into histograms per boundary and name, flushed as JSON lines", async () => {
  delete process.env.TIMING;
  record("server", "planStep", 3);
  assert.equal(pendingTiming().size, 0, "off: nothing kept");
  process.env.TIMING = "1";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "timing-")), was = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  try {
    record("server", "planStep", 3);
    record("server", "planStep", 40);
    assert.equal(timed("engine", "resolveRound", () => 7), 7);
    assert.equal(await timed("server", "readyUp", async () => "ok"), "ok");
    db.prepare("SELECT 1").get();
    const h = pendingTiming().get("server\tplanStep")!;
    assert.deepEqual([h.count, h.total, h.max], [2, 43, 40]);
    assert.equal(h.buckets[BUCKETS.indexOf(5)], 1, "3 ms in the ≤5 bucket");
    assert.equal(h.buckets[BUCKETS.indexOf(50)], 1);
    assert.ok(pendingTiming().has("db\tSELECT 1"), "database statements by their SQL");
    flushTiming();
    assert.equal(pendingTiming().size, 0);
    const [file] = fs.readdirSync(path.join(dir, "timing"));
    const lines = fs.readFileSync(path.join(dir, "timing", file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.boundary === "engine" && l.name === "resolveRound" && l.count === 1));
    assert.ok(lines.some((l) => l.boundary === "server" && l.name === "readyUp"));
  } finally {
    delete process.env.TIMING;
    if (was === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = was;
  }
});
