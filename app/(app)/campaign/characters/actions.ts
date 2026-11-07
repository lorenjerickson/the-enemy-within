"use server";

import { characterHealth, parseHealthForm, saveCharacterHealth } from "@/lib/health";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { addToContainer, deleteCharacter, listPlayers, takeFromStack, saveCharacter, setCharacterPlayer, setCharacterProfessions, setInParty } from "@/lib/db";
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
  saveCharacterHealth(id, parseHealthForm(form, h));
  revalidatePath(`/campaign/characters/${id}`);
  revalidatePath("/play");
}

/** Puts items from the catalogue into one of the character's containers (what doesn't fit is left out). */
export async function addContainerItem(characterId: number, containerId: number, form: FormData) {
  await requireGm();
  const qty = Math.max(1, Math.floor(Number(form.get("qty")) || 1));
  addToContainer(Number(characterId), Number(containerId), Number(form.get("item")), qty);
  revalidatePath(`/campaign/characters/${characterId}`);
}

/** Takes one off a stack in a container. */
export async function removeContainerStack(characterId: number, stackId: number) {
  await requireGm();
  takeFromStack(Number(stackId));
  revalidatePath(`/campaign/characters/${characterId}`);
}
