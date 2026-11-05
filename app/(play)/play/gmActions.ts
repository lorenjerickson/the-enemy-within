"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  getCharacter, getCharacterPlayer, getCreature, getCurrentLevelId, listTokens, logSessionEvent, requestRoll, saveEncounter, setEncounterWaiting, clearRoundPlans,
} from "@/lib/db";
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
