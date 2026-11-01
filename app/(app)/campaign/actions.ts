"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { removeAction, saveAction, type ActionOwner } from "@/lib/db";
import { generateImage } from "@/lib/images";
import { ROLL_MODES, type RollMode } from "@/lib/actions";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";

export type ArtworkKind = "item" | "creature";

const PROMPTS: Record<ArtworkKind, string> = {
  item: "Illustration of a single item for a dark fantasy roleplaying game, centered on a plain background.",
  creature: "Illustration of a creature for a dark fantasy roleplaying game, full body, dramatic lighting.",
};

export async function generateArtwork(
  kind: ArtworkKind,
  name: string,
  description: string
): Promise<{ url?: string; error?: string }> {
  await requireGm();
  try {
    return { url: await generateImage(`${PROMPTS[kind]} ${kind[0].toUpperCase() + kind.slice(1)}: ${name}. ${description}`) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Page that shows an owner's actions, refreshed after changes. */
const ownerPath = (owner: ActionOwner) =>
  "item_id" in owner ? `/campaign/items/${owner.item_id}` : `/campaign/professions/${owner.profession_id}`;

/** Creates the action when actionId is null, otherwise updates it. */
export async function submitAction(owner: ActionOwner, actionId: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const compact = (k: string) => text(k).toLowerCase().replace(/\s/g, "");
  const roll = text("roll") as RollMode;
  if (!ROLL_MODES.includes(roll)) throw new Error("Invalid roll mode");
  const attack = compact("attack") || null;
  if (attack && !isModifierFormula(attack)) throw new Error("Invalid to-hit modifier");
  const damage = compact("damage") || null;
  if (damage && !isDiceFormula(damage)) throw new Error("Invalid damage dice");

  saveAction(actionId, owner, {
    name: text("name"),
    description: text("description"),
    roll,
    attack,
    damage,
    damage_type: text("damage_type").toLowerCase(),
    radius: Math.max(0, Number(formData.get("radius")) || 0),
    split: formData.get("split") === "on" ? 1 : 0,
  });
  revalidatePath(ownerPath(owner));
}

export async function deleteAction(owner: ActionOwner, actionId: number) {
  await requireGm();
  removeAction(actionId);
  revalidatePath(ownerPath(owner));
}
