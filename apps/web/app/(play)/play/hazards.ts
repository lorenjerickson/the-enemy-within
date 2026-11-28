/**
 * Dormant hazards outside rounds (backlog X, claude/hazards-design.md): a step or a stop that sets one off springs it
 * (remembered, active for its time, spent if once, seen by whoever saw it), then it lands like a trap did (its damage
 * save or its effects' own saves as one throw; the player rolls). Always-active hazards catch walkers in areas.ts.
 */
import { getLastingArea, listLastingAreas } from "@/lib/db/areas";

import { listStructures } from "@/lib/db/maps";
import { listTokens } from "@/lib/db/tokens";
import { logSessionEvent } from "@/lib/db/sessions";
import { resistancesOf } from "@/lib/creatureChanges";
import { afterResist, combineResist, type Condition } from "@/lib/conditions";
import { rollDice } from "@/lib/dice";
import { takeDamage, saveTokenHealth, tokenHealth } from "@/lib/health";
import { severity } from "@/lib/roundStory";
import type { Attribute } from "@/lib/attributes";
import type { RollAction } from "@/lib/db/rolls";
import { applyConditionNow, effectCheck, landsOn, throwFor, type Check } from "./workOutRound";
import { NO_SAVE_DC, caughtBy } from "@/lib/aoe";
import { mayCatch, setsOff, type Hazard } from "@/lib/hazards";

import { allegianceOf } from "@/lib/sides";
import { movementBlockers, type Point } from "@/lib/visibility";
import { areasOnStep, stepsInto } from "./areas";
import { markHazardSprung } from "./hazardSprung";

/** What springing does, whatever sprang (a trap, a dormant hazard): its damage and save against it, its effects, whether it stops them. */
export type SpringSpec = { name: string; damage: string | null; damageType: string; saveAttr: string; dc: number; half: boolean; effects: Condition[]; stops: boolean };

/**
 * Something sprang on a token: its checks (its damage save; or, without one, its effects' own saves) are one throw (a
 * player is asked and it lands when the roll comes in: this again, with `rolled`; the GM's creatures roll now), then
 * its damage and effects land. What the GM's log and the player are told.
 */
export function landSprung(levelId: number, tokenId: number, t: SpringSpec, action: RollAction, rolled?: number): { gm: string; player: string } {
  const name = listTokens(levelId).find((x) => x.id === tokenId)?.name ?? "Someone";
  const hasSave = !!t.saveAttr && !!t.damage && t.dc < NO_SAVE_DC, attr = t.saveAttr as Attribute;
  const checks: Check[] = hasSave ? [{ attr, dc: t.dc, decides: t.half ? "halves the damage" : "avoids the damage" }] : t.effects.flatMap(effectCheck);
  const totalOf = throwFor(levelId, tokenId, t.name, checks, action, rolled);
  if (!totalOf) {
    const line = `${name} sets off ${t.name} (waiting for their roll).`;
    logSessionEvent(line);
    return { gm: line, player: `You set off a trap (${t.name})! Roll your ${checks[0].attr} save.${t.stops ? " You stop where you are." : ""}` };
  }
  const save = hasSave ? { total: totalOf(attr) } : null;
  const saved = !!save && save.total >= t.dc;
  const gm: string[] = [], you: string[] = [];
  if (save) gm.push(`${t.saveAttr} ${save.total} vs DC ${t.dc}${saved ? " (saved)" : ""}`);
  const h = tokenHealth(tokenId);
  if (t.damage && h) {
    const dice = Math.max(0, rollDice(t.damage)), before = saved ? (t.half ? Math.floor(dice / 2) : 0) : dice;
    const r = t.damageType ? combineResist(resistancesOf(tokenId, levelId)[t.damageType]) : null, n = afterResist(before, r);
    if (n > 0) {
      const next = takeDamage(h, n);
      saveTokenHealth(tokenId, next);
      gm.push(`${n}${t.damageType ? ` ${t.damageType}` : ""} damage${r ? ` (${r})` : ""}${next.current <= 0 ? ", down" : ""}`);
      you.push(`${saved ? "you partly get clear but are" : "you're"} hurt: ${severity(n / Math.max(1, h.maximum))} (-${n})${next.current <= 0 ? ", and you go down" : ""}`);
    } else you.push(saved ? "you get clear" : "it does you no harm");
  } else if (saved) you.push("you get clear");
  // Effects hang off its damage save when it has one (they land if the damage did, no saves of their own); else each rolls its own.
  const hangs = hasSave, lands = !hangs || !saved || t.half;
  if (lands) for (const found of t.effects) {
    const { c, note } = hangs ? { c: found, note: "" } : landsOn(tokenId, found, totalOf); // else the effect's own save, from the same throw
    if (!c) { gm.push(note); you.push(`you shake off ${found.name.toLowerCase()}`); continue; }
    const happened = applyConditionNow(levelId, tokenId, c);
    gm.push(`${note || c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`);
    you.push(`you're ${c.name.toLowerCase()}`);
  }
  if (t.stops) you.push("you stop where you are");
  const line = `${name} sets off ${t.name}${gm.length ? `: ${gm.join("; ")}` : ""}.`;
  logSessionEvent(line);
  return { gm: line, player: `You set off a trap (${t.name})! ${you.join(", ").replace(/^./, (c) => c.toUpperCase()) || "Nothing seems to happen"}.` };
}

export interface HazardSprung { hazard: Hazard; tokenId: number; stops: boolean; gm: string; player: string }

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre

/** A dormant hazard springs on a token (`rolled`: their throw, when it comes in, then it lands). */
export function springHazard(levelId: number, h: Hazard, tokenId: number, rolled?: number): HazardSprung {
  if (rolled === undefined) markHazardSprung(levelId, h, tokenId);
  return landHazard(levelId, h, tokenId, rolled);
}

/**
 * A map trigger sets a dormant hazard off: it springs on whoever is in it and it's for (remembered all at once), and
 * goes off (seen, spent if once) even with no one in it. What each one caught is told.
 */
export function setOffHazard(levelId: number, h: Hazard): HazardSprung[] {
  const walls = movementBlockers(listStructures(levelId));
  const caught = listTokens(levelId).filter((t) => mayCatch(h, t.id, allegianceOf(t)) && caughtBy(h.area, centre({ x: t.col, y: t.row }), walls)).map((t) => t.id);
  markHazardSprung(levelId, h, caught);
  if (!caught.length) logSessionEvent(`${h.name} goes off, catching no one.`);
  return caught.map((id) => landHazard(levelId, h, id));
}

/** A sprung hazard lands on a token: its damage save or its effects' own saves as one throw (the player rolls), then its damage and effects. */
function landHazard(levelId: number, h: Hazard, tokenId: number, rolled?: number): HazardSprung {
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
