"use server";

import { characterHealth, saveCharacterHealth } from "@/lib/health";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { deleteCharacter, listPlayers, saveCharacter, setCharacterPlayer, setCharacterProfessions, setInParty } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { syncObjectiveJournals } from "@/lib/story";
import { parseCreatureForm } from "@/lib/creatureForm";
import { chosenProfessions } from "./formOptions";

/** Creates the character from creatureId's template when id is null, otherwise updates it. */
export async function submitCharacter(id: number | null, creatureId: number | null, formData: FormData) {
  await requireGm();
  const chosen = chosenProfessions(formData);
  const saved = saveCharacter(id, creatureId, await parseCreatureForm(formData));
  setCharacterProfessions(saved, chosen);
  setInParty(saved, formData.get("in_party") === "on");
  const player = Number(formData.get("player_id")) || null;
  setCharacterPlayer(saved, player && listPlayers().some((p) => p.id === player) ? player : null);
  syncObjectiveJournals(); // a new party member learns the whole party's known objectives
  redirect("/campaign/characters");
}

/** Deletes a character (after the GM confirms on its page) and goes back to the list. */
export async function removeCharacter(id: number) {
  await requireGm();
  deleteCharacter(Number(id));
  revalidatePath("/campaign/characters");
  redirect("/campaign/characters");
}

/** The GM sets a character's current / maximum / temporary health, or (restore) puts current back to maximum. */
export async function setCharacterHealth(id: number, form: FormData) {
  await requireGm();
  const h = characterHealth(id);
  if (!h) return;
  const n = (k: string, d: number) => (form.get(k) !== null && form.get(k) !== "" && Number.isFinite(Number(form.get(k))) ? Number(form.get(k)) : d);
  const next = { current: n("current", h.current), maximum: Math.max(0, n("maximum", h.maximum)), temporary: Math.max(0, n("temporary", h.temporary)) };
  if (form.get("restore")) next.current = next.maximum;
  saveCharacterHealth(id, next);
  revalidatePath(`/campaign/characters/${id}`);
  revalidatePath("/play");
}
