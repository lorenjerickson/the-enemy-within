import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { createUser } from "@/lib/db/users";
import { db } from "@/lib/db/connection";
import { getOpenRollRequest } from "@/lib/db/rolls";
import { addCreatureToken, placeCharacterToken } from "@/lib/db/tokens";
import { addTrap, getTrap, saveTrap } from "@/lib/db/traps";
import { listAfflictions, saveEffectDef } from "@/lib/db/effects";
import { tokenHealth } from "@/lib/health";
import { springTrap, trapsOnStep, trapsWhereStopped } from "@/app/(play)/play/traps";
import type { Trap } from "@/lib/traps";

const lv = level();
const pitArea = { shape: "rect" as const, x: 3, y: 0, w: 1, h: 1 };
const settings = (t: Partial<Omit<Trap, "id" | "area" | "found" | "sprung">> = {}): Omit<Trap, "id" | "area" | "found" | "sprung"> => ({
  name: "Spike pit", springs: ["enter"], who: "", often: "once", damage: "6", damage_type: "piercing", save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 1, find_dc: 14, ...t,
});
const trapWith = (t: Partial<Omit<Trap, "id" | "area" | "found" | "sprung">> = {}, area = pitArea) => { const id = addTrap(lv, area); saveTrap(id, settings(t)); return id; };

test("a trap with no save always lands: damage, its effects, found, spent; the player is told how bad, the GM the numbers", () => {
  const tok = placeCharacterToken(lv, character("Annis", { health: "20" }), 2, 0);
  const slowed = saveEffectDef(null, { name: "Hobbled", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 3 });
  const id = trapWith({ effects: [slowed] });
  const s = springTrap(lv, getTrap(id)!, tok);
  assert.equal(tokenHealth(tok)!.current, 14);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Hobbled"));
  assert.ok(getTrap(id)!.seen_by?.includes(tok), "known to whoever set it off");
  assert.deepEqual(getTrap(id)!.sprung, [tok]);
  assert.match(s.player, /You set off a trap \(Spike pit\)! You're hurt: moderate \(-6\), you're hobbled, you stop where you are\./);
  assert.match(s.gm, /Annis sets off Spike pit: 6 piercing damage; Hobbled/);
});

test("a save for half (or none); its effects hang off the damage: they land with half, not when the save stops it", () => {
  const strong = character("Bram", { health: "20", attributes: { agility: 30 } }); // always saves (d20 + 10)
  const tok = placeCharacterToken(lv, strong, 2, 2);
  const stuck = saveEffectDef(null, { name: "Stuck", description: "", modifiers: [{ kind: "forbid", what: "movement" }], rounds: 2, apply_save_attr: "agility", apply_save_dc: 40 });
  const half = springTrap(lv, getTrap(trapWith({ damage: "8", save_attr: "agility", save_dc: 5, effects: [stuck] }))!, tok);
  assert.equal(tokenHealth(tok)!.current, 16);
  assert.match(half.player, /partly get clear/);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Stuck"), "half the damage landed, so Stuck did (its own DC 40 save not rolled)");
  const other = placeCharacterToken(lv, character("Cato", { health: "20", attributes: { agility: 30 } }), 6, 6);
  const none = springTrap(lv, getTrap(trapWith({ damage: "8", save_attr: "agility", save_dc: 5, save_half: 0, effects: [stuck] }))!, other);
  assert.equal(tokenHealth(other)!.current, 20);
  assert.match(none.player, /You get clear/);
  assert.ok(!listAfflictions(lv).get(other)?.some((a) => a.condition.name === "Stuck"), "the save stopped the damage, so nothing hanging off it");
});

test("walking: stepping in springs it (once), passing beside doesn't; who it's for counts", () => {
  const l2 = level("Corridor");
  const id = addTrap(l2, pitArea);
  saveTrap(id, settings({ who: "party" }));
  const hero = placeCharacterToken(l2, character("Cass", { health: "20" }), 2, 0);
  const rat = addCreatureToken(l2, creature("Rat", { health: "5" }), 2, 1);
  assert.deepEqual(trapsOnStep(l2, rat, { x: 2, y: 1 }, { x: 3, y: 0 }), [], "only the party sets it off");
  assert.deepEqual(trapsOnStep(l2, hero, { x: 2, y: 1 }, { x: 3, y: 1 }), [], "beside it");
  const sprung = trapsOnStep(l2, hero, { x: 2, y: 0 }, { x: 3, y: 0 });
  assert.equal(sprung.length, 1);
  assert.equal(sprung[0].stops, true);
  assert.deepEqual(trapsOnStep(l2, hero, { x: 2, y: 0 }, { x: 3, y: 0 }), [], "spent");
});

test("a trap that springs when a move ends in it", () => {
  const l3 = level("Vault");
  const id = addTrap(l3, pitArea);
  saveTrap(id, settings({ springs: ["end"], often: "always", damage: "1" }));
  const tok = placeCharacterToken(l3, character("Dee", { health: "10" }), 3, 0);
  assert.equal(trapsOnStep(l3, tok, { x: 2, y: 0 }, { x: 3, y: 0 }).length, 0, "not on the way in");
  assert.equal(trapsWhereStopped(l3, tok, { x: 3, y: 0 }).length, 1);
  assert.equal(trapsWhereStopped(l3, tok, { x: 3, y: 0 }).length, 1, "every time");
  assert.equal(trapsWhereStopped(l3, tok, { x: 5, y: 0 }).length, 0);
  assert.equal(tokenHealth(tok)!.current, 8);
});

test("a trap going off is known only to characters who could see it (and those it caught)", async () => {
  const { addStructure, saveIllumination } = await import("@/lib/db/maps");
  const { witnessTrap } = await import("@/app/(play)/play/workOutRound");
  const room = level("Two rooms");
  saveIllumination(room, 1);
  const near = placeCharacterToken(room, character("Near", { health: "20" }), 1, 0);
  const behind = placeCharacterToken(room, character("Behind", { health: "20" }), 8, 0);
  addStructure(room, { kind: "wall", x1: 6, y1: -5, x2: 6, y2: 5, target_level_id: null } as never); // a wall between Behind and the trap
  const id = addTrap(room, { shape: "rect", x: 3, y: 0, w: 1, h: 1 });
  saveTrap(id, settings());
  witnessTrap(room, getTrap(id)!);
  const seen = getTrap(id)!.seen_by ?? [];
  assert.ok(seen.includes(near), "in sight");
  assert.ok(!seen.includes(behind), "behind a wall: still a secret to them");
});

test("each effect a trap puts on rolls its own save as it lands: resisted, partly resisted (half its rounds), or not", () => {
  const nimble = character("Dace", { health: "20", attributes: { agility: 30 } }); // always beats DC 5, never DC 40
  const tok = placeCharacterToken(lv, nimble, 4, 4);
  const make = (name: string, dc: number, outcome: "negates" | "halves") =>
    saveEffectDef(null, { name, description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 4, apply_save_attr: "agility", apply_save_dc: dc, apply_save_outcome: outcome });
  const s = springTrap(lv, getTrap(trapWith({ damage: "", effects: [make("Netted", 5, "negates"), make("Tangled", 5, "halves"), make("Pinned", 40, "negates")] }))!, tok);
  const on = listAfflictions(lv).get(tok) ?? [];
  assert.ok(!on.some((a) => a.condition.name === "Netted"), "resisted outright");
  assert.equal(on.find((a) => a.condition.name === "Tangled")?.left, 2, "half its rounds");
  assert.ok(on.some((a) => a.condition.name === "Pinned"), "failed to resist");
  assert.match(s.gm, /resists Netted \(agility \d+ vs DC 5\)/);
  assert.match(s.player, /shake off netted/i);
});

test("a player's character rolls its own throw for a trap out of combat: one prompt listing what it decides; it lands when the roll comes in", () => {
  createUser({ name: "trapP", username: "trapP", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("trapP")!.id;
  const fern = character("Fern", { health: "20" });
  db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(pid, fern);
  const tok = placeCharacterToken(lv, fern, 7, 7);
  const net = saveEffectDef(null, { name: "Netted", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 2, apply_save_attr: "agility", apply_save_dc: 12 });
  const venom = saveEffectDef(null, { name: "Venom", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 2, apply_save_attr: "fortitude", apply_save_dc: 30 });
  const id = trapWith({ damage: "", effects: [net, venom] });
  const asked = springTrap(lv, getTrap(id)!, tok);
  assert.match(asked.player, /Roll your agility save/);
  assert.equal(tokenHealth(tok)!.current, 20, "nothing yet");
  const req = getOpenRollRequest(pid)!;
  assert.deepEqual(req.action, { kind: "trapSave", levelId: lv, trapId: id, tokenId: tok });
  assert.match(req.spec.label, /Agility vs DC 12 keeps out Netted · Fortitude vs DC 30 keeps out Venom/);
  const done = springTrap(lv, getTrap(id)!, tok, 25); // their throw
  const on = listAfflictions(lv).get(tok) ?? [];
  assert.ok(!on.some((a) => a.condition.name === "Netted"), "25 vs 12");
  assert.ok(on.some((a) => a.condition.name === "Venom"), "the same throw falls short of 30");
  assert.match(done.player, /shake off netted/i);
});

test("effects landing from an item or improvisation out of combat: a player's character is asked for the one throw; a creature rolls now", async () => {
  const { landEffects } = await import("@/app/(play)/play/workOutRound");
  const { getCondition } = await import("@/lib/db/effects");
  createUser({ name: "useP", username: "useP", contact: "", role: "player" } as never, "pw");
  const pid = db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get("useP")!.id;
  const gil = character("Gil", { health: "20" });
  db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(pid, gil);
  const tok = placeCharacterToken(lv, gil, 9, 9);
  const dazed = getCondition(saveEffectDef(null, { name: "Dazed", description: "", modifiers: [{ kind: "speed", factor: 0.5 }], rounds: 2, apply_save_attr: "wisdom", apply_save_dc: 14 }))!;
  const asked = landEffects(lv, tok, "Smelling salts", [dazed]);
  assert.equal(asked.waiting, true);
  const req = getOpenRollRequest(pid)!;
  assert.deepEqual(req.action, { kind: "landSave", levelId: lv, tokenId: tok, source: "Smelling salts", effects: [dazed.id] });
  assert.match(req.spec.label, /Smelling salts: Wisdom vs DC 14 keeps out Dazed/);
  assert.ok(!listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Dazed"), "nothing until they roll");
  landEffects(lv, tok, "Smelling salts", [dazed], 5);
  assert.ok(listAfflictions(lv).get(tok)?.some((a) => a.condition.name === "Dazed"), "5 vs 14: it lands");
  const rat = addCreatureToken(lv, creature("Rat", { health: "5" }), 10, 10);
  assert.equal(landEffects(lv, rat, "Smelling salts", [dazed]).waiting, false, "the GM's creature rolls now");
});
