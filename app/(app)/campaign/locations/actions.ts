"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { savePartyStart, clearPartyStart, renameMapThing, setMapThingOn, moveEffect, addEffect, setEffectIntensity, deleteEffect, setPositionalLoop, movePositionalSound, saveFigureHeight, getCharacter, placeCharacterToken, getTokenLevel, getTileLevel, isGridlessLevel, isPortraitLevel, listStructures, addControl, deleteControl, getControlScript, saveControlScript, addNote, deleteNote, resizeNote, updateNoteText, setDoorOpen, addLight, deleteLight, saveIllumination, setSoundVolume, addPositionalSound, deletePositionalSound, setPositionalRadius, addAmbientClip, addAmbientSound, deleteAmbientClip, deleteAmbientSound, setClipMode, addCreatureToken, addStructure, addTile, deleteToken, getCreature, moveToken, deleteStructure, deleteTile, moveTile, getAssetIdByUrl, addLevel, listLevels, listLocations, removeLevel, saveBackground, saveLocation, saveGrid, saveMapImage, saveTemplateColors, setLayerVisible } from "@/lib/db";
import { audioFromForm, imageFromForm } from "@/lib/images";
import { CLIP_MODES, CONTROL_EDGES, type ControlEdge, type ClipMode, LIGHT_KINDS, type LightKind, EDGES, MAP_LAYERS, PERSPECTIVES, STRUCTURE_KINDS, TEMPLATE_KINDS, type StructureKind, type MapLayer, type Padding, type Perspective, type TemplateColors } from "@/lib/maps";
import { checkScript } from "@/lib/script";
import { EFFECT_KINDS, type EffectKind } from "@/lib/effects";
import { landingRow, snapHeight } from "@/lib/gravity";
import { tryGameScript, type ScriptResult } from "@/lib/game";

const paddingFromForm = (formData: FormData) =>
  Object.fromEntries(EDGES.map((e) => [e, Math.max(0, Math.round(Number(formData.get(`pad_${e}`)) || 0))])) as Padding;

export async function submitLocation(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const parent_id = Number(formData.get("parent_id")) || null;
  if (parent_id !== null && !listLocations().some((l) => l.id === parent_id)) throw new Error("Unknown parent location");
  if (parent_id !== null && parent_id === id) throw new Error("A location cannot be inside itself");
  saveLocation(id, { parent_id, name: text("name"), description: text("description") });
  // A new location goes back to the list; editing one stays put (its Save button is in the page header).
  if (id === null) redirect("/campaign/locations");
  revalidatePath(`/campaign/locations/${id}`);
  revalidatePath("/campaign/locations");
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
    gridless: formData.get("gridless") === "on",
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
  // Whole cells, or anywhere and any size (to 1/20 of a unit) on gridless maps.
  const gridless = isGridlessLevel(levelId);
  const at = gridless ? (n: number) => snapHeight(Number(n)) : int;
  const min = gridless ? 0.25 : 1;
  addTile(levelId, {
    asset_id: int(tile.asset_id),
    col: at(tile.col),
    row: at(tile.row),
    cols: Math.max(min, at(tile.cols)),
    rows: Math.max(min, at(tile.rows)),
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function moveTileTo(locationId: number, tileId: number, col: number, row: number) {
  await requireGm();
  const levelId = getTileLevel(tileId);
  const at = levelId !== undefined && isGridlessLevel(levelId) ? (n: number) => snapHeight(Number(n)) : (n: number) => Math.round(Number(n));
  moveTile(tileId, at(col), at(row));
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
  // Level links sit in a cell (anywhere on gridless maps); lines may be off the grid (irregular maps), to 1/20 of a cell.
  const at = piece.kind === "staircase" && !isGridlessLevel(levelId) ? (n: number) => Math.round(Number(n)) : (n: number) => snapHeight(Number(n));
  addStructure(levelId, {
    kind: piece.kind,
    x1: at(piece.x1),
    y1: at(piece.y1),
    x2: at(piece.x2),
    y2: at(piece.y2),
    target_level_id: piece.kind === "staircase" ? piece.target_level_id : null,
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeStructure(locationId: number, id: number) {
  await requireGm();
  deleteStructure(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Portrait maps: how many grid cells tall a 1.8 m figure stands (sizes side-on tokens to the art). */
export async function changeFigureHeight(locationId: number, levelId: number, cells: number) {
  await requireGm();
  if (!Number.isFinite(cells)) throw new Error("Invalid figure height");
  saveFigureHeight(levelId, cells);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** GM's placement of a character's token (moving it here if it's already on a map). */
export async function placeCharacterTokenAt(locationId: number, levelId: number, characterId: number, col: number, row: number) {
  await requireGm();
  if (!getCharacter(characterId)) throw new Error("Unknown character");
  placeCharacterToken(levelId, characterId, across(levelId, col), settle(levelId, across(levelId, col), row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** GM's initial placement of a creature token in a grid cell. */
export async function placeCreatureToken(locationId: number, levelId: number, creatureId: number, col: number, row: number) {
  await requireGm();
  if (!getCreature(creatureId)) throw new Error("Unknown creature");
  addCreatureToken(levelId, creatureId, across(levelId, col), settle(levelId, across(levelId, col), row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeToken(locationId: number, id: number) {
  await requireGm();
  deleteToken(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function moveTokenTo(locationId: number, id: number, col: number, row: number) {
  await requireGm();
  const levelId = getTokenLevel(id);
  if (levelId === undefined) return;
  moveToken(id, across(levelId, col), settle(levelId, across(levelId, col), row));
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** A token's column: a whole cell, or anywhere (to 1/20) on gridless maps. */
function across(levelId: number, col: number): number {
  return isGridlessLevel(levelId) ? snapHeight(Number(col)) : Math.round(Number(col));
}

/**
 * Where the GM's placed token comes to rest: on portrait maps it drops to the floor below (no fall damage),
 * at any height; elsewhere it sits in a whole cell, or anywhere on gridless maps.
 */
function settle(levelId: number, col: number, row: number): number {
  if (isPortraitLevel(levelId)) return landingRow(listStructures(levelId), col, snapHeight(Number(row)));
  return isGridlessLevel(levelId) ? snapHeight(Number(row)) : Math.round(row);
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

/** Adds an effect: to the whole map (no area) or over the w × h cells from (x, y). */
export async function placeEffect(
  locationId: number,
  levelId: number,
  e: { kind: EffectKind; x: number | null; y: number | null; w: number | null; h: number | null; intensity: number }
) {
  await requireGm();
  if (!EFFECT_KINDS.includes(e.kind)) throw new Error("Unknown effect");
  const placed = e.x !== null && e.y !== null && e.w !== null && e.h !== null;
  addEffect(levelId, {
    kind: e.kind,
    x: placed ? Number(e.x) : null,
    y: placed ? Number(e.y) : null,
    w: placed ? Math.max(0.25, Number(e.w)) : null,
    h: placed ? Math.max(0.25, Number(e.h)) : null,
    intensity: Math.min(1, Math.max(0, Number(e.intensity))),
  });
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Renames a light, effect or door (scripts refer to them by name). */
export async function renameThing(locationId: number, table: "light_sources" | "map_effects" | "map_structures", id: number, name: string) {
  await requireGm();
  if (!["light_sources", "map_effects", "map_structures"].includes(table)) throw new Error("Can't rename that");
  renameMapThing(table, id, String(name).slice(0, 60));
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Switches a light or effect on or off. */
export async function switchThing(locationId: number, table: "light_sources" | "map_effects", id: number, on: boolean) {
  await requireGm();
  if (!["light_sources", "map_effects"].includes(table)) throw new Error("Can't switch that");
  setMapThingOn(table, id, !!on);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Moves a placed effect so its area's top-left is at (x, y). */
export async function moveEffectTo(locationId: number, id: number, x: number, y: number) {
  await requireGm();
  moveEffect(id, Number(x), Number(y));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changeEffectIntensity(locationId: number, id: number, intensity: number) {
  await requireGm();
  setEffectIntensity(id, Number(intensity));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeEffect(locationId: number, id: number) {
  await requireGm();
  deleteEffect(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changePositionalLoop(locationId: number, id: number, loop: boolean) {
  await requireGm();
  setPositionalLoop(id, !!loop);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function movePositionalSoundTo(locationId: number, id: number, x: number, y: number) {
  await requireGm();
  movePositionalSound(id, Number(x), Number(y));
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

export async function placeNote(locationId: number, levelId: number, x: number, y: number, text: string) {
  await requireGm();
  addNote(levelId, { x: Number(x), y: Number(y), text: String(text).trim() || "Note" });
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function editNote(locationId: number, id: number, text: string) {
  await requireGm();
  updateNoteText(id, String(text).trim() || "Note");
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function removeNote(locationId: number, id: number) {
  await requireGm();
  deleteNote(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function changeNoteSize(locationId: number, id: number, w: number, h: number) {
  await requireGm();
  resizeNote(id, Math.max(0.6, Number(w) || 1.6), Math.max(0.6, Number(h) || 1.6));
  revalidatePath(`/campaign/locations/${locationId}`);
}

export async function submitControl(locationId: number, levelId: number, formData: FormData) {
  await requireGm();
  const edge = String(formData.get("edge")) as ControlEdge;
  if (!CONTROL_EDGES.includes(edge)) throw new Error("Invalid edge");
  const icon = String(formData.get("icon") ?? "");
  if (!/^Gi[A-Za-z0-9]+$/.test(icon)) throw new Error("Choose an icon");
  addControl(levelId, edge, icon, String(formData.get("label") ?? "").trim() || "Button");
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Saves a button's script; returns the syntax error instead of saving if it doesn't parse. */
export async function changeControlScript(locationId: number, id: number, script: string): Promise<string | null> {
  await requireGm();
  const error = checkScript(script);
  if (error) return error;
  saveControlScript(id, script);
  revalidatePath(`/campaign/locations/${locationId}`);
  return null;
}

/** Runs a button's script (a GM clicked it on the map). */
export async function runControl(locationId: number, id: number): Promise<ScriptResult> {
  await requireGm();
  const control = getControlScript(id);
  if (!control) return { ok: false, error: "That button no longer exists" };
  if (!control.script.trim()) return { ok: false, error: "This button has no script yet" };
  const result = tryGameScript(control.script, control.level_id);
  revalidatePath(`/campaign/locations/${locationId}`);
  return result;
}

export async function removeControl(locationId: number, id: number) {
  await requireGm();
  deleteControl(id);
  revalidatePath(`/campaign/locations/${locationId}`);
}

/** Marks the area on this level where the party's tokens start the campaign (replaces any earlier one). */
export async function setPartyStart(locationId: number, levelId: number, a: { x: number; y: number; w: number; h: number }) {
  await requireGm();
  const n = (v: number) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  savePartyStart(levelId, { x: n(a.x), y: n(a.y), w: Math.max(0.25, n(a.w)), h: Math.max(0.25, n(a.h)) });
  revalidatePath(`/campaign/locations/${locationId}`);
  revalidatePath("/campaign");
}

export async function removePartyStart(locationId: number) {
  await requireGm();
  clearPartyStart();
  revalidatePath(`/campaign/locations/${locationId}`);
  revalidatePath("/campaign");
}
