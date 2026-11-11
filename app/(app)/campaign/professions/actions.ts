"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  addProfessionModifier, getProfession, grantItem, linkAdvancement, rankChain, removeProfessionModifier, revokeItem, saveProfession, saveProfessionGroup, unlinkAdvancement,
} from "@/lib/db";
import { isModifierFormula } from "@/lib/itemTypes";
import { isModifierTarget } from "@/lib/modifiers";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const rankPage = (id: number) => `/campaign/professions/ranks/${id}`;

/** A profession (Law Enforcement): its name and description; a new one gets its starting rank, if named. */
export async function submitProfessionGroup(id: number | null, formData: FormData) {
  await requireGm();
  const saved = saveProfessionGroup(id, { name: text(formData, "name"), description: text(formData, "description") });
  const first = text(formData, "first_rank");
  if (id === null && first) saveProfession(null, { name: first, description: "", group_id: saved });
  redirect(`/campaign/professions/${saved}`);
}

/** A new starting rank for a profession (one no other rank advances to). */
export async function addStartingRank(groupId: number, formData: FormData) {
  await requireGm();
  const name = text(formData, "name");
  if (name) saveProfession(null, { name, description: "", group_id: groupId });
  revalidatePath(`/campaign/professions/${groupId}`);
}

/** A rank's name and description. */
export async function submitRank(id: number, formData: FormData) {
  await requireGm();
  const rank = getProfession(id);
  if (!rank) throw new Error("Unknown rank");
  saveProfession(id, { name: text(formData, "name"), description: text(formData, "description"), group_id: rank.group_id });
  redirect(rankPage(id));
}

/** Links another rank of the same profession, or creates a new one by name, as a next rank after fromId. */
export async function addAdvancement(fromId: number, formData: FormData) {
  await requireGm();
  const from = getProfession(fromId);
  if (!from) throw new Error("Unknown rank");
  const newName = text(formData, "new_name");
  const toId = newName ? saveProfession(null, { name: newName, description: "", group_id: from.group_id }) : Number(formData.get("to_id"));
  const to = toId ? getProfession(toId) : undefined;
  if (to && to.group_id === from.group_id && !rankChain(fromId).includes(to.id)) linkAdvancement(fromId, to.id); // within its profession, and no loops
  revalidatePath(rankPage(fromId));
}

export async function removeAdvancement(fromId: number, toId: number) {
  await requireGm();
  unlinkAdvancement(fromId, toId);
  revalidatePath(rankPage(fromId));
}

export async function addModifier(professionId: number, formData: FormData) {
  await requireGm();
  const target = text(formData, "target");
  let value = text(formData, "value").toLowerCase().replace(/\s/g, "");
  if (!isModifierTarget(target)) throw new Error("Invalid modifier target");
  if (!isModifierFormula(value)) throw new Error("Invalid modifier value");
  if (/^\d/.test(value)) value = `+${value}`; // store increments with an explicit sign
  addProfessionModifier({ profession_id: professionId, target, value });
  revalidatePath(rankPage(professionId));
}

export async function deleteModifier(professionId: number, modifierId: number) {
  await requireGm();
  removeProfessionModifier(modifierId);
  revalidatePath(rankPage(professionId));
}

export async function addGrantedItem(professionId: number, formData: FormData) {
  await requireGm();
  const itemId = Number(formData.get("item_id"));
  if (itemId) grantItem(professionId, itemId);
  revalidatePath(rankPage(professionId));
}

export async function removeGrantedItem(professionId: number, itemId: number) {
  await requireGm();
  revokeItem(professionId, itemId);
  revalidatePath(rankPage(professionId));
}
