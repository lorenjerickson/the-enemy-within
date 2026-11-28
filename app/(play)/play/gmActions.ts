"use server";
import { agreeImprovisation, dropImprovisation, getImprovisation, goAheadImprovisation, setImprovisePlaced, type Agreed } from "@/lib/improvise";
import { checkScript } from "@/lib/script";
import { playImprovisation, startImprovisation } from "./improvising";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { setGmViewLevel, getGmLevelId } from "@/lib/db/maps";
import { getCharacter, getCreature } from "@/lib/db/catalog";
import { getCharacterPlayer, listTokens, tokenLabels, clearStandingOrdersOn, listHidden } from "@/lib/db/tokens";
import { logSessionEvent } from "@/lib/db/sessions";
import { requestRoll, openInitiativeRequest, settleInitiative, saveRollResult, closeRollRequest } from "@/lib/db/rolls";
import { saveEncounter, setEncounterWaiting, getEncounter, getEncounterWaiting } from "@/lib/db/encounters";
import { clearRoundPlans } from "@/lib/db/rounds";
import { removeLastingArea } from "@/lib/db/areas";
import { skillCheckFor } from "@/lib/creatureChanges";
import { tokenWho } from "@/lib/combat";
import type { Attributes } from "@/lib/attributes";
import { getPendingRound } from "@/lib/db/rounds";
import { listEffectDefs, getCondition, addAffliction, removeAffliction } from "@/lib/db/effects";
import { getTokenMover } from "@/lib/db/tokens";
import { asCondition, describeCondition } from "@/lib/conditions";
const listTokensById = (id: number) => { const t = getTokenMover(id); return t ? { id: t.token_id, level_id: t.level_id } : undefined; };
import { hidingPlaces, settleHide, reveal as revealToken } from "./hiding";
import { planEnd, timeline } from "@/lib/roundPlan";
import { applyConditionNow, rollConditionSaveFor, rollOffFor, startRollOff, workOutRound } from "./workOutRound";
import { parseHealthForm, saveTokenHealth, tokenHealth } from "@/lib/health";
import { initiativeRoll, rollSpec } from "@/lib/rolls";
import { sheetFor, type Sheet } from "@/lib/sheet";
import { ALLEGIANCES } from "@/lib/sides";
import { setTokenAllegiance } from "@/lib/db/tokens";
import { syncAurasOn } from "@/lib/auraSync";
import { addPlanStep, setReady, tokenPlanner, removePlanStep, type StepRequest } from "@/lib/roundPlanServer";
import { catalogCopy } from "@/lib/db/effects";
import { retune } from "@/lib/effectCopy";

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
  clearStandingOrdersOn(levelId); // following / pursuing / evading out of combat ends: rounds take over
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

/** Out of an encounter, the GM hides a token (one of theirs, say): the server rolls its Stealth; it fails if an enemy sees it. Or reveals it. */
export async function gmHide(tokenId: number, hide: boolean): Promise<{ told: string }> {
  await requireGm();
  const t = listTokensById(Number(tokenId));
  if (!t) return { told: "No such token" };
  if (!hide) { revealToken(t.level_id, t.id, "the GM revealed them"); revalidatePath("/play"); return { told: "Revealed." }; }
  if (getEncounter(t.level_id)) return { told: "In an encounter, plan Hide for the round instead" };
  const who = tokenWho(t.id);
  const total = rollSpec(skillCheckFor(t.id, "stealth", (who?.attributes ?? {}) as Attributes)).total;
  const r = settleHide(t.level_id, t.id, total);
  revalidatePath("/play");
  return { told: r.hidden ? `Hidden (Stealth ${total}).` : "An enemy can see them: they can't hide." };
}

/** The GM planning Hide for one of theirs: seen? and the blind spots in reach in the time left. */
export async function gmHidePlanOptions(tokenId: number): Promise<{ error?: string; seen?: boolean; spots?: { col: number; row: number }[] }> {
  await requireGm();
  const p = tokenPlanner(Number(tokenId));
  if (!p) return { error: "They can't plan now" };
  return hidingPlaces(p.tok.level_id, p.tok.token_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), timeline(p.plan, p.walking).left * p.walking);
}

/** Whether a token is hidden (Hide), with its Stealth total. */
export async function gmHiddenStealth(tokenId: number): Promise<number | null> {
  await requireGm();
  const t = listTokensById(Number(tokenId));
  return t ? listHidden(t.level_id).get(t.id) ?? null : null;
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

/** The GM turns an improvisation down (or it's been dealt with by hand). */
export async function gmDropImprovisation(id: number): Promise<void> {
  await requireGm();
  dropImprovisation(Number(id));
  revalidatePath("/play");
}

/** The GM settles an improvisation: how it plays out, what it costs, the roll; checked first (scripts must parse). */
export async function gmAgreeImprovisation(id: number, agreed: Agreed): Promise<{ error?: string }> {
  await requireGm();
  if (!getImprovisation(Number(id))) return { error: "It's gone" };
  for (const o of [agreed.success, agreed.failure]) {
    if (o?.kind === "script") { const e = checkScript(o.script); if (e) return { error: `Script: ${e}` }; }
    if (o?.kind === "effect" && !o.effect) return { error: "Pick the effect" };
    if (o?.kind === "map" && !o.outcomes.length) return { error: "Add what changes on the map" };
  }
  // An agreed effect is its own copy (backlog W): the catalog's now, with only what a copy may change taken from a tuned one.
  const copied = (o: Agreed["success"] | undefined) => {
    if (o?.kind !== "effect") return o;
    const base = catalogCopy(o.effect);
    return base ? { ...o, copy: o.copy ? retune(base, o.copy) : base } : o;
  };
  agreeImprovisation(Number(id), { ...agreed, success: copied(agreed.success)!, failure: copied(agreed.failure), seconds: Math.max(0, Math.min(6, Number(agreed.seconds) || 0)) });
  startImprovisation(Number(id)); // its roll asked for (or, out of combat with none, it plays out now)
  revalidatePath("/play");
  return {};
}

/** The GM moves an improvisation's template (adjusting where the player put it). */
export async function gmPlaceImprovise(id: number, x: number, y: number): Promise<void> {
  await requireGm();
  setImprovisePlaced(Number(id), { x: Number(x), y: Number(y) });
  revalidatePath("/play");
}

/** The GM places where a missed improvisation lands: it plays out there. */
export async function gmLandMiss(id: number, x: number, y: number): Promise<void> {
  await requireGm();
  const i = getImprovisation(Number(id));
  if (i?.status !== "missed") return;
  setImprovisePlaced(i.id, { x: Number(x), y: Number(y) });
  playImprovisation(getImprovisation(i.id)!);
  revalidatePath("/play");
}

/** The GM goes ahead with where the template was put: its roll is asked for (out of combat with no roll, it plays out now). */
export async function gmGoAheadImprovise(id: number): Promise<void> {
  await requireGm();
  goAheadImprovisation(Number(id));
  startImprovisation(Number(id));
  revalidatePath("/play");
}
