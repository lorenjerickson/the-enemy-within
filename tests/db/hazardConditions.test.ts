import { test } from "node:test";
import assert from "node:assert/strict";
import { creature, level } from "./seed";
import { addLastingArea, getLastingArea } from "@/lib/db/areas";
import { addCreatureToken } from "@/lib/db/tokens";
import { tokenHealth } from "@/lib/health";
import { tryGameScript } from "@/lib/game";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";
import type { Hazard } from "@/lib/hazards";
import "@/app/(play)/play/mapTriggers"; // how hazards play out (registered for scripts)

test("a hazard activates or deactivates as its script condition becomes true (not again while it stays true)", () => {
  const lv = level(), rat = addCreatureToken(lv, creature("Rat", { health: "20" }), 2, 0), hp = tokenHealth(rat)!.current;
  const id = addLastingArea(lv, {
    name: "Steam vent", look: "fog", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 1, h: 1 }), drawn: true, ends: UNTIL_REMOVED,
    damage: "4", damageType: "fire", save: "agility", dc: 99, half: false, fires: ["enter"], off: true, activatesWhen: "game.vars.valveOpen", deactivatesWhen: "game.vars.valveShut",
  } as Omit<Hazard, "id">);
  const off = () => !!(getLastingArea(id) as Hazard).off;
  tryGameScript("game.vars.other = 1"); // a change: checked, nothing holds
  assert.equal(off(), true);
  tryGameScript("game.vars.valveOpen = true");
  assert.equal(off(), false, "activated");
  assert.equal(tokenHealth(rat)!.current, hp - 4, "catching whoever is in it");
  tryGameScript("game.vars.valveShut = true");
  assert.equal(off(), true, "deactivated");
  tryGameScript("game.vars.other = 2"); // still true: it doesn't activate again
  assert.equal(off(), true);
  tryGameScript("game.vars.valveOpen = false\ngame.vars.valveShut = false");
  tryGameScript("game.vars.valveOpen = true");
  assert.equal(off(), false, "true again: activates again");
});
