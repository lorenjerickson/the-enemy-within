"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  getCharacter, getCharacterPlayer, getCreature, getCurrentLevelId, listTokens, logSessionEvent, requestRoll, saveEncounter, setEncounterWaiting,
} from "@/lib/db";
import { initiativeRoll, rollSpec } from "@/lib/rolls";

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
  setEncounterWaiting(levelId, waiting);
  logSessionEvent("The GM called for initiative.");
  revalidatePath("/play");
}

export async function endEncounter() {
  await requireGm();
  const levelId = getCurrentLevelId();
  if (levelId === undefined) return;
  saveEncounter(levelId, null);
  logSessionEvent("The encounter ended.");
  revalidatePath("/play");
}
