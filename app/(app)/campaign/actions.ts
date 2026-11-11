"use server";

import { AREA_SHAPES, areaFires, type AreaShape } from "@/lib/aoe";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";

import { revalidatePath } from "next/cache";
import { requireGm, requireUser } from "@/lib/auth";
import { addAsset, ownerOf, removeAction, saveAction, type ActionOwner, type ActionOwnerColumn, type AssetUsage, ACTION_TARGETS, type ActionTargets } from "@/lib/db";
import { generateImage } from "@/lib/images";
import { DAMAGE_TYPES, DURATION_UNITS, ROLL_MODES, type Boost, type DamageType, type RollGrant, isRollKind, type DurationUnit, type RollMode } from "@/lib/actions";
import { isModifierTarget } from "@/lib/modifiers";
import { isDiceFormula, isModifierFormula } from "@/lib/itemTypes";

export type ArtworkKind = "item" | "creature" | "texture" | "map" | "tile" | "overhead token" | "side token";

/** Asset library usage that each kind of generated artwork is filed under. */
const USAGE: Record<ArtworkKind, AssetUsage> = {
  item: "item", creature: "creature", texture: "background", map: "map", tile: "tile", "overhead token": "token", "side token": "token",
};

const PROMPTS: Record<ArtworkKind, string> = {
  item: "Illustration of a single item for a dark fantasy roleplaying game, centered on a plain background.",
  creature: "Illustration of a creature for a dark fantasy roleplaying game, full body, dramatic lighting.",
  map: "Map artwork for a location in a dark fantasy roleplaying game, no text.",
  tile: "Single square top-down map tile for a tabletop battle map, fills the whole frame, no border, no text.",
  texture: "Seamless, tileable top-down texture for a tabletop battle map, evenly lit, no objects or borders.",
  "overhead token":
    "Round token for a tabletop battle map: one creature seen directly from above, centred and filling a circle, transparent background, no text.",
  "side token":
    "Side-on full-body figure of one creature for a side-view game map, standing, facing right, feet at the bottom edge, transparent background, no text.",
};

export async function generateArtwork(
  kind: ArtworkKind,
  name: string,
  description: string
): Promise<{ url?: string; error?: string }> {
  // Players may make art for the character they're creating; everything else is the GM's.
  const user = await requireUser();
  if (user.role !== "gm" && !["creature", "overhead token", "side token"].includes(kind)) throw new Error("Not allowed");
  try {
    const url = await generateImage(`${PROMPTS[kind]} ${kind[0].toUpperCase() + kind.slice(1)}: ${name}. ${description}`, {
      token: kind.endsWith("token"),
    });
    const assetName = kind === "texture" || kind === "map" ? description.slice(0, 60) : kind.endsWith("token") ? `${name} (${kind})` : name;
    addAsset({ name: assetName, type: "image", usage: USAGE[kind], url });
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

  // Boosts and roll effects for whoever uses the action, and (fields prefixed "target_") for who it's used on.
  const boosts = [...parseBoosts(formData, "", "self"), ...parseBoosts(formData, "target_", "target")];
  const roll_grants = [...parseGrants(formData, "", "self"), ...parseGrants(formData, "target_", "target")];
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
    seconds: Math.min(6, Math.max(0.5, Number(formData.get("seconds")) || 2)),
    range_ft: Math.max(0, Number(formData.get("range_ft")) || 0), // 0: an item's action uses the item's range (else within reach)
    target_who: (["", "friendly", "enemy"] as const).find((w) => w === formData.get("target_who")) ?? "",
    target_count: (["one", "exactly", "upto", "all"] as const).find((c) => c === formData.get("target_count")) ?? "one",
    target_n: Math.max(1, Math.round(Number(formData.get("target_n")) || 1)),
    kind: formData.get("kind") === "reaction" ? "reaction" : "action",
    targets: (ACTION_TARGETS as readonly string[]).includes(String(formData.get("targets"))) ? (String(formData.get("targets")) as ActionTargets) : "",
    ...areaFields(formData),
    boosts,
    roll_grants,
    duration_amount,
    duration_unit,
    conditions: (["self", "target"] as const).flatMap((on) => formData.getAll(`condition_${on}`).map((v) => ({ id: Number(v), on })).filter((c) => Number.isInteger(c.id) && c.id > 0)),
  });
  revalidatePath(ownerPath(owner));
}

export async function deleteAction(owner: ActionOwner, actionId: number) {
  await requireGm();
  removeAction(actionId);
  revalidatePath(ownerPath(owner));
}

/** An action's area (shape, size, save) from its form; no shape = a single-target action. */
function areaFields(formData: FormData) {
  const shape = String(formData.get("area_shape") ?? "");
  const attr = String(formData.get("save_attr") ?? "agility");
  return {
    area_shape: (AREA_SHAPES as readonly string[]).includes(shape) ? (shape as AreaShape) : ("" as const),
    area_ft: Math.max(0, Number(formData.get("area_ft")) || 0),
    save_dc: Math.max(1, Math.round(Number(formData.get("save_dc")) || 12)),
    save_attr: (ATTRIBUTES as readonly string[]).includes(attr) ? (attr as Attribute) : ("agility" as const),
    save_half: (formData.get("save_half") === "on" ? 1 : 0) as 0 | 1,
    area_lasts: (formData.get("area_lasts") === "on" ? 1 : 0) as 0 | 1,
    area_fires: areaFires(formData.getAll("area_fires").map(String).join(",")).join(","),
  };
}

function parseBoosts(formData: FormData, prefix: string, on: "self" | "target"): Boost[] {
  const values = formData.getAll(`${prefix}boost_value`).map((v) => String(v).toLowerCase().replace(/\s/g, ""));
  return formData.getAll(`${prefix}boost_target`).flatMap((t, i): Boost[] => {
    const target = String(t);
    let value = values[i] ?? "";
    if (!target || !value) return []; // incomplete rows are dropped
    if (!isModifierTarget(target)) throw new Error("Invalid boost target");
    if (!isModifierFormula(value)) throw new Error("Invalid boost value");
    if (/^\d/.test(value)) value = `+${value}`;
    return [{ target, value, on }];
  });
}

function parseGrants(formData: FormData, prefix: string, on: "self" | "target"): RollGrant[] {
  const modes = formData.getAll(`${prefix}grant_mode`).map(String);
  return formData.getAll(`${prefix}grant_roll`).flatMap((r, i): RollGrant[] => {
    const roll = String(r);
    const mode = modes[i];
    if (!roll || !mode) return [];
    if (!isRollKind(roll)) throw new Error("Invalid roll kind");
    if (mode !== "advantage" && mode !== "disadvantage") throw new Error("Invalid roll mode");
    return [{ roll, mode, on }];
  });
}
