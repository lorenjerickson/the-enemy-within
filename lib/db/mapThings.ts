import type { LightKind, ControlEdge } from "@/lib/maps";
import { db, nameUnnamed } from "@/lib/db/connection";
import type { EffectKind } from "@/lib/effects";
import type { Fx } from "@/lib/vfx";
import type { Role } from "@/lib/db/users";

export interface LightSource {
  id: number;
  kind: LightKind;
  x: number; // grid units; cell centre = col + 0.5
  y: number;
  radius: number; // cells
  angle: number; // degrees, directional only
  spread: number; // degrees, directional only
  flicker: 0 | 1;
  name: string;
  enabled: 0 | 1; // switched on
}

export function listLights(levelId: number): LightSource[] {
  return db
    .prepare<[number], LightSource>("SELECT id, kind, x, y, radius, angle, spread, flicker, name, enabled FROM light_sources WHERE level_id = ? ORDER BY id")
    .all(levelId);
}

export function addLight(levelId: number, l: Omit<LightSource, "id" | "name" | "enabled">): void {
  db.prepare<Omit<LightSource, "id" | "name" | "enabled"> & { level_id: number }>(
    `INSERT INTO light_sources (level_id, kind, x, y, radius, angle, spread, flicker)
     VALUES (@level_id, @kind, @x, @y, @radius, @angle, @spread, @flicker)`
  ).run({ ...l, level_id: levelId });
  nameUnnamed();
}

/** What scripts can change on a light. */
export function updateLight(id: number, l: { radius: number; flicker: boolean; on: boolean }): void {
  db.prepare<[number, number, number, number]>("UPDATE light_sources SET radius = ?, flicker = ?, enabled = ? WHERE id = ?").run(
    Math.max(0.5, l.radius), l.flicker ? 1 : 0, l.on ? 1 : 0, id
  );
}

/** Renames a light, effect or door (the name scripts use). */
export function renameMapThing(table: "light_sources" | "map_effects" | "map_structures", id: number, name: string): void {
  db.prepare<[string, number]>(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name.trim(), id);
  nameUnnamed();
}

export function setMapThingOn(table: "light_sources" | "map_effects", id: number, on: boolean): void {
  db.prepare<[number, number]>(`UPDATE ${table} SET enabled = ? WHERE id = ?`).run(on ? 1 : 0, id);
}

export function deleteLight(id: number): void {
  db.prepare<[number]>("DELETE FROM light_sources WHERE id = ?").run(id);
}

/** A GM-only sticky note on the map. */
export interface MapNote {
  id: number;
  x: number;
  y: number;
  w: number; // width in grid cells
  h: number; // minimum height in grid cells (taller if the text needs it)
  text: string;
}

export function listNotes(levelId: number): MapNote[] {
  return db.prepare<[number], MapNote>("SELECT id, x, y, w, h, text FROM map_notes WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addNote(levelId: number, n: Omit<MapNote, "id" | "w" | "h">): void {
  db.prepare<Omit<MapNote, "id" | "w" | "h"> & { level_id: number }>("INSERT INTO map_notes (level_id, x, y, text) VALUES (@level_id, @x, @y, @text)").run({
    ...n,
    level_id: levelId,
  });
}

export function updateNoteText(id: number, text: string): void {
  db.prepare<[string, number]>("UPDATE map_notes SET text = ? WHERE id = ?").run(text, id);
}

export function deleteNote(id: number): void {
  db.prepare<[number]>("DELETE FROM map_notes WHERE id = ?").run(id);
}

export function resizeNote(id: number, w: number, h: number): void {
  db.prepare<[number, number, number]>("UPDATE map_notes SET w = ?, h = ? WHERE id = ?").run(w, h, id);
}

/** A GM button floating along an edge of the scene. */
export interface MapControl {
  id: number;
  edge: ControlEdge;
  icon: string; // react-icons Game Icons component name, e.g. "GiDoorway"
  label: string; // shown as a tooltip
  script: string; // game script run on click (docs/scripting.md)
}

export function listControls(levelId: number): MapControl[] {
  return db.prepare<[number], MapControl>("SELECT id, edge, icon, label, script FROM map_controls WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addControl(levelId: number, edge: ControlEdge, icon: string, label: string): void {
  db.prepare<[number, string, string, string]>("INSERT INTO map_controls (level_id, edge, icon, label) VALUES (?, ?, ?, ?)").run(
    levelId, edge, icon, label
  );
}

export function getControlScript(id: number): { script: string; level_id: number } | undefined {
  return db.prepare<[number], { script: string; level_id: number }>("SELECT script, level_id FROM map_controls WHERE id = ?").get(id);
}

export function saveControlScript(id: number, script: string): void {
  db.prepare<[string, number]>("UPDATE map_controls SET script = ? WHERE id = ?").run(script, id);
}

export function deleteControl(id: number): void {
  db.prepare<[number]>("DELETE FROM map_controls WHERE id = ?").run(id);
}

// ---------- Effects ----------

/** An animated effect on a level. With no area it covers the whole map; otherwise the w × h cells from (x, y). */
export interface MapEffect {
  id: number;
  kind: EffectKind;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  intensity: number; // 0..1
  name: string;
  enabled: 0 | 1; // switched on
}

export function listEffects(levelId: number): MapEffect[] {
  return db.prepare<[number], MapEffect>("SELECT id, kind, x, y, w, h, intensity, name, enabled FROM map_effects WHERE level_id = ? ORDER BY id").all(levelId);
}

export function addEffect(levelId: number, e: Omit<MapEffect, "id" | "name" | "enabled">): void {
  db.prepare<Omit<MapEffect, "id" | "name" | "enabled"> & { level_id: number }>(
    "INSERT INTO map_effects (level_id, kind, x, y, w, h, intensity) VALUES (@level_id, @kind, @x, @y, @w, @h, @intensity)"
  ).run({ ...e, level_id: levelId });
  nameUnnamed();
}

/** What scripts can change on an effect. */
export function updateEffect(id: number, e: { intensity: number; on: boolean }): void {
  db.prepare<[number, number, number]>("UPDATE map_effects SET intensity = ?, enabled = ? WHERE id = ?").run(Math.min(1, Math.max(0, e.intensity)), e.on ? 1 : 0, id);
}

export function moveEffect(id: number, x: number, y: number): void {
  db.prepare<[number, number, number]>("UPDATE map_effects SET x = ?, y = ? WHERE id = ? AND w IS NOT NULL").run(x, y, id);
}

export function setEffectIntensity(id: number, intensity: number): void {
  db.prepare<[number, number]>("UPDATE map_effects SET intensity = ? WHERE id = ?").run(Math.min(1, Math.max(0, intensity)), id);
}

export function deleteEffect(id: number): void {
  db.prepare<[number]>("DELETE FROM map_effects WHERE id = ?").run(id);
}

export function addMapFx(levelId: number, starts: number, fx: Fx): void {
  db.prepare("DELETE FROM map_fx WHERE starts < ?").run(Date.now() - 60_000);
  db.prepare("INSERT INTO map_fx (level_id, starts, fx) VALUES (?, ?, ?)").run(levelId, starts, JSON.stringify(fx));
}

/** Effects on a level after the given id (the last one a map has seen), from the last minute. */
export function listMapFx(levelId: number, afterId: number): { id: number; starts: number; fx: Fx }[] {
  return db
    .prepare<[number, number, number], { id: number; starts: number; fx: string }>("SELECT id, starts, fx FROM map_fx WHERE level_id = ? AND id > ? AND starts > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 60_000)
    .map((r) => ({ ...r, fx: JSON.parse(r.fx) }));
}

export interface Ping { id: number; x: number; y: number; user_id: number; name: string; gm: 0 | 1 }

export function addPing(levelId: number, x: number, y: number, user: { id: number; name: string; role: Role }): void {
  const now = Date.now();
  db.prepare("DELETE FROM pings WHERE created < ?").run(now - 60_000);
  db.prepare("INSERT INTO pings (level_id, x, y, user_id, name, gm, created) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    levelId, x, y, user.id, user.name, user.role === "gm" ? 1 : 0, now
  );
}

/** Pings on a level newer than `afterId`, from the last few seconds. */
export function listPings(levelId: number, afterId: number): Ping[] {
  return db
    .prepare<[number, number, number], Ping>("SELECT id, x, y, user_id, name, gm FROM pings WHERE level_id = ? AND id > ? AND created > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 4000);
}
