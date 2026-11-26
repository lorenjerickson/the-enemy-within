import { db } from "@/lib/db/connection";
import type { ClipMode } from "@/lib/maps";

export const ASSET_USAGES = ["item", "creature", "token", "background", "map", "tile", "ambient"] as const;

export type AssetType = "image" | "audio";

export type AssetUsage = (typeof ASSET_USAGES)[number];

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  usage: AssetUsage;
  url: string;
}

/** An asset's URL (an area's sound…), if it's still there. */
export const getAssetUrl = (id: number): string | undefined => db.prepare<[number], { url: string }>("SELECT url FROM assets WHERE id = ?").get(id)?.url;

export function listAssets(filter: { type: AssetType; usage: AssetUsage }): Asset[] {
  return db
    .prepare<[string, string], Asset>("SELECT id, name, type, usage, url FROM assets WHERE type = ? AND usage = ? ORDER BY name")
    .all(filter.type, filter.usage);
}

export function addAsset(a: Omit<Asset, "id">): void {
  db.prepare<Omit<Asset, "id">>("INSERT INTO assets (name, type, usage, url) VALUES (@name, @type, @usage, @url)").run(a);
}

export function getAssetIdByUrl(url: string): number | undefined {
  return db.prepare<[string], { id: number }>("SELECT id FROM assets WHERE url = ?").get(url)?.id;
}

export interface AmbientClip {
  id: number;
  asset_id: number;
  name: string;
  url: string;
  mode: ClipMode;
}

export interface AmbientSound {
  id: number;
  name: string;
  volume: number; // 0..1
  clips: AmbientClip[]; // playlist order
}

export function listAmbientSounds(levelId: number): AmbientSound[] {
  const sounds = db
    .prepare<[number], { id: number; name: string; volume: number }>("SELECT id, name, volume FROM ambient_sounds WHERE level_id = ? ORDER BY id")
    .all(levelId);
  const clips = db.prepare<[number], AmbientClip>(
    `SELECT c.id, c.asset_id, a.name, a.url, c.mode FROM ambient_clips c JOIN assets a ON a.id = c.asset_id
     WHERE c.sound_id = ? ORDER BY c.id`
  );
  return sounds.map((s) => ({ ...s, clips: clips.all(s.id) }));
}

export type SharedAmbient = { rev: number; volume: number; loop: { id: number; url: string }[]; layer: { id: number; url: string }[]; once: { id: number; url: string } | null } | null;

/** The GM played (or stopped: null) an ambient sound on a level; volume alone: same play, louder or softer. */
export function setLevelAmbient(levelId: number, play: { soundId: number; clipId?: number | null; volume: number } | null, volumeOnly = false): void {
  const was = db.prepare<[number], { rev: number }>("SELECT rev FROM level_ambient WHERE level_id = ?").get(levelId);
  if (volumeOnly && play) { db.prepare("UPDATE level_ambient SET volume = ? WHERE level_id = ?").run(play.volume, levelId); return; }
  db.prepare("INSERT OR REPLACE INTO level_ambient (level_id, sound_id, clip_id, volume, rev) VALUES (?, ?, ?, ?, ?)")
    .run(levelId, play?.soundId ?? null, play?.clipId ?? null, play?.volume ?? 1, (was?.rev ?? 0) + 1);
}

/** What's playing on a level, as players' browsers play it (clips with their files). */
export function getLevelAmbient(levelId: number): SharedAmbient {
  const row = db.prepare<[number], { sound_id: number | null; clip_id: number | null; volume: number; rev: number }>("SELECT sound_id, clip_id, volume, rev FROM level_ambient WHERE level_id = ?").get(levelId);
  if (!row) return null;
  const sound = row.sound_id === null ? undefined : listAmbientSounds(levelId).find((s) => s.id === row.sound_id);
  if (!sound) return { rev: row.rev, volume: row.volume, loop: [], layer: [], once: null };
  const clip = (c: AmbientClip) => ({ id: c.id, url: c.url });
  const once = row.clip_id === null ? null : sound.clips.find((c) => c.id === row.clip_id);
  return { rev: row.rev, volume: row.volume, once: once ? clip(once) : null, loop: once ? [] : sound.clips.filter((c) => c.mode === "loop").map(clip), layer: once ? [] : sound.clips.filter((c) => c.mode === "layer").map(clip) };
}

export function addAmbientSound(levelId: number, name: string): void {
  db.prepare<[number, string]>("INSERT INTO ambient_sounds (level_id, name) VALUES (?, ?)").run(levelId, name);
}

export function deleteAmbientSound(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM ambient_clips WHERE sound_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM ambient_sounds WHERE id = ?").run(id);
  })();
}

export function addAmbientClip(soundId: number, assetId: number, mode: ClipMode): void {
  db.prepare<[number, number, string]>("INSERT INTO ambient_clips (sound_id, asset_id, mode) VALUES (?, ?, ?)").run(soundId, assetId, mode);
}

export function setClipMode(id: number, mode: ClipMode): void {
  db.prepare<[string, number]>("UPDATE ambient_clips SET mode = ? WHERE id = ?").run(mode, id);
}

export function deleteAmbientClip(id: number): void {
  db.prepare<[number]>("DELETE FROM ambient_clips WHERE id = ?").run(id);
}

/** A sound placed on the map: position in grid units (cell centre = col + 0.5) and effective range in cells. */
export interface PositionalSound {
  id: number;
  asset_id: number;
  name: string;
  url: string;
  x: number;
  y: number;
  radius: number;
  volume: number; // 0..1
  loop: 0 | 1;
}

export function listPositionalSounds(levelId: number): PositionalSound[] {
  return db
    .prepare<[number], PositionalSound>(
      `SELECT p.id, p.asset_id, a.name, a.url, p.x, p.y, p.radius, p.volume, p.loop FROM positional_sounds p
       JOIN assets a ON a.id = p.asset_id WHERE p.level_id = ? ORDER BY p.id`
    )
    .all(levelId);
}

export function addPositionalSound(levelId: number, s: Omit<PositionalSound, "id" | "name" | "url" | "volume" | "loop">): void {
  db.prepare<Omit<PositionalSound, "id" | "name" | "url" | "volume" | "loop"> & { level_id: number }>(
    "INSERT INTO positional_sounds (level_id, asset_id, x, y, radius) VALUES (@level_id, @asset_id, @x, @y, @radius)"
  ).run({ ...s, level_id: levelId });
}

export function setPositionalLoop(id: number, loop: boolean): void {
  db.prepare<[number, number]>("UPDATE positional_sounds SET loop = ? WHERE id = ?").run(loop ? 1 : 0, id);
}

export function movePositionalSound(id: number, x: number, y: number): void {
  db.prepare<[number, number, number]>("UPDATE positional_sounds SET x = ?, y = ? WHERE id = ?").run(x, y, id);
}

export function setPositionalRadius(id: number, radius: number): void {
  db.prepare<[number, number]>("UPDATE positional_sounds SET radius = ? WHERE id = ?").run(radius, id);
}

export function deletePositionalSound(id: number): void {
  db.prepare<[number]>("DELETE FROM positional_sounds WHERE id = ?").run(id);
}

export function setSoundVolume(table: "ambient_sounds" | "positional_sounds", id: number, volume: number): void {
  db.prepare<[number, number]>(`UPDATE ${table} SET volume = ? WHERE id = ?`).run(Math.min(1, Math.max(0, volume)), id);
}
