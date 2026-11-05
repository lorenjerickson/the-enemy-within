"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  getCharacter, getCharacterPlayer, getCreature, getCurrentLevelId, listTokens, logSessionEvent, requestRoll, saveEncounter, setEncounterWaiting, clearRoundPlans,
  getEncounter, getEncounterWaiting, getRoundPlan, getTokenMover, isGridlessLevel, listStructures, moveToken, setLastRoundLog, tokenLabels, setReplay,
} from "@/lib/db";
import { resolveMovement, type Mover } from "@/lib/resolveRound";
import { fightersOn, saveHp } from "@/lib/combat";
import { blockingSegments } from "@/lib/visibility";
import { initiativeRoll, rollSpec } from "@/lib/rolls";
import { addPlanStep, setReady, tokenPlanner, undoPlanStep, type StepRequest } from "@/lib/roundPlanServer";

/**
 * Starts an encounter on the party's map: every player character there is asked to roll initiative, and the GM's
 * creatures roll theirs straight away. Movement turns restricted while it runs.
 */
export async function rollInitiative() {
  await requireGm();
  const levelId = getCurrentLevelId();
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
  const levelId = getCurrentLevelId();
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

export async function gmUndoStep(tokenId: number) {
  await requireGm();
  const p = tokenPlanner(Number(tokenId));
  if (p) undoPlanStep(p);
  revalidatePath("/play");
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
  const levelId = getCurrentLevelId();
  const enc = levelId === undefined ? undefined : getEncounter(levelId);
  if (levelId === undefined || !enc) return;
  const tokens = listTokens(levelId);
  const initiative = new Map(enc.order.map((o) => [o.token_id, o.initiative]));
  const labels = tokenLabels(levelId);
  const taking = new Set([...enc.order.map((o) => o.token_id), ...getEncounterWaiting(levelId)]);
  const movers: Mover[] = tokens
    .filter((t) => taking.has(t.id))
    .map((t) => ({
      tokenId: t.id,
      name: labels.get(t.id) ?? t.name,
      initiative: initiative.get(t.id) ?? -1000, // hasn't rolled: loses every tie
      start: { col: t.col, row: t.row },
      plan: getRoundPlan(levelId, t.id).plan,
      walking: JSON.parse(getTokenMover(t.id)?.movement ?? "{}").walking ?? 0,
    }));
  const bystanders = tokens.filter((t) => !taking.has(t.id)).map((t) => ({ tokenId: t.id, name: labels.get(t.id) ?? t.name, at: { col: t.col, row: t.row } }));
  const fighters = fightersOn(levelId);
  const { final, hp, log, frames } = resolveMovement(movers, bystanders, blockingSegments(listStructures(levelId)), isGridlessLevel(levelId), fighters);
  for (const [id, h] of hp) saveHp(id, h); // also keeps health rolled for the first time
  for (const m of movers) {
    const end = final.get(m.tokenId)!;
    if (end.col !== m.start.col || end.row !== m.start.row) moveToken(m.tokenId, end.col, end.row);
  }
  const lines = log.length ? log : ["Nothing happened."];
  logSessionEvent(`Round ${enc.round}: ${lines.join(" ")}`);
  saveEncounter(levelId, { ...enc, round: enc.round + 1 });
  setLastRoundLog(levelId, [`Round ${enc.round}`, ...lines]);
  clearRoundPlans(levelId);
  // Everyone plays the round back together, a second at a time, starting once their screens have caught up.
  setReplay(levelId, { round: enc.round, starts: Date.now() + REPLAY_DELAY_MS, start: Object.fromEntries(movers.map((m) => [m.tokenId, m.start])), frames });
  revalidatePath("/play");
}

/** How long after resolving the playback starts (players' screens refresh every 3 s). */
const REPLAY_DELAY_MS = 3500;
