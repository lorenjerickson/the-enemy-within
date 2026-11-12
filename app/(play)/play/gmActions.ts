"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  setGmViewLevel, getCharacter, getCharacterPlayer, getCreature, getGmLevelId, listTokens, logSessionEvent, requestRoll, saveEncounter, setEncounterWaiting, clearRoundPlans,
  getEncounter, openInitiativeRequest, settleInitiative, saveRollResult, closeRollRequest, getEncounterWaiting, tokenLabels, removeLastingArea } from "@/lib/db";
import { getPendingRound, listEffectDefs, getCondition, addAffliction, removeAffliction, getTokenMover } from "@/lib/db";
import { asCondition, describeCondition } from "@/lib/conditions";
const listTokensById = (id: number) => { const t = getTokenMover(id); return t ? { id: t.token_id, level_id: t.level_id } : undefined; };
import { applyConditionNow, rollConditionSaveFor, rollOffFor, startRollOff, workOutRound } from "./workOutRound";
import { parseHealthForm, saveTokenHealth, tokenHealth } from "@/lib/health";
import { initiativeRoll, rollSpec } from "@/lib/rolls";
import { sheetFor, type Sheet } from "@/lib/sheet";
import { ALLEGIANCES } from "@/lib/sides";
import { setTokenAllegiance } from "@/lib/db";
import { syncAurasOn } from "@/lib/auraSync";
import { addPlanStep, setReady, tokenPlanner, removePlanStep, type StepRequest } from "@/lib/roundPlanServer";

/**
 * Starts an encounter on the party's map: every player character there is asked to roll initiative, and the GM's
 * creatures roll theirs straight away. Movement turns restricted while it runs.
 */
export async function rollInitiative() {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined) return;
  const order: { token_id: number; initiative: number }[] = [];
  const waiting: number[] = [];
  for (const t of listTokens(levelId)) {
    const player = t.character_id ? getCharacterPlayer(t.character_id) : null;
    if (t.character_id && player) {
      requestRoll(player, t.character_id, initiativeRoll(getCharacter(t.character_id)!.attributes), { kind: "initiative", levelId, tokenId: t.id });
      waiting.push(t.id);
    } else {
      const who = t.character_id ? getCharacter(t.character_id) : t.creature_id ? getCreature(t.creature_id) : undefined;
      if (who) order.push({ token_id: t.id, initiative: rollSpec(initiativeRoll(who.attributes)).total });
    }
  }
  order.sort((a, b) => b.initiative - a.initiative);
  saveEncounter(levelId, { round: 1, turn: 0, order });
  clearRoundPlans(levelId);
  setEncounterWaiting(levelId, waiting);
  logSessionEvent("The GM called for initiative.");
  revalidatePath("/play");
}

export async function endEncounter() {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined) return;
  saveEncounter(levelId, null);
  clearRoundPlans(levelId);
  logSessionEvent("The encounter ended.");
  revalidatePath("/play");
}

/** The GM plans a creature's round (same rules as players). */
export async function gmPlanStep(tokenId: number, step: StepRequest): Promise<{ error?: string }> {
  await requireGm();
  const p = tokenPlanner(Number(tokenId));
  if (!p) return { error: "Not in an encounter" };
  const error = addPlanStep(p, step);
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Takes a step out of a creature's plan (the ones after it move up). */
export async function gmRemoveStep(tokenId: number, index: number): Promise<{ error?: string }> {
  await requireGm();
  const p = tokenPlanner(Number(tokenId));
  const error = p ? removePlanStep(p, Number(index)) : "Nothing planned";
  revalidatePath("/play");
  return error ? { error } : {};
}

export async function gmSetReady(tokenId: number, ready: boolean) {
  await requireGm();
  const p = tokenPlanner(Number(tokenId));
  if (p) setReady(p, ready);
  revalidatePath("/play");
}

/**
 * Resolves the round: everyone's plan (ready or not) runs second by second (movement for now, initiative breaking
 * ties), tokens end where it leaves them, and the next round begins with empty plans.
 */
export async function resolveRound() {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined || !getEncounter(levelId) || getPendingRound(levelId)) return;
  workOutRound(levelId, Math.floor(Math.random() * 2 ** 32), {});
  revalidatePath("/play");
}

/** The GM settles a contested move (`winner` gets the spot): the round is worked out again with that call. */
export async function decideContest(winner: number) {
  await requireGm();
  const levelId = getGmLevelId();
  const pending = levelId === undefined ? null : getPendingRound(levelId);
  if (levelId === undefined || !pending?.contest) return;
  const { a, b, key } = pending.contest;
  if (winner !== a.id && winner !== b.id) return;
  workOutRound(levelId, pending.seed, { ...pending.decisions, [key]: winner });
  revalidatePath("/play");
}

/** The GM leaves a contested move to chance: a roll-off, d20 each. A player's character's player rolls their own
 * (the round waits for them); the GM's creatures roll at once. Ties roll again. */
export async function rollOffContest() {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined || !getPendingRound(levelId)) return;
  startRollOff(levelId);
  revalidatePath("/play");
}

/** The GM rolls a waiting condition save for its player (they're away, or slow). */
export async function gmRollConditionSave() {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined) return;
  rollConditionSaveFor(levelId);
  revalidatePath("/play");
}

/** The GM rolls a player's roll-off for them (they're away, or slow). */
export async function gmRollOffFor(tokenId: number) {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined) return;
  rollOffFor(levelId, Number(tokenId), true);
  revalidatePath("/play");
}


/** The GM loads a location's level on their map (null = back to the party's). */
export async function loadLevel(levelId: number | null) {
  await requireGm();
  setGmViewLevel(levelId === null ? null : Number(levelId));
  revalidatePath("/play");
}

/** The GM sets a token's health, or restores it (a character token's is the character's). */
export async function setHealth(tokenId: number, form: FormData) {
  await requireGm();
  const h = tokenHealth(tokenId);
  if (!h) return;
  saveTokenHealth(tokenId, parseHealthForm(form, h));
  revalidatePath("/play");
}

/** The GM clears a lasting area (a fire wall) before it runs out. */
export async function removeLasting(id: number) {
  await requireGm();
  removeLastingArea(Number(id));
  revalidatePath("/play");
}

/**
 * The GM rolls initiative for a player's character still waiting on it (they're away, or slow): rolled here, into the
 * turn order, and their prompt closes. No token: everyone still rolling.
 */
export async function gmRollInitiativeFor(tokenId: number | null) {
  await requireGm();
  const levelId = getGmLevelId();
  if (levelId === undefined) return;
  const labels = tokenLabels(levelId);
  for (const id of tokenId === null ? getEncounterWaiting(levelId) : [Number(tokenId)]) {
    const t = listTokens(levelId).find((x) => x.id === id);
    const who = t?.character_id ? getCharacter(t.character_id) : undefined;
    if (!t || !who) continue;
    const req = openInitiativeRequest(id);
    const rolled = rollSpec(req?.spec ?? initiativeRoll(who.attributes));
    settleInitiative(levelId, id, rolled.total);
    if (req) {
      saveRollResult(req.id, { ...rolled, outcome: `Initiative ${rolled.total} (rolled by the GM).`, success: true });
      closeRollRequest(req.id, req.player_id);
    }
    logSessionEvent(`The GM rolled ${rolled.total} for ${labels.get(id) ?? who.name}'s initiative.`);
  }
  revalidatePath("/play");
}

/** A token's character sheet, for the GM (who may look at anyone's). */
export async function gmSheet(tokenId: number): Promise<Sheet | null> {
  await requireGm();
  return sheetFor(Number(tokenId));
}

/** The GM sets whose side a token is on (party, hostile, neutral), for actions aimed at friendlies or enemies. */
export async function gmSetAllegiance(tokenId: number, allegiance: string) {
  await requireGm();
  setTokenAllegiance(Number(tokenId), (ALLEGIANCES as string[]).includes(allegiance) ? allegiance : null);
  const t = listTokensById(Number(tokenId));
  if (t) syncAurasOn(t.level_id); // allies and enemies changed
  revalidatePath("/play");
}

/** The catalog effects that last a number of rounds, for putting one on a token by hand. */
export async function gmConditionCatalog(): Promise<{ id: number; name: string; text: string }[]> {
  await requireGm();
  return listEffectDefs().filter((e) => e.duration === "rounds").map((e) => ({ id: e.id, name: e.name, text: describeCondition(asCondition(e)) }));
}

/** The GM puts a catalog effect on a token (again: by its rule for being put on again). */
export async function gmApplyCondition(tokenId: number, conditionId: number) {
  await requireGm();
  const t = listTokensById(Number(tokenId)), c = getCondition(Number(conditionId));
  if (!t || !c) return;
  const happened = applyConditionNow(t.level_id, t.id, c); // instant parts now (healing, temporary health), the rest stays
  logSessionEvent(`The GM puts ${c.name} on ${tokenLabels(t.level_id).get(t.id) ?? "someone"}${happened.length ? `: ${happened.join(", ")}` : ""}.`);
  syncAurasOn(t.level_id); // it may carry an aura
  revalidatePath("/play");
}

/** The GM takes a condition off. */
export async function gmRemoveAffliction(id: number) {
  await requireGm();
  const levelId = removeAffliction(Number(id));
  if (levelId !== undefined) syncAurasOn(levelId); // it may have carried an aura
  revalidatePath("/play");
}
