/**
 * Springing traps outside rounds (free movement): the save, the damage, the effects, and what the GM's log and the
 * player are told. Rounds spring traps in round resolution instead. Saves are rolled by the server for now.
 */
import { getCondition } from "@/lib/db/effects";
import { listTokens } from "@/lib/db/tokens";
import { listTraps, markTrapSprung } from "@/lib/db/traps";
import { logSessionEvent } from "@/lib/db/sessions";

import { allegianceOf } from "@/lib/sides";
import { canSpring, inTrap, sprungByStep, sprungWhereStanding, type Trap } from "@/lib/traps";
import type { Point } from "@/lib/visibility";
import { witnessTrap } from "./workOutRound";

import { landSprung } from "./hazards";

export interface Sprung {
  trap: Trap;
  tokenId: number; // whom it sprang on
  stops: boolean;
  gm: string; // for the GM's log, with the numbers
  player: string; // for whoever set it off: how bad, and their own damage
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
