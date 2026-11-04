"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { listProfessionGraph, listPlayers, saveCharacter, setCharacterPlayer, setCharacterProfessions, setInParty } from "@/lib/db";
import { syncObjectiveJournals } from "@/lib/story";
import { parseCreatureForm } from "@/lib/creatureForm";

/** Creates the character from creatureId's template when id is null, otherwise updates it. */
export async function submitCharacter(id: number | null, creatureId: number | null, formData: FormData) {
  await requireGm();
  const chosen = new Set(formData.getAll("profession").map(Number));
  const graph = new Map(listProfessionGraph().map((p) => [p.id, p]));
  for (const pid of chosen) {
    const p = graph.get(pid);
    if (!p) throw new Error(`Unknown profession ${pid}`);
    if (p.prerequisites.length > 0 && !p.prerequisites.some((pre) => chosen.has(pre))) {
      throw new Error(`${p.name} needs one of its prerequisites`);
    }
  }
  const saved = saveCharacter(id, creatureId, await parseCreatureForm(formData));
  setCharacterProfessions(saved, [...chosen]);
  setInParty(saved, formData.get("in_party") === "on");
  const player = Number(formData.get("player_id")) || null;
  setCharacterPlayer(saved, player && listPlayers().some((p) => p.id === player) ? player : null);
  syncObjectiveJournals(); // a new party member learns the whole party's known objectives
  redirect("/campaign/characters");
}
