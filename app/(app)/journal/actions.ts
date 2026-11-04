"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getCharacterPlayer } from "@/lib/db";
import { getJournalEntry, saveJournalNotes } from "@/lib/story";

/** A player's own notes on a journal entry (the GM may edit them too). */
export async function saveNotes(entryId: number, notes: string) {
  const user = await requireUser();
  const entry = getJournalEntry(Number(entryId));
  if (!entry) throw new Error("Unknown journal entry");
  if (user.role !== "gm" && getCharacterPlayer(entry.character_id) !== user.id) throw new Error("Not your journal");
  saveJournalNotes(entry.id, String(notes).slice(0, 20000));
  revalidatePath("/journal");
}
