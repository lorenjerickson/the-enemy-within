"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import {
  addProfessionModifier, deleteProfessionGroup, deleteRank, getProfession, moveRank, grantItem, listPrerequisites, listRanks, linkAdvancement, rankChain, removeProfessionModifier, revokeItem, saveProfession, saveProfessionGroup, unlinkAdvancement,
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
  if (name && !listRanks(groupId).some((r) => r.name.toLowerCase() === name.toLowerCase())) saveProfession(null, { name, description: "", group_id: groupId }); // not twice
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
  // A name the profession already has links that rank (no duplicates from adding it twice).
  const same = newName && from.group_id !== null ? listRanks(from.group_id).find((r) => r.name.toLowerCase() === newName.toLowerCase()) : undefined;
  const toId = same ? same.id : newName ? saveProfession(null, { name: newName, description: "", group_id: from.group_id }) : Number(formData.get("to_id"));
  const to = toId ? getProfession(toId) : undefined;
  if (to && to.group_id === from.group_id && !rankChain(fromId).includes(to.id)) linkAdvancement(fromId, to.id); // within its profession, and no loops
  revalidatePath(rankPage(fromId));
}

/** Unlinks a next rank that's also reached from another rank (an only route stays: move or remove the rank instead). */
export async function removeAdvancement(fromId: number, toId: number) {
  await requireGm();
  if (listPrerequisites(toId).length < 2) throw new Error("That's the only way to reach it: move or remove the rank on its own page");
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

/** Moves a rank: after another rank ("r:ID") or as a starting rank of a profession ("start:ID"). */
export async function moveRankTo(rankId: number, formData: FormData) {
  await requireGm();
  const rank = getProfession(rankId);
  if (!rank) throw new Error("Unknown rank");
  const [kind, raw] = String(formData.get("to") ?? "").split(":"), id = Number(raw);
  if (kind === "start") moveRank(rankId, null, id);
  else {
    const parent = getProfession(id);
    if (!parent?.group_id) throw new Error("Unknown rank");
    moveRank(rankId, parent.id, parent.group_id);
  }
  revalidatePath("/campaign/professions", "layout");
  redirect(rankPage(rankId));
}

/** Removes a rank, then goes to the rank before it (or its profession). */
export async function removeRank(rankId: number) {
  await requireGm();
  const rank = getProfession(rankId);
  if (!rank) throw new Error("Unknown rank");
  const chain = rankChain(rankId), parent = chain.length > 1 ? chain[chain.length - 2] : null;
  deleteRank(rankId);
  revalidatePath("/campaign/professions", "layout");
  redirect(parent !== null ? rankPage(parent) : `/campaign/professions/${rank.group_id}`);
}

/** Removes a profession with no ranks. */
export async function removeProfessionGroup(groupId: number) {
  await requireGm();
  deleteProfessionGroup(groupId);
  revalidatePath("/campaign/professions");
  redirect("/campaign/professions");
}
