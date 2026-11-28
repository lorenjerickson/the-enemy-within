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

test("Impassable (a chasm): moves go around it, as round a wall; not while it's off", async () => {
  const { moveBlockers } = await import("@/lib/db/areas");
  const { reachableSquares, squareKey } = await import("@/lib/movement");
  const lv = level();
  const chasm = addLastingArea(lv, { name: "Chasm", look: "fog", noLook: true, area: areaFromDrawn({ shape: "rect", x: 3, y: -1, w: 1, h: 3 }), drawn: true, ends: UNTIL_REMOVED, damage: null, dc: 99, save: "agility", half: false, fires: [], traits: ["impassable"] } as Omit<Hazard, "id">);
  const reach = (n = 4) => reachableSquares({ col: 1, row: 0 }, n, moveBlockers(lv));
  assert.equal(reach().has(squareKey(3, 0)), false, "not into it");
  assert.equal(reach().has(squareKey(5, 0)), false, "not straight across");
  assert.ok((reach(8).get(squareKey(5, 0))?.steps ?? 0) > 4, "round it: the long way");
  setLastingAreaOff(chasm, true);
  assert.equal(reach().get(squareKey(5, 0))?.steps, 4, "off: straight across");
  assert.equal(reach().has(squareKey(3, 0)), true);
});
