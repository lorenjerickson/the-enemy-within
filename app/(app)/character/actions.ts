"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCharacterPlayer, saveCharacter, setCharacterPlayer, setCharacterProfessions, setInParty } from "@/lib/db";
import { parseCreatureForm } from "@/lib/creatureForm";
import { getJournalEntry, saveJournalNotes, syncObjectiveJournals } from "@/lib/story";
import { chosenProfessions } from "../campaign/characters/formOptions";
import { findHuman } from "./human";

/** A player's own notes on a journal entry (the GM may edit them too). */
export async function saveNotes(entryId: number, notes: string) {
  const user = await requireUser();
  const entry = getJournalEntry(Number(entryId));
  if (!entry) throw new Error("Unknown journal entry");
  if (user.role !== "gm" && getCharacterPlayer(entry.character_id) !== user.id) throw new Error("Not your journal");
  saveJournalNotes(entry.id, String(notes).slice(0, 20000));
  revalidatePath(`/campaign/characters/${entry.character_id}`);
}

/** A player creates their own character, from the Human creature; it joins the party and they play it. */
export async function createPlayerCharacter(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "player") throw new Error("Only players create their own characters");
  const human = findHuman();
  if (!human) throw new Error("There's no Human creature to base a character on yet");
  const saved = saveCharacter(null, human.id, await parseCreatureForm(formData));
  setCharacterProfessions(saved, chosenProfessions(formData));
  setInParty(saved, true);
  setCharacterPlayer(saved, user.id);
  syncObjectiveJournals(); // the party's known objectives go into the new character's journal
  redirect("/lobby");
}
