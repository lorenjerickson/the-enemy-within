"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { setDoorOpen, addLight, deleteLight, saveIllumination, setSoundVolume, addPositionalSound, deletePositionalSound, setPositionalRadius, addAmbientClip, addAmbientSound, deleteAmbientClip, deleteAmbientSound, setClipMode, addCreatureToken, addStructure, addTile, deleteToken, getCreature, moveToken, deleteStructure, deleteTile, moveTile, getAssetIdByUrl, addLevel, listLevels, listLocations, removeLevel, saveBackground, saveLocation, saveGrid, saveMapImage, saveTemplateColors, setLayerVisible } from "@/lib/db";
import { audioFromForm, imageFromForm } from "@/lib/images";
import { CLIP_MODES, type ClipMode, LIGHT_KINDS, type LightKind, EDGES, MAP_LAYERS, PERSPECTIVES, STRUCTURE_KINDS, TEMPLATE_KINDS, type StructureKind, type MapLayer, type Padding, type Perspective, type TemplateColors } from "@/lib/maps";

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

/** Adds the tile from the ImagePicker fields (upload, or an already generated image) and returns its asset id. */
export async function addTileAsset(locationId: number, formData: FormData): Promise<number | null> {
  await requireGm();
  const url = await imageFromForm(formData, "tile", String(formData.get("name") ?? "").trim());
  revalidatePath(`/campaign/locations/${locationId}`);
  return url ? getAssetIdByUrl(url) ?? null : null;
}

/** Places an asset over a rectangle of grid cells on a level. */
export async function placeTile(
  locationId: number,
  levelId: number,
  tile: { asset_id: number; col: number; row: number; cols: number; rows: number }
) {
  await requireGm();
  const int = (n: number) => Math.round(Number(n));
  addTile(levelId, {
    asset_id: int(tile.asset_id),
    col: int(tile.col),
    row: int(tile.row),
    cols: Math.max(1, int(tile.cols)),
    rows: Math.max(1, int(tile.rows)),
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function moveTileTo(locationId: number, tileId: number, col: number, row: number) {
  await requireGm();
  moveTile(tileId, Math.round(col), Math.round(row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeTile(locationId: number, tileId: number) {
  await requireGm();
  deleteTile(tileId);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function placeStructure(
  locationId: number,
  levelId: number,
  piece: { kind: StructureKind; x1: number; y1: number; x2: number; y2: number; target_level_id: number | null }
) {
  await requireGm();
  if (!STRUCTURE_KINDS.includes(piece.kind)) throw new Error("Invalid structure kind");
  const levels = listLevels(locationId);
  if (piece.kind === "staircase" && !levels.some((l) => l.id === piece.target_level_id && l.id !== levelId)) {
    throw new Error("A staircase needs another level to lead to");
  }
  const int = (n: number) => Math.round(Number(n));
  addStructure(levelId, {
    kind: piece.kind,
    x1: int(piece.x1),
    y1: int(piece.y1),
    x2: int(piece.x2),
    y2: int(piece.y2),
    target_level_id: piece.kind === "staircase" ? piece.target_level_id : null,
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeStructure(locationId: number, id: number) {
  await requireGm();
  deleteStructure(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** GM's initial placement of a creature token in a grid cell. */
export async function placeCreatureToken(locationId: number, levelId: number, creatureId: number, col: number, row: number) {
  await requireGm();
  if (!getCreature(creatureId)) throw new Error("Unknown creature");
  addCreatureToken(levelId, creatureId, Math.round(col), Math.round(row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeToken(locationId: number, id: number) {
  await requireGm();
  deleteToken(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function moveTokenTo(locationId: number, id: number, col: number, row: number) {
  await requireGm();
  moveToken(id, Math.round(col), Math.round(row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function submitAmbientSound(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  addAmbientSound(levelId, String(formData.get("name") ?? "").trim() || "Ambient sound");
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeAmbientSound(locationId: number, soundId: number) {
  await requireGm();
  deleteAmbientSound(soundId);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Uploads an audio file into the media library (audio · ambient). */
export async function uploadAudioAsset(locationId: number, formData: FormData) {
  await requireGm();
  const url = await audioFromForm(formData, String(formData.get("name") ?? "").trim());
  if (!url) throw new Error("Choose an audio file to upload");
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Adds an audio asset from the media library to a sound's playlist. */
export async function addClipToSound(locationId: number, soundId: number, assetId: number, mode: ClipMode) {
  await requireGm();
  if (!CLIP_MODES.includes(mode)) throw new Error("Invalid clip mode");
  addAmbientClip(soundId, assetId, mode);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changeClipMode(locationId: number, clipId: number, mode: ClipMode) {
  await requireGm();
  if (!CLIP_MODES.includes(mode)) throw new Error("Invalid clip mode");
  setClipMode(clipId, mode);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeAmbientClip(locationId: number, clipId: number) {
  await requireGm();
  deleteAmbientClip(clipId);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function placePositionalSound(locationId: number, levelId: number, assetId: number, x: number, y: number, radius: number) {
  await requireGm();
  addPositionalSound(levelId, { asset_id: assetId, x: Number(x), y: Number(y), radius: Math.max(0.5, Number(radius) || 3) });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changePositionalRadius(locationId: number, id: number, radius: number) {
  await requireGm();
  setPositionalRadius(id, Math.max(0.5, Number(radius) || 3));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removePositionalSound(locationId: number, id: number) {
  await requireGm();
  deletePositionalSound(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changeSoundVolume(locationId: number, kind: "ambient" | "positional", id: number, volume: number) {
  await requireGm();
  setSoundVolume(kind === "ambient" ? "ambient_sounds" : "positional_sounds", id, Number(volume));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changeIllumination(locationId: number, levelId: number, illumination: number) {
  await requireGm();
  saveIllumination(levelId, Number(illumination));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function placeLight(
  locationId: number,
  levelId: number,
  light: { kind: LightKind; x: number; y: number; radius: number; angle: number; spread: number; flicker: boolean }
) {
  await requireGm();
  if (!LIGHT_KINDS.includes(light.kind)) throw new Error("Invalid light kind");
  addLight(levelId, {
    kind: light.kind,
    x: Number(light.x),
    y: Number(light.y),
    radius: Math.max(0.5, Number(light.radius) || 4),
    angle: ((Number(light.angle) % 360) + 360) % 360,
    spread: Math.min(360, Math.max(5, Number(light.spread) || 60)),
    flicker: light.flicker ? 1 : 0,
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeLight(locationId: number, id: number) {
  await requireGm();
  deleteLight(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function toggleDoor(locationId: number, id: number, open: boolean) {
  await requireGm();
  setDoorOpen(id, open);
  revalidatePath(`/campaign/locations/${locationId}`);
}
