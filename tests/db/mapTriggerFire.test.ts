import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { addLight, addMapTrigger, addSecret, addStructure, addTrap, getDoor, getMapTrigger, getTrap, getVars, listLights, listSecrets, listStructures, placeCharacterToken, saveMapTrigger, saveTrap, setDoorLocked } from "@/lib/db";
import { tokenHealth } from "@/lib/health";
import { fireTrigger, triggersOnStep, triggersWhereStopped } from "@/app/(play)/play/mapTriggers";
import type { TriggerOutcome } from "@/lib/triggers";
import { LIGHT_KINDS } from "@/lib/maps";

const lv = level();
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

test("a pressure plate sets off a trap elsewhere: it springs on whoever stands in it, and they're told", () => {
  const l2 = level("Hall");
  const victim = placeCharacterToken(l2, character("Bram", { health: "20" }), 10, 10);
  const walker = placeCharacterToken(l2, character("Cass", { health: "20" }), 0, 0);
  const trapId = addTrap(l2, { shape: "rect", x: 9, y: 9, w: 3, h: 3 });
  saveTrap(trapId, { name: "Falling stones", springs: [], who: "", often: "once", damage: "5", damage_type: "bludgeoning", save_attr: "", save_dc: 12, save_half: 1, effects: [], stops: 0, find_dc: 18 });
  const plate = addMapTrigger(l2, { shape: "rect", x: 1, y: 0, w: 1, h: 1 });
  saveMapTrigger(plate, { name: "Plate", springs: ["enter"], who: "", often: "once", outcomes: [{ kind: "trap", trap: trapId }] });
  const fired = triggersOnStep(l2, walker, { x: 0, y: 0 }, { x: 1, y: 0 });
  assert.equal(fired.length, 1);
  assert.equal(tokenHealth(victim)!.current, 15);
  assert.equal(tokenHealth(walker)!.current, 20);
  assert.match(fired[0].told.get(victim)![0], /Falling stones/);
  assert.equal(getTrap(trapId)!.found, 1);
});

test("set off with no one in it, a once-only trap still goes off and is spent", () => {
  const l3 = level("Empty");
  const trapId = addTrap(l3, { shape: "rect", x: 9, y: 9, w: 1, h: 1 });
  fireTrigger(l3, { id: 0, name: "Lever", area: wire, springs: [], who: "", often: "always", outcomes: [{ kind: "trap", trap: trapId }], sprung: [] }, null);
  assert.deepEqual(getTrap(trapId)!.sprung, [0]);
  assert.equal(getTrap(trapId)!.found, 1);
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
