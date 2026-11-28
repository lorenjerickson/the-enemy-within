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

const fire = (o: Partial<Hazard> = {}): Omit<Hazard, "id"> => ({
  name: "Fire wall", look: "fire", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 2, h: 1 }), drawn: true, ends: UNTIL_REMOVED,
  damage: "5", damageType: "fire", save: "agility", dc: 99, half: false, fires: ["inside"], off: true, ...o,
});

test("scripts: game.locations.current.hazards switches one on (catching whoever is in it), reads who's inside, activates one", () => {
  const lv = level(), rat = addCreatureToken(lv, creature("Rat", { health: "20" }), 2, 0), hp = tokenHealth(rat)!.current;
  const id = addLastingArea(lv, fire());
  const here = "game.locations.current.hazards['fire wall']";
  const r = tryGameScript(`${here}.on = true\n${here}.inside.count`, lv);
  assert.equal(r.ok && r.value, "1", JSON.stringify(r));
  assert.equal(!!(getLastingArea(id) as Hazard).off, false);
  assert.equal(tokenHealth(rat)!.current, hp - 5, "caught as it came on");
  assert.equal(tryGameScript(`${here}.on = false`, lv).ok, true);
  assert.equal(!!(getLastingArea(id) as Hazard).off, true);
  const trap = addLastingArea(lv, fire({ name: "Dart trap", off: false, activation: "dormant", setOffBy: ["enter"], activeFor: "instant", often: "always", damage: "3", damageType: "piercing" }));
  assert.equal(tryGameScript("game.locations.current.hazards['dart trap'].activate()", lv).ok, true);
  assert.equal(tokenHealth(rat)!.current, hp - 8, "set off: the darts");
  assert.ok(getLastingArea(trap));
});
