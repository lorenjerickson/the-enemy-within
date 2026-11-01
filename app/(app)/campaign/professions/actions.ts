"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { linkAdvancement, saveProfession, unlinkAdvancement } from "@/lib/db";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function submitProfession(id: number | null, formData: FormData) {
  await requireGm();
  const saved = saveProfession(id, { name: text(formData, "name"), description: text(formData, "description") });
  redirect(`/campaign/professions/${saved}`);
}

/** Links an existing profession, or creates a new one by name, as an advancement of fromId. */
export async function addAdvancement(fromId: number, formData: FormData) {
  await requireGm();
  const newName = text(formData, "new_name");
  const toId = newName ? saveProfession(null, { name: newName, description: "" }) : Number(formData.get("to_id"));
  if (toId) linkAdvancement(fromId, toId);
  revalidatePath(`/campaign/professions/${fromId}`);
}

export async function removeAdvancement(fromId: number, toId: number) {
  await requireGm();
  unlinkAdvancement(fromId, toId);
  revalidatePath(`/campaign/professions/${fromId}`);
}
