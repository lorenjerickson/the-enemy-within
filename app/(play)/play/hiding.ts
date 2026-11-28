import { clearHidden, setHidden, listHidden, listTokens, tokenLabels } from "@/lib/db/tokens";
import { getIllumination, isGridlessLevel, listStructures } from "@/lib/db/maps";
import { listLights } from "@/lib/db/mapThings";
import { logSessionEvent } from "@/lib/db/sessions";
import { blindSpots, watched, type Watcher } from "@/lib/hiding";
import { brightEnough } from "@/lib/light";
import { FEET_PER_SQUARE, reachableSquares } from "@/lib/movement";
import { SIGHT } from "@/lib/sight";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";
import { seesThem } from "@/lib/conditions";
import { sensesOf } from "@/lib/creatureChanges";
import { allegianceOf, relation } from "@/lib/sides";
import { seenFrom } from "@/lib/sight";
import { FOG_SIGHT_FT, fogOn, moveBlockers } from "@/lib/db/areas";
import { blindRangeOf } from "@/lib/conditions";

/** Fog (a fog effect, a smoke hazard) at a spot hides it from anyone further than 15 ft away. */
const fogged = (inFog: (p: { x: number; y: number }) => boolean, from: { x: number; y: number }, p: { x: number; y: number }) => inFog(p) && Math.hypot(p.x - from.x, p.y - from.y) > blindRangeOf(FOG_SIGHT_FT);

/**
 * Hidden tokens (Hide) given away out of encounters. A hidden one who moves into an enemy's view, or has an enemy right
 * next to them, is revealed; so is one who acts on someone. Returns who was revealed (for the walker's message).
 */
export function reveal(levelId: number, tokenId: number, why: string): boolean {
  if (!listHidden(levelId).has(tokenId)) return false;
  clearHidden(tokenId);
  logSessionEvent(`${tokenLabels(levelId).get(tokenId) ?? "Someone"} is no longer hidden (${why}).`);
  return true;
}

const enemiesOf = (levelId: number, tokenId: number) => {
  const tokens = listTokens(levelId), me = tokens.find((t) => t.id === tokenId);
  return { me, enemies: me ? tokens.filter((t) => t.id !== tokenId && relation(allegianceOf(t), allegianceOf(me)) !== "friendly") : [] };
};
const nextTo = (levelId: number, a: { col: number; row: number }, b: { col: number; row: number }) =>
  isGridlessLevel(levelId) ? Math.hypot(a.col - b.col, a.row - b.row) <= 1.05 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= 1;

/** After a token's step: if it's hidden and an enemy sees it (as if it weren't hidden) or is right next to it, it's revealed; and any hidden enemy it has stepped right next to is too. */
export function revealAfterStep(levelId: number, tokenId: number): string[] {
  const told: string[] = [];
  const hidden = listHidden(levelId);
  const { me, enemies } = enemiesOf(levelId, tokenId);
  if (!me) return told;
  if (hidden.has(tokenId)) {
    const near = enemies.find((e) => nextTo(levelId, e, me));
    const seer = near ?? enemies.find((e) => seenFrom(levelId, { col: e.col, row: e.row }, e.id, { ignoreHidden: true }).has(tokenId));
    if (seer && reveal(levelId, tokenId, near ? `${tokenLabels(levelId).get(near.id)} is right next to them` : `seen moving by ${tokenLabels(levelId).get(seer.id)}`)) told.push("You're no longer hidden.");
  }
  for (const e of enemies) if (hidden.has(e.id) && nextTo(levelId, e, me)) reveal(levelId, e.id, `${tokenLabels(levelId).get(tokenId)} is right next to them`);
  return told;
}

/**
 * The enemies a token at `at` can see, as watchers: whether each would see it standing somewhere (walls and closed
 * doors, light and darkvision, blindness, invisibility), as if it weren't hidden. Only those it can see: it doesn't know
 * about the rest.
 */
export function knownWatchers(levelId: number, tokenId: number, at: { col: number; row: number }): Watcher[] {
  const tokens = listTokens(levelId), me = tokens.find((t) => t.id === tokenId);
  if (!me) return [];
  const seen = seenFrom(levelId, at, tokenId);
  const walls = blockingSegments(listStructures(levelId)), illumination = getIllumination(levelId), lights = listLights(levelId), mine = sensesOf(tokenId, levelId), fog = fogOn(levelId);
  return tokens
    .filter((t) => seen.has(t.id) && relation(allegianceOf(t), allegianceOf(me)) !== "friendly")
    .map((t) => {
      const s = sensesOf(t.id, levelId), from = { x: t.col + 0.5, y: t.row + 0.5 };
      const view = visibilityPolygon(from, s.blind ? s.blindRange : SIGHT, walls);
      return { id: t.id, sees: (p) => seesThem(s, mine) && insidePolygon(p, view) && !fogged(fog, from, p) && (s.blind || brightEnough(from, p, s.darkvision, illumination, lights, walls)) };
    });
}

/**
 * Where a token could hide from `at` with `feet` of movement: whether an enemy it can see sees it there now, and the
 * blind spots (from the enemies it can see) it could reach (cells; on gridless maps, whole units as an approximation).
 */
export function hidingPlaces(levelId: number, tokenId: number, at: { col: number; row: number }, feet: number): { seen: boolean; spots: { col: number; row: number }[] } {
  const watchers = knownWatchers(levelId, tokenId, at);
  const here = { col: Math.round(at.col), row: Math.round(at.row) };
  const reach = [...reachableSquares(here, Math.max(0, feet) / FEET_PER_SQUARE, moveBlockers(levelId)).values()].map((s) => ({ col: s.col, row: s.row }));
  const others = listTokens(levelId).filter((t) => t.id !== tokenId).map((t) => `${Math.round(t.col)},${Math.round(t.row)}`);
  return { seen: watched(at, watchers), spots: blindSpots(reach.filter((c) => !others.includes(`${c.col},${c.row}`)), watchers) };
}

/** Every enemy of a token, as watchers (not just those it can see): who would really see it somewhere. */
export function allWatchers(levelId: number, tokenId: number): Watcher[] {
  const tokens = listTokens(levelId), me = tokens.find((t) => t.id === tokenId);
  if (!me) return [];
  const walls = blockingSegments(listStructures(levelId)), illumination = getIllumination(levelId), lights = listLights(levelId), mine = sensesOf(tokenId, levelId), fog = fogOn(levelId);
  return tokens
    .filter((t) => t.id !== tokenId && relation(allegianceOf(t), allegianceOf(me)) !== "friendly")
    .map((t) => {
      const s = sensesOf(t.id, levelId), from = { x: t.col + 0.5, y: t.row + 0.5 };
      const view = visibilityPolygon(from, s.blind ? s.blindRange : SIGHT, walls);
      return { id: t.id, sees: (p) => seesThem(s, mine) && insidePolygon(p, view) && !fogged(fog, from, p) && (s.blind || brightEnough(from, p, s.darkvision, illumination, lights, walls)) };
    });
}

/**
 * The Stealth roll is in: hidden with that total, unless an enemy (any, known or not) sees them as they roll, which
 * fails it outright. Returns what they're told.
 */
export function settleHide(levelId: number, tokenId: number, total: number): { hidden: boolean; told: string } {
  const t = listTokens(levelId).find((x) => x.id === tokenId);
  if (!t) return { hidden: false, told: "You're not there any more." };
  const seer = allWatchers(levelId, tokenId).find((w) => w.sees({ x: t.col + 0.5, y: t.row + 0.5 }));
  const name = tokenLabels(levelId).get(tokenId) ?? "Someone";
  if (seer) {
    logSessionEvent(`${name} tries to hide, but ${tokenLabels(levelId).get(seer.id) ?? "someone"} can see them.`);
    return { hidden: false, told: "You try to hide, but someone can still see you." };
  }
  setHidden(tokenId, total);
  logSessionEvent(`${name} hides (Stealth ${total}).`);
  return { hidden: true, told: "You're hidden." };
}
