import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLastingArea, createUser, db, getCondition, getLastingArea, getOpenRollRequest, getGameTime, listAfflictions, placeCharacterToken, saveEffectDef } from "@/lib/db";
import { tokenHealth } from "@/lib/health";
import { walkRoute } from "@/app/(play)/play/walk";
import { catchInArea } from "@/app/(play)/play/areas";
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

test("out of combat: a 'stays in it' area's effects come off as they walk out; a 'leaves it' area catches them leaving, not coming in", () => {
  const lv = level();
  const slippery = getCondition(saveEffectDef(null, { name: "Slippery", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 5 }))!;
  addLastingArea(lv, { name: "Oil slick", look: "fog", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 2, h: 3 }), damage: null, dc: 40, save: "agility", half: true, ends: UNTIL_REMOVED, fires: ["inside"], conditions: [slippery], drawn: true });
  const tok = placeCharacterToken(lv, character("Finn", { health: "20" }), 0, 1);
  walkRoute(lv, tok, row(1, 0, 2));
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Slippery" && a.area != null), "in it: slippery");
  const w = walkRoute(lv, tok, row(1, 2, 5));
  assert.ok(!listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Slippery"), "out of it: not");
  assert.ok(w.told.some((t) => /Out of Oil slick, you're no longer slippery/.test(t)), w.told.join(" | "));
  const lv2 = level();
  addLastingArea(lv2, { name: "Thorns", look: "fog", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 2, h: 3 }), damage: "4", dc: 40, save: "agility", half: true, ends: UNTIL_REMOVED, fires: ["leave"], drawn: true });
  const t2 = placeCharacterToken(lv2, character("Gil", { health: "20" }), 0, 1);
  walkRoute(lv2, t2, row(1, 0, 2));
  assert.equal(tokenHealth(t2)!.current, 20, "coming in: nothing");
  walkRoute(lv2, t2, row(1, 2, 5));
  assert.equal(tokenHealth(t2)!.current, 16, "leaving: caught");
});

test("out of combat, lingering harm lands every 6 s walked: after walking out of the fire it keeps hurting, less each time, until it fades", () => {
  const lv = level();
  addLastingArea(lv, { name: "Burning hall", look: "fire", area: areaFromDrawn({ shape: "rect", x: 2, y: 0, w: 1, h: 3 }), damage: "4", damageType: "fire", dc: 40, save: "agility", half: true, ends: UNTIL_REMOVED, fires: ["inside"], lingers: true, drawn: true });
  const hal = character("Hal", { health: "20" });
  db.prepare("UPDATE characters SET movement = ? WHERE id = ?").run(JSON.stringify({ walking: { value: 5, dist: "ft", per: "s" } }), hal);
  const tok = placeCharacterToken(lv, hal, 0, 1);
  const w = walkRoute(lv, tok, row(1, 0, 12)); // 60 ft at 5 ft/s: two 6 s marks, both out of the fire
  assert.equal(tokenHealth(tok)!.current, 14, "4 walking through it, then 2 as it fades");
  assert.ok(w.told.some((t) => /Burning hall still hurts: .*\(-2\), and it fades/.test(t)), w.told.join(" | "));
});

test("a player's character rolls its own save against an area: asked as they walk in; it lands when the roll comes in", () => {
  createUser({ name: "areaP", username: "areaP", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("areaP")!.id;
  const lv = level();
  const id = addLastingArea(lv, wall({ dc: 15 }));
  const ivy = character("Ivy", { health: "20" });
  db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(pid, ivy);
  const tok = placeCharacterToken(lv, ivy, 1, 1);
  const w = walkRoute(lv, tok, row(1, 1, 5));
  assert.ok(w.told.some((t) => /You walk into Fire wall! Roll your agility save\./.test(t)), w.told.join(" | "));
  assert.equal(tokenHealth(tok)!.current, 20, "nothing yet");
  const req = getOpenRollRequest(pid)!;
  assert.deepEqual(req.action, { kind: "areaSave", levelId: lv, areaId: id, tokenId: tok });
  assert.match(catchInArea(lv, getLastingArea(id)!, tok, false, false, 16), /You walk into Fire wall! You partly get clear but are hurt/);
  assert.equal(tokenHealth(tok)!.current, 17, "saved (16 vs 15): half of 6");
});
