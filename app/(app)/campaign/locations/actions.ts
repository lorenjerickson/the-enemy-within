"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { listLocations, saveLocation, setLayerVisible } from "@/lib/db";
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

export async function toggleLayer(locationId: number, layer: MapLayer, visible: boolean) {
  await requireGm();
  if (!MAP_LAYERS.includes(layer)) throw new Error("Invalid layer");
  setLayerVisible(locationId, layer, visible);
  revalidatePath(`/campaign/locations/${locationId}`);
}
