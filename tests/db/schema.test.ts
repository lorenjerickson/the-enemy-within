import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";

test("a brand-new database gets every table, with foreign keys intact", () => {
  const tables = db.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of ["users", "characters", "creatures", "items", "actions", "professions", "profession_groups", "map_tokens", "container_items", "roll_requests", "token_statuses", "lasting_areas"]) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
});
