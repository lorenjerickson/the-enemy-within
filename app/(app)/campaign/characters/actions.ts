"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { saveCharacter } from "@/lib/db";
import { parseCreatureForm } from "@/lib/creatureForm";

/** Creates the character from creatureId's template when id is null, otherwise updates it. */
export async function submitCharacter(id: number | null, creatureId: number | null, formData: FormData) {
  await requireGm();
  saveCharacter(id, creatureId, await parseCreatureForm(formData));
  redirect("/campaign/characters");
}
