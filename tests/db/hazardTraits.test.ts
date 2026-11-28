import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLastingArea, setLastingAreaOff } from "@/lib/db/areas";
import { moveToken, placeCharacterToken } from "@/lib/db/tokens";
import { speedFps } from "@/lib/creatureChanges";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";
import type { Hazard } from "@/lib/hazards";

test("Frozen (ice): walking speed is halved while standing on it (moving costs double), not elsewhere or once it's off", () => {
  const lv = level(), tok = placeCharacterToken(lv, character("Ivy"), 0, 0), walk = { walking: 30 };
  const pond = addLastingArea(lv, { name: "Frozen pond", look: "snow", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 3, h: 3 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility", half: false, fires: [], traits: ["frozen"] } as Omit<Hazard, "id">);
  assert.equal(speedFps(tok, walk), 5);
  moveToken(tok, 3, 1);
  assert.equal(speedFps(tok, walk), 2.5, "on the ice");
  setLastingAreaOff(pond, true);
  assert.equal(speedFps(tok, walk), 5, "switched off");
});
