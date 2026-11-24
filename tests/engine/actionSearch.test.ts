import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesAction } from "../../app/(play)/play/actionSearch";

test("action search: every word typed appears in its name, description or source, case aside", () => {
  assert.equal(matchesAction("", "Attack"), true, "nothing typed: everything");
  assert.equal(matchesAction("att", "Attack", "Strike someone"), true);
  assert.equal(matchesAction("bind wound", "Bind a wound", "Bandage Roll, on Belt"), true);
  assert.equal(matchesAction("bandage", "Bind a wound", "Bandage Roll, on Belt"), true, "by where it comes from");
  assert.equal(matchesAction("fire", "Attack", "Strike someone"), false);
});
