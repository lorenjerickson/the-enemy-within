import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLastingArea, getCondition, getGameTime, listAfflictions, placeCharacterToken, saveEffectDef } from "@/lib/db";
import { tokenHealth } from "@/lib/health";
import { walkRoute } from "@/app/(play)/play/walk";
import { UNTIL_REMOVED, areaFromDrawn, inArea, type LastingArea } from "@/lib/aoe";

const wall = (o: Partial<Omit<LastingArea, "id">> = {}): Omit<LastingArea, "id"> => ({
  name: "Fire wall", look: "fire", area: { shape: "line", origin: { x: 3.5, y: -2 }, dir: Math.PI / 2, size: 10 }, damage: "6", dc: 40, save: "agility", half: true, ends: getGameTime() + 10, ...o,
});
const row = (y: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ x: from + i, y }));

test("out of combat, walking into a lasting area (a fire wall left after a fight) burns: its save, damage, effects; told how bad", () => {
  const lv = level();
  const slowed = getCondition(saveEffectDef(null, { name: "Scorched", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 3 }))!;
  addLastingArea(lv, wall({ conditions: [slowed] }));
  const tok = placeCharacterToken(lv, character("Annis", { health: "20" }), 1, 1);
  const w = walkRoute(lv, tok, row(1, 1, 6));
  assert.equal(tokenHealth(tok)!.current, 14, "caught once crossing it (DC 40: no save)");
  assert.ok(w.told.some((t) => /You walk into Fire wall! You're hurt: moderate \(-6\), you're scorched/.test(t)), w.told.join(" | "));
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Scorched"));
});

test("a save for half; starting inside it or walking along inside it isn't coming into it; an expired one does nothing", () => {
  const lv = level();
  addLastingArea(lv, wall({ dc: 1 })); // always saved: half of 6
  const a = placeCharacterToken(lv, character("Bram", { health: "20" }), 1, 1);
  walkRoute(lv, a, row(1, 1, 5));
  assert.equal(tokenHealth(a)!.current, 17);
  const b = placeCharacterToken(lv, character("Cole", { health: "20" }), 3, 0);
  walkRoute(lv, b, [{ x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }]);
  assert.equal(tokenHealth(b)!.current, 20, "already in it");
  const lv2 = level();
  addLastingArea(lv2, wall({ ends: getGameTime() - 1 }));
  const c = placeCharacterToken(lv2, character("Dee", { health: "20" }), 1, 1);
  walkRoute(lv2, c, row(1, 1, 5));
  assert.equal(tokenHealth(c)!.current, 20, "burnt out");
});


test("areas the GM draws: a rectangle, circle or line drawn as on the Traps layer; a rectangle catches what's inside it", () => {
  const r = areaFromDrawn({ shape: "rect", x: 2, y: 1, w: 3, h: 2 });
  assert.equal(inArea(r, { x: 2.5, y: 1.5 }), true);
  assert.equal(inArea(r, { x: 4.9, y: 2.9 }), true);
  assert.equal(inArea(r, { x: 5.5, y: 1.5 }), false);
  assert.equal(inArea(areaFromDrawn({ shape: "circle", x: 0, y: 0, r: 2 }), { x: 1, y: 1 }), true);
  assert.equal(inArea(areaFromDrawn({ shape: "line", x1: 0, y1: 0.5, x2: 6, y2: 0.5 }), { x: 3.5, y: 0.5 }), true);
  const lv = level();
  addLastingArea(lv, { name: "Acid pool", look: "fog", area: r, damage: "4", dc: 40, save: "agility", half: true, ends: UNTIL_REMOVED, fires: ["enter"], drawn: true });
  const tok = placeCharacterToken(lv, character("Eve", { health: "20" }), 0, 1);
  walkRoute(lv, tok, row(1, 0, 3));
  assert.equal(tokenHealth(tok)!.current, 16);
});
