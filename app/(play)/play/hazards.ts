/**
 * Dormant hazards outside rounds (backlog X, claude/hazards-design.md): a step or a stop that sets one off springs it
 * (remembered, active for its time, spent if once, seen by whoever saw it), then it lands like a trap did (its damage
 * save or its effects' own saves as one throw; the player rolls). Always-active hazards catch walkers in areas.ts.
 */
import { getLastingArea, listLastingAreas, updateLastingArea } from "@/lib/db/areas";
import { getGameTime } from "@/lib/db/calendar";
import { listStructures } from "@/lib/db/maps";
import { listTokens } from "@/lib/db/tokens";
import { NO_SAVE_DC, caughtBy } from "@/lib/aoe";
import { mayCatch, setsOff, spring, type Hazard } from "@/lib/hazards";
import { seesSpot } from "@/lib/sight";
import { allegianceOf } from "@/lib/sides";
import { movementBlockers, type Point } from "@/lib/visibility";
import { areasOnStep, stepsInto } from "./areas";
import { landSprung } from "./traps";

export interface HazardSprung { hazard: Hazard; tokenId: number; stops: boolean; gm: string; player: string }

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre
/** Where a hazard is, for who saw it go off: its middle (a line's midpoint). */
const middle = (h: Hazard) => (h.area.shape === "line" ? { x: h.area.origin.x + (Math.cos(h.area.dir) * h.area.size) / 2, y: h.area.origin.y + (Math.sin(h.area.dir) * h.area.size) / 2 } : h.area.origin);

/** A dormant hazard springs on a token (`rolled`: their throw, when it comes in, then it lands). */
export function springHazard(levelId: number, h: Hazard, tokenId: number, rolled?: number): HazardSprung {
  if (rolled === undefined) {
    const saw = listTokens(levelId).filter((t) => t.character_id !== null && (t.id === tokenId || seesSpot(levelId, t.id, middle(h)))).map((t) => t.id);
    const { id, ...next } = spring(h, [tokenId], getGameTime());
    updateLastingArea(id, { ...next, seenBy: [...new Set([...(h.seenBy ?? []), ...saw])] });
  }
  const r = landSprung(levelId, tokenId, { name: h.name, damage: h.damage, damageType: h.damageType ?? "", saveAttr: h.dc < NO_SAVE_DC ? h.save : "", dc: h.dc, half: h.half, effects: h.conditions ?? [], stops: !!h.stops }, { kind: "hazardSave", levelId, hazardId: h.id, tokenId }, rolled);
  return { hazard: h, tokenId, stops: !!h.stops, ...r };
}

/** Settling a player's throw for a hazard that sprang on them. */
export function hazardRolled(levelId: number, hazardId: number, tokenId: number, total: number): string {
  const h = getLastingArea(hazardId) as Hazard | undefined;
  return h ? springHazard(levelId, h, tokenId, total).player : "It's gone.";
}

const dormant = (levelId: number) => (listLastingAreas(levelId) as Hazard[]).filter((h) => h.activation === "dormant");

/** The dormant hazards a token's step (token corners, grid units) sets off, sprung now, in order. */
export function hazardsOnStep(levelId: number, tokenId: number, from: Point, to: Point): HazardSprung[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  const walls = movementBlockers(listStructures(levelId)), side = allegianceOf(token);
  return dormant(levelId).filter((h) => setsOff(h, "enter") && mayCatch(h, tokenId, side) && stepsInto(h, from, to, walls)).map((h) => springHazard(levelId, h, tokenId));
}

/** The dormant hazards that a token ending its move where it stands sets off, sprung now. */
export function hazardsWhereStopped(levelId: number, tokenId: number, at: Point): HazardSprung[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  const walls = movementBlockers(listStructures(levelId)), side = allegianceOf(token);
  return dormant(levelId).filter((h) => setsOff(h, "end") && mayCatch(h, tokenId, side) && caughtBy(h.area, centre(at), walls)).map((h) => springHazard(levelId, h, tokenId));
}

/**
 * One step of a walk through every hazard on the level: dormant ones it sets off spring (and may stop the walk); if it
 * goes on, active ones it comes into, or leaves, catch the walker (areas.ts). What they're told, and whether it stops.
 */
export function hazardsStep(levelId: number, tokenId: number, from: Point, to: Point): { told: string[]; stops: boolean } {
  const sprung = hazardsOnStep(levelId, tokenId, from, to), told = sprung.map((s) => s.player);
  if (sprung.some((s) => s.stops)) return { told, stops: true };
  return { told: [...told, ...areasOnStep(levelId, tokenId, from, to)], stops: false };
}
