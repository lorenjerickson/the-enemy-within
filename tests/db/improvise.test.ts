import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { placeCharacterToken } from "@/lib/db";
import { askImprovise, dropImprovisation, listOpenImprovisations, openImprovisation } from "@/lib/improvise";

test("asking to improvise: one open ask per token (a new one replaces it), listed for the GM, dropped when taken back", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Mira"), 0, 0);
  askImprovise(lv, tok, "tip the oil barrel");
  askImprovise(lv, tok, "  tip the oil barrel toward the door ");
  assert.equal(openImprovisation(tok)?.intent, "tip the oil barrel toward the door");
  assert.deepEqual(listOpenImprovisations(lv).map((i) => i.intent), ["tip the oil barrel toward the door"]);
  dropImprovisation(openImprovisation(tok)!.id);
  assert.equal(openImprovisation(tok), undefined);
});
