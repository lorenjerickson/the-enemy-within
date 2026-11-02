"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { addLevel, listLevels, listLocations, removeLevel, saveBackground, saveLocation, saveGrid, saveMapImage, saveTemplateColors, setLayerVisible } from "@/lib/db";
import { imageFromForm } from "@/lib/images";
import { EDGES, MAP_LAYERS, PERSPECTIVES, TEMPLATE_KINDS, type MapLayer, type Padding, type Perspective, type TemplateColors } from "@/lib/maps";

const paddingFromForm = (formData: FormData) =>
  Object.fromEntries(EDGES.map((e) => [e, Math.max(0, Math.round(Number(formData.get(`pad_${e}`)) || 0))])) as Padding;

export async function submitLocation(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const parent_id = Number(formData.get("parent_id")) || null;
  if (parent_id !== null && !listLocations().some((l) => l.id === parent_id)) throw new Error("Unknown parent location");
  if (parent_id !== null && parent_id === id) throw new Error("A location cannot be inside itself");
  saveLocation(id, { parent_id, name: text("name"), description: text("description") });
  redirect("/campaign/locations");
}

export async function toggleLayer(locationId: number, levelId: number, layer: MapLayer, visible: boolean) {
  await requireGm();
  if (!MAP_LAYERS.includes(layer)) throw new Error("Invalid layer");
  setLayerVisible(levelId, layer, visible);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Adds a named level above or below the current one. */
export async function submitLevel(locationId: number, currentLevelId: number, formData: FormData) {
  await requireGm();
  const where = formData.get("where") === "below" ? "below" : "above";
  const name = String(formData.get("name") ?? "").trim() || "New level";
  const id = addLevel(locationId, name, { levelId: currentLevelId, where });
  redirect(`/campaign/locations/${locationId}?level=${id}`);
}

export async function deleteLevel(locationId: number, levelId: number) {
  await requireGm();
  if (listLevels(locationId).length <= 1) throw new Error("A map needs at least one level");
  removeLevel(levelId);
  redirect(`/campaign/locations/${locationId}`);
}

export async function submitBackground(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  const mode = formData.get("mode") === "texture" ? "texture" : "color";
  const color = String(formData.get("color") ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Invalid colour");
  saveBackground(levelId, {
    mode,
    color,
    image: await imageFromForm(formData, "background"),
    fit: formData.get("fit") === "tile" ? "tile" : "fill",
    padding: paddingFromForm(formData),
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function submitMapImage(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  const perspective = String(formData.get("perspective")) as Perspective;
  if (!PERSPECTIVES.includes(perspective)) throw new Error("Invalid perspective");
  saveMapImage(levelId, { image: await imageFromForm(formData, "map"), perspective });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function submitGrid(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  const color = String(formData.get("color") ?? "");
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Invalid colour");
  saveGrid(levelId, {
    size: Math.max(5, Math.round(Number(formData.get("size")) || 50)),
    color,
    offsetX: Math.round(Number(formData.get("offsetX")) || 0),
    offsetY: Math.round(Number(formData.get("offsetY")) || 0),
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function submitTemplateColors(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  const colors = Object.fromEntries(TEMPLATE_KINDS.map((k) => [k, String(formData.get(k) ?? "")])) as TemplateColors;
  if (!Object.values(colors).every((c) => /^#[0-9a-f]{6}$/i.test(c))) throw new Error("Invalid colour");
  saveTemplateColors(levelId, colors);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Uploads an image into the asset library as a tile. */
export async function uploadTileAsset(locationId: number, formData: FormData) {
  await requireGm();
  const url = await imageFromForm(formData, "tile", String(formData.get("name") ?? "").trim());
  if (!url) throw new Error("Choose an image to upload");
  revalidatePath(`/campaign/locations/${locationId}`);
}
