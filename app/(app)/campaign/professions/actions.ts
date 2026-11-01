"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  addProfessionModifier, grantItem, linkAdvancement, removeProfessionModifier, revokeItem, saveProfession, unlinkAdvancement,
} from "@/lib/db";
import { isModifierFormula } from "@/lib/itemTypes";
import { isModifierTarget } from "@/lib/modifiers";

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

export async function addModifier(professionId: number, formData: FormData) {
  await requireGm();
  const target = text(formData, "target");
  let value = text(formData, "value").toLowerCase().replace(/\s/g, "");
  if (!isModifierTarget(target)) throw new Error("Invalid modifier target");
  if (!isModifierFormula(value)) throw new Error("Invalid modifier value");
  if (/^\d/.test(value)) value = `+${value}`; // store increments with an explicit sign
  addProfessionModifier({ profession_id: professionId, target, value });
  revalidatePath(`/campaign/professions/${professionId}`);
}

export async function deleteModifier(professionId: number, modifierId: number) {
  await requireGm();
  removeProfessionModifier(modifierId);
  revalidatePath(`/campaign/professions/${professionId}`);
}

export async function addGrantedItem(professionId: number, formData: FormData) {
  await requireGm();
  const itemId = Number(formData.get("item_id"));
  if (itemId) grantItem(professionId, itemId);
  revalidatePath(`/campaign/professions/${professionId}`);
}

export async function removeGrantedItem(professionId: number, itemId: number) {
  await requireGm();
  revokeItem(professionId, itemId);
  revalidatePath(`/campaign/professions/${professionId}`);
}
