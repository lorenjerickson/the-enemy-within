"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { addRank, saveProfession, updateRank } from "@/lib/db";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function submitProfession(id: number | null, formData: FormData) {
  await requireGm();
  const saved = saveProfession(id, { name: text(formData, "name"), description: text(formData, "description") });
  redirect(`/campaign/professions/${saved}`);
}

export async function submitNewRank(professionId: number, parentId: number | null, formData: FormData) {
  await requireGm();
  addRank({ profession_id: professionId, parent_id: parentId, name: text(formData, "name"), description: text(formData, "description") });
  revalidatePath(`/campaign/professions/${professionId}`);
}

export async function submitRank(professionId: number, rankId: number, formData: FormData) {
  await requireGm();
  updateRank(rankId, text(formData, "name"), text(formData, "description"));
  revalidatePath(`/campaign/professions/${professionId}`);
}
