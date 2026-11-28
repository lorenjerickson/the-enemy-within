import { test } from "node:test";
import assert from "node:assert/strict";
import { clearTokenTargets, getTokenTarget, setTokenTarget } from "@/lib/db/tokens";
import { db } from "@/lib/db/connection";

test("targets are let go after a round, and can be cleared one at a time", () => {
  db.exec("INSERT INTO locations (id, name) VALUES (900, 'Here')");
  const lv = Number(db.prepare("INSERT INTO map_levels (location_id, name) VALUES (900, 'Ground')").run().lastInsertRowid);
  const tok = (col: number) => Number(db.prepare("INSERT INTO map_tokens (level_id, col, row) VALUES (?, ?, 0)").run(lv, col).lastInsertRowid);
  const a = tok(0), b = tok(1);
  setTokenTarget(a, b);
  assert.equal(getTokenTarget(a), b);
  setTokenTarget(a, null);
  assert.equal(getTokenTarget(a), null);
  setTokenTarget(a, b);
  setTokenTarget(b, a);
  clearTokenTargets(lv);
  assert.equal(getTokenTarget(a), null);
  assert.equal(getTokenTarget(b), null);
});
