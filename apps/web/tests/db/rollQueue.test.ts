import { test } from "node:test";
import assert from "node:assert/strict";
import { character } from "./seed";
import { createUser } from "@/lib/db/users";
import { db } from "@/lib/db/connection";
import { closeRollRequest, getOpenRollRequest, requestRoll, rollsWaiting, saveRollResult } from "@/lib/db/rolls";
import type { RollSpec } from "@/lib/rolls";

const spec = (label: string) => ({ label, parts: [{ formula: "1d20", source: "d20" }], mode: "normal", dc: 10 }) as unknown as RollSpec;

test("roll prompts queue: the first asked first, one rolled stays until closed; asking the same again replaces it", () => {
  createUser({ name: "Q", username: "rollq", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("rollq")!.id, ch = character("Quill");
  requestRoll(pid, ch, spec("Search"), { kind: "search", dc: 12 });
  requestRoll(pid, ch, spec("Agility save"), { kind: "search", dc: 15 });
  requestRoll(pid, ch, spec("Search again"), { kind: "search", dc: 12 }); // the same as the first: replaces it (now last)
  assert.equal(getOpenRollRequest(pid)?.spec.label, "Agility save");
  assert.equal(rollsWaiting(pid), 1);
  const first = getOpenRollRequest(pid)!;
  saveRollResult(first.id, { total: 14, parts: [], outcome: "ok", success: true } as never);
  requestRoll(pid, ch, spec("Fortitude save"), { kind: "search", dc: 9 });
  assert.equal(getOpenRollRequest(pid)?.id, first.id, "rolled, not closed: still shown");
  closeRollRequest(first.id, pid);
  assert.equal(getOpenRollRequest(pid)?.spec.label, "Search again");
  assert.equal(rollsWaiting(pid), 1);
});
