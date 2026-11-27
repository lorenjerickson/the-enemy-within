/**
 * Springing traps outside rounds (free movement): the save, the damage, the effects, and what the GM's log and the
 * player are told. Rounds spring traps in round resolution instead. Saves are rolled by the server for now.
 */
import { getCondition } from "@/lib/db/effects";
import { listTokens } from "@/lib/db/tokens";
import { listTraps, markTrapSprung } from "@/lib/db/traps";
import { logSessionEvent } from "@/lib/db/sessions";
import { fightersOn } from "@/lib/combat";
import { resistancesOf } from "@/lib/creatureChanges";
import { afterResist, combineResist, type Condition } from "@/lib/conditions";
import { NO_SAVE_DC } from "@/lib/aoe";
import type { RollAction } from "@/lib/db/rolls";
import { rollDice } from "@/lib/dice";
import { takeDamage, saveTokenHealth, tokenHealth } from "@/lib/health";
import { severity } from "@/lib/roundStory";
import { allegianceOf } from "@/lib/sides";
import { canSpring, inTrap, sprungByStep, sprungWhereStanding, type Trap } from "@/lib/traps";
import type { Point } from "@/lib/visibility";
import { applyConditionNow, effectCheck, landsOn, throwFor, witnessTrap, type Check } from "./workOutRound";
import type { Attribute } from "@/lib/attributes";

export interface Sprung {
  trap: Trap;
  tokenId: number; // whom it sprang on
  stops: boolean;
  gm: string; // for the GM's log, with the numbers
  player: string; // for whoever set it off: how bad, and their own damage
}

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

/** A trap springs on a token: it's spent (for them), whoever saw it knows it's there, and it lands (`landSprung`). */
export function springTrap(levelId: number, trap: Trap, tokenId: number, rolled?: number): Sprung {
  if (rolled === undefined) {
    markTrapSprung(trap.id, tokenId);
    witnessTrap(levelId, trap, [tokenId]); // no secret any more to whoever saw it
  }
  const effects = trap.effects.flatMap((id) => { const c = getCondition(id); return c ? [c] : []; });
  const r = landSprung(levelId, tokenId, { name: trap.name, damage: trap.damage, damageType: trap.damage_type, saveAttr: trap.save_attr, dc: trap.save_dc, half: !!trap.save_half, effects, stops: !!trap.stops }, { kind: "trapSave", levelId, trapId: trap.id, tokenId }, rolled);
  return { trap, tokenId, stops: !!trap.stops, ...r };
}

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre

/** The traps a token's step (token corners, grid units) springs, sprung now, in order. */
export function trapsOnStep(levelId: number, tokenId: number, from: Point, to: Point): Sprung[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  return sprungByStep(listTraps(levelId), tokenId, allegianceOf(token), centre(from), centre(to)).map((t) => springTrap(levelId, t, tokenId));
}

/** The traps that spring on a token ending its move where it stands (token corner, grid units), sprung now. */
export function trapsWhereStopped(levelId: number, tokenId: number, at: Point): Sprung[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  return sprungWhereStanding(listTraps(levelId), tokenId, allegianceOf(token), centre(at), "end").map((t) => springTrap(levelId, t, tokenId));
}

/**
 * A trigger sets a trap off (whatever its own "when"): it springs on everyone in it it's for (and isn't spent for), and
 * it's found. With no one in it, it still goes off (spent, if it's a once-only trap).
 */
export function setOffTrap(levelId: number, trapId: number): Sprung[] {
  const trap = listTraps(levelId).find((t) => t.id === trapId);
  if (!trap) return [];
  const caught = listTokens(levelId).filter((t) => canSpring(trap, t.id, allegianceOf(t)) && inTrap(trap.area, centre({ x: t.col, y: t.row })));
  witnessTrap(levelId, trap, caught.map((t) => t.id));
  if (!caught.length) {
    markTrapSprung(trap.id, 0); // gone off, on no one
    logSessionEvent(`${trap.name} goes off, catching no one.`);
    return [];
  }
  return caught.map((t) => springTrap(levelId, { ...trap, sprung: [] }, t.id));
}
