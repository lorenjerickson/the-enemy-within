"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { addAsset, ownerOf, removeAction, saveAction, type ActionOwner, type ActionOwnerColumn, type AssetUsage } from "@/lib/db";
import { generateImage } from "@/lib/images";
import { DAMAGE_TYPES, DURATION_UNITS, ROLL_MODES, type Boost, type DamageType, type RollGrant, isRollKind, type DurationUnit, type RollMode } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";

export type ArtworkKind = "item" | "creature" | "texture" | "map";

/** Asset library usage that each kind of generated artwork is filed under. */
const USAGE: Record<ArtworkKind, AssetUsage> = { item: "item", creature: "creature", texture: "background", map: "map" };

const PROMPTS: Record<ArtworkKind, string> = {
  item: "Illustration of a single item for a dark fantasy roleplaying game, centered on a plain background.",
  creature: "Illustration of a creature for a dark fantasy roleplaying game, full body, dramatic lighting.",
  map: "Map artwork for a location in a dark fantasy roleplaying game, no text.",
  texture: "Seamless, tileable top-down texture for a tabletop battle map, evenly lit, no objects or borders.",
};

export async function generateArtwork(
  kind: ArtworkKind,
  name: string,
  description: string
): Promise<{ url?: string; error?: string }> {
  await requireGm();
  try {
    const url = await generateImage(`${PROMPTS[kind]} ${kind[0].toUpperCase() + kind.slice(1)}: ${name}. ${description}`);
    addAsset({ name: kind === "item" || kind === "creature" ? name : description.slice(0, 60), type: "image", usage: USAGE[kind], url });
    return { url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Page that shows an owner's actions, refreshed after changes. */
const OWNER_PAGES: Record<ActionOwnerColumn, string> = {
  profession_id: "/campaign/professions",
  item_id: "/campaign/items",
  creature_id: "/campaign/creatures",
};
const ownerPath = (owner: ActionOwner) => {
  const [column, id] = ownerOf(owner);
  return `${OWNER_PAGES[column]}/${id}`;
};

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
  const damage_type = text("damage_type") as DamageType | "";
  if (damage_type && !DAMAGE_TYPES.includes(damage_type)) throw new Error("Invalid damage type");

  const values = formData.getAll("boost_value").map((v) => String(v).toLowerCase().replace(/\s/g, ""));
  const boosts: Boost[] = formData.getAll("boost_target").flatMap((t, i): Boost[] => {
    const target = String(t);
    let value = values[i] ?? "";
    if (!target || !value) return []; // incomplete rows are dropped
    if (!isModifierTarget(target)) throw new Error("Invalid boost target");
    if (!isModifierFormula(value)) throw new Error("Invalid boost value");
    if (/^\d/.test(value)) value = `+${value}`;
    return [{ target, value }];
  });
  const modes = formData.getAll("grant_mode").map(String);
  const roll_grants: RollGrant[] = formData.getAll("grant_roll").flatMap((r, i): RollGrant[] => {
    const roll = String(r);
    const mode = modes[i];
    if (!roll || !mode) return [];
    if (!isRollKind(roll)) throw new Error("Invalid roll kind");
    if (mode !== "advantage" && mode !== "disadvantage") throw new Error("Invalid roll mode");
    return [{ roll, mode }];
  });
  const duration_unit = text("duration_unit") as DurationUnit;
  if (!DURATION_UNITS.includes(duration_unit)) throw new Error("Invalid duration unit");
  const duration_amount = Math.max(1, Math.round(Number(formData.get("duration_amount")) || 1));

  saveAction(actionId, owner, {
    name: text("name"),
    description: text("description"),
    roll,
    attack,
    damage,
    damage_type,
    radius: Math.max(0, Number(formData.get("radius")) || 0),
    split: formData.get("split") === "on" ? 1 : 0,
    boosts,
    roll_grants,
    duration_amount,
    duration_unit,
  });
  revalidatePath(ownerPath(owner));
}

export async function deleteAction(owner: ActionOwner, actionId: number) {
  await requireGm();
  removeAction(actionId);
  revalidatePath(ownerPath(owner));
}
