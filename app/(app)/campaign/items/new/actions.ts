"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { createItem, ITEM_TYPES, RARITIES, type ItemType, type Rarity } from "@/lib/db";
import { generateImage, saveImage } from "@/lib/images";

export async function addItem(formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => Number(formData.get(k)) || 0;
  const type = text("type") as ItemType;
  if (!ITEM_TYPES.includes(type)) throw new Error("Invalid item type");
  const rarity = text("rarity") as Rarity;
  if (!RARITIES.includes(rarity)) throw new Error("Invalid rarity");
  const durability = Math.min(100, Math.max(1, Math.round(num("durability"))));

  // An uploaded file wins; otherwise use a previously generated image URL.
  const upload = formData.get("upload");
  const image =
    upload instanceof File && upload.size > 0
      ? saveImage(Buffer.from(await upload.arrayBuffer()), upload.type)
      : text("image") || null;

  createItem({
    name: text("name"),
    description: text("description"),
    image,
    type,
    weight: num("weight"),
    value: num("value"),
    rarity,
    durability,
  });
  redirect("/campaign/items");
}

export async function generateItemImage(
  name: string,
  description: string
): Promise<{ url?: string; error?: string }> {
  await requireGm();
  try {
    const url = await generateImage(
      `Illustration of a single item for a dark fantasy roleplaying game, centered on a plain background. Item: ${name}. ${description}`
    );
    return { url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
