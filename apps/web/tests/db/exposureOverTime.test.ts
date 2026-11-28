import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLastingArea, getExposures, saveExposures } from "@/lib/db/areas";
import { placeCharacterToken } from "@/lib/db/tokens";
import { tokenHealth } from "@/lib/health";
import { exposureOverTime } from "@/app/(play)/play/areas";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";

const burning = { kind: "fire", extra: 2, last: 6, buildUp: 1, decay: 2, source: "Burning oil" };

test("time passing out of combat: lingering harm lands again each 6 s, less each time, until it fades", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Ada"), 0, 0), hp = tokenHealth(tok)!.current;
  saveExposures(lv, new Map([[tok, [burning]]]));
  exposureOverTime(0.1); // one interval: 6 - 2 = 4
  assert.equal(tokenHealth(tok)!.current, hp - 4);
  exposureOverTime(10); // the rest: 2, then it's gone
  assert.equal(tokenHealth(tok)!.current, hp - 6);
  assert.equal(getExposures(lv).get(tok)?.length ?? 0, 0, "faded");
});

test("someone still standing in it isn't ticked by time passing", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Bo"), 2, 2), hp = tokenHealth(tok)!.current;
  addLastingArea(lv, { name: "Burning oil", look: "fire", area: areaFromDrawn({ shape: "circle", x: 2.5, y: 2.5, r: 2 }), drawn: true, damage: "1d6", damageType: "fire", dc: 99, save: "agility", half: false, fires: ["inside"], lingers: true, ends: UNTIL_REMOVED });
  saveExposures(lv, new Map([[tok, [burning]]]));
  exposureOverTime(1);
  assert.equal(tokenHealth(tok)!.current, hp);
});
