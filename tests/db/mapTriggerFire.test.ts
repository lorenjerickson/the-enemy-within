import { test } from "node:test";
import { addLastingArea, getLastingArea } from "@/lib/db/areas";
import { UNTIL_REMOVED, areaFromDrawn } from "@/lib/aoe";
import type { Hazard } from "@/lib/hazards";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLight, listLights } from "@/lib/db/mapThings";
import { addMapTrigger, getMapTrigger, saveMapTrigger } from "@/lib/db/traps";
import { addSecret, getVars, listSecrets } from "@/lib/db/story";
import { addStructure, getDoor, listStructures, setDoorLocked } from "@/lib/db/maps";
import { placeCharacterToken } from "@/lib/db/tokens";
import { tokenHealth } from "@/lib/health";
import { fireTrigger, triggersOnStep, triggersWhereStopped } from "@/app/(play)/play/mapTriggers";
import type { TriggerOutcome } from "@/lib/triggers";
import { LIGHT_KINDS } from "@/lib/maps";

const lv = level();
const stones = (o: Partial<Hazard>): Omit<Hazard, "id"> => ({ name: "Falling stones", look: "fog", noLook: true, area: o.area!, ends: UNTIL_REMOVED, damage: "5", damageType: "bludgeoning", save: "agility", dc: 99, half: true, activation: "dormant", setOffBy: [], byTrigger: true, activeFor: "instant", often: "once", visibility: "hidden", findDc: 18, ...o });
const wire = { shape: "line" as const, x1: 3, y1: -2, x2: 3, y2: 3 };
const trigger = (outcomes: TriggerOutcome[], t: Partial<{ springs: ("enter" | "start" | "end")[]; who: "" | "party" | "hostile"; often: "once" | "each" | "always" }> = {}, area: typeof wire | { shape: "rect"; x: number; y: number; w: number; h: number } = wire) => {
  const id = addMapTrigger(lv, area);
  saveMapTrigger(id, { name: "Wire", springs: t.springs ?? ["enter"], who: t.who ?? "", often: t.often ?? "once", outcomes });
  return getMapTrigger(id)!;
};

test("a trigger opens a locked door, switches a light, reveals a secret and runs a script", () => {
  addStructure(lv, { kind: "door", x1: 8, y1: 0, x2: 8, y2: 1, target_level_id: null } as never);
  const door = listStructures(lv).find((s) => s.kind === "door")!.id;
  setDoorLocked(door, true);
  addLight(lv, { x: 2, y: 2, radius: 4, kind: LIGHT_KINDS[0], angle: 0, spread: 0, flicker: 0 });
  const light = listLights(lv)[0].id;
  addSecret(lv, { x: 5, y: 5, name: "Hidden lever", text: "", discovery_id: null });
  const secret = listSecrets(lv)[0].id;
  const f = fireTrigger(lv, trigger([{ kind: "door", door, to: "open" }, { kind: "light", light, on: false }, { kind: "secret", secret }, { kind: "script", script: "game.vars.alarm = true" }]), null);
  assert.equal(getDoor(door)!.open, 1);
  assert.equal(getDoor(door)!.locked, 0);
  assert.equal(listLights(lv).find((l) => l.id === light)!.enabled, 0);
  assert.equal(listSecrets(lv)[0].revealed, 1);
  assert.equal(getVars().alarm, true);
  assert.equal(f.stops, false);
});

test("crossing a tripwire fires it once, and it can stop them", () => {
  const tok = placeCharacterToken(lv, character("Annis", { health: "20" }), 2, 0);
  const t = trigger([{ kind: "stop" }]);
  assert.deepEqual(triggersOnStep(lv, tok, { x: 1, y: 0 }, { x: 2, y: 0 }).filter((f) => f.trigger.id === t.id), [], "not across the wire yet");
  const fired = triggersOnStep(lv, tok, { x: 2, y: 0 }, { x: 3, y: 0 }).filter((f) => f.trigger.id === t.id);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].stops, true);
  assert.deepEqual(getMapTrigger(t.id)!.sprung, [tok]);
  assert.equal(triggersOnStep(lv, tok, { x: 2, y: 0 }, { x: 3, y: 0 }).filter((f) => f.trigger.id === t.id).length, 0, "once");
});

test("a pressure plate sets off a dormant hazard elsewhere: it springs on whoever stands in it, and they're told", () => {
  const l2 = level("Hall");
  const victim = placeCharacterToken(l2, character("Bram", { health: "20" }), 10, 10);
  const walker = placeCharacterToken(l2, character("Cass", { health: "20" }), 0, 0);
  const hz = addLastingArea(l2, stones({ area: areaFromDrawn({ shape: "rect", x: 9, y: 9, w: 3, h: 3 }) }));
  const plate = addMapTrigger(l2, { shape: "rect", x: 1, y: 0, w: 1, h: 1 });
  saveMapTrigger(plate, { name: "Plate", springs: ["enter"], who: "", often: "once", outcomes: [{ kind: "area", area: hz, to: "set off" }] });
  const fired = triggersOnStep(l2, walker, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.equal(fired.length, 1);
  assert.equal(tokenHealth(victim)!.current, 15);
  assert.equal(tokenHealth(walker)!.current, 20);
  assert.match(fired[0].told.get(victim)![0], /Falling stones/);
  const h = getLastingArea(hz) as Hazard;
  assert.ok(h.seenBy?.includes(victim), "whoever it caught knows it's there");
  assert.ok(!h.found, "not found by everyone: only by those who saw it");
});

test("set off with no one in it, a once-only hazard still goes off and is spent", () => {
  const l3 = level("Empty");
  const hz = addLastingArea(l3, stones({ area: areaFromDrawn({ shape: "rect", x: 9, y: 9, w: 1, h: 1 }) }));
  fireTrigger(l3, { id: 0, name: "Lever", area: wire, springs: [], who: "", often: "always", outcomes: [{ kind: "area", area: hz, to: "set off" }], sprung: [] }, null);
  const h = getLastingArea(hz) as Hazard;
  assert.deepEqual(h.sprung, [0]);
  assert.equal(h.spent, true);
  assert.deepEqual(h.seenBy, [], "gone off with no one there to see: still a secret");
});

test("a trigger that fires when a move ends in it", () => {
  const l4 = level("Vault");
  const tok = placeCharacterToken(l4, character("Dee", { health: "10" }), 4, 4);
  const id = addMapTrigger(l4, { shape: "rect", x: 4, y: 4, w: 1, h: 1 });
  saveMapTrigger(id, { name: "Plate", springs: ["end"], who: "", often: "always", outcomes: [{ kind: "script", script: "game.vars.plate += 1" }] });
  assert.equal(triggersWhereStopped(l4, tok, { x: 4, y: 4 }).length, 1);
  assert.equal(triggersWhereStopped(l4, tok, { x: 6, y: 4 }).length, 0);
  assert.equal(getVars().plate, 1);
});

test("a pressure plate: hidden until found; setting it off finds it (they're told), and players see it from then on", async () => {
  const { triggerSeen } = await import("@/lib/triggers");
  const id = addMapTrigger(lv, { shape: "rect", x: 20, y: 0, w: 1, h: 1 });
  saveMapTrigger(id, { name: "Pressure plate", springs: ["enter"], who: "", often: "always", outcomes: [], visibility: "hidden", findDc: 16 });
  const t = getMapTrigger(id)!;
  assert.deepEqual([t.visibility, t.findDc, t.found, triggerSeen(t)], ["hidden", 16, false, false]);
  const tok = placeCharacterToken(lv, character("Pell"), 20, 0);
  assert.deepEqual(fireTrigger(lv, t, tok).told.get(tok), ["You set off Pressure plate."]);
  assert.equal(triggerSeen(getMapTrigger(id)!), true, "found");
  assert.equal(fireTrigger(lv, getMapTrigger(id)!, tok).told.get(tok), undefined, "found already: nothing more to tell");
  assert.equal(triggerSeen({ visibility: "gm", found: true }), false, "GM-only ones never");
});
