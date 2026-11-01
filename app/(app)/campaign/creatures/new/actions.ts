"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { saveCreature } from "@/lib/db";
import { parseCreatureForm } from "@/lib/creatureForm";

/** Creates the creature when id is null, otherwise updates it. */
export async function submitCreature(id: number | null, formData: FormData) {
  await requireGm();
  saveCreature(id, await parseCreatureForm(formData));
  redirect("/campaign/creatures");
}
