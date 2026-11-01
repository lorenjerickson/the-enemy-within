"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { addLevel, listLevels, listLocations, removeLevel, renameLevel, saveBackground, saveLocation, setLayerVisible } from "@/lib/db";
import { imageFromForm } from "@/lib/images";
import { MAP_LAYERS, type MapLayer } from "@/lib/maps";

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

export async function submitLevel(locationId: number, formData: FormData) {
  await requireGm();
  const id = addLevel(locationId, String(formData.get("name") ?? "").trim() || "New level");
  redirect(`/campaign/locations/${locationId}?level=${id}`);
}

export async function submitLevelName(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  renameLevel(levelId, String(formData.get("name") ?? "").trim() || "Unnamed level");
  revalidatePath(`/campaign/locations/${locationId}`);
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
    image: await imageFromForm(formData),
    fit: formData.get("fit") === "tile" ? "tile" : "fill",
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}
