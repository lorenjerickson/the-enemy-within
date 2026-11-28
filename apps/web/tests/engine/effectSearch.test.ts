import { test } from "node:test";
import assert from "node:assert/strict";
import { effectMatches } from "@/lib/effectOptions";

const restrained = { id: 3, name: "Restrained", about: "can't move, disadvantage on their attack rolls", description: "Held fast: webs, nets, ropes." };

test("the effect search looks at the name, what it does and the description", () => {
  assert.ok(effectMatches(restrained, "restr"));
  assert.ok(effectMatches(restrained, "move"));
  assert.ok(effectMatches(restrained, "web"));
  assert.ok(!effectMatches(restrained, "immobil"));
  assert.ok(effectMatches(restrained, ""));
});
