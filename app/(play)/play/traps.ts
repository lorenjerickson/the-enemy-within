/**
 * Springing traps outside rounds (free movement): the save, the damage, the effects, and what the GM's log and the
 * player are told. Rounds spring traps in round resolution instead. Saves are rolled by the server for now.
 */
import { getCondition, listTokens, listTraps, logSessionEvent, markTrapSprung, setTrapFound } from "@/lib/db";
import { fightersOn } from "@/lib/combat";
import { resistancesOf } from "@/lib/creatureChanges";
import { afterResist, combineResist } from "@/lib/conditions";
import { rollDice } from "@/lib/dice";
import { takeDamage, saveTokenHealth, tokenHealth } from "@/lib/health";
import { severity } from "@/lib/roundStory";
import { allegianceOf } from "@/lib/sides";
import { sprungByStep, sprungWhereStanding, type Trap } from "@/lib/traps";
import type { Point } from "@/lib/visibility";
import { applyConditionNow } from "./workOutRound";

export interface Sprung {
  trap: Trap;
  stops: boolean;
  gm: string; // for the GM's log, with the numbers
  player: string; // for whoever set it off: how bad, and their own damage
}

/** A trap springs on a token: it's spent (for them), it's found, and its save, damage and effects land. */
export function springTrap(levelId: number, trap: Trap, tokenId: number): Sprung {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  const name = token?.name ?? "Someone";
  markTrapSprung(trap.id, tokenId);
  setTrapFound(trap.id, true); // once it has gone off, it's no secret
  const f = fightersOn(levelId).get(tokenId);
  const save = trap.save_attr && f ? f.save(trap.save_attr as never) : null;
  const saved = !!save && save.total >= trap.save_dc;
  const gm: string[] = [], you: string[] = [];
  if (save) gm.push(`${trap.save_attr} ${save.total} vs DC ${trap.save_dc}${saved ? " (saved)" : ""}`);
  const h = tokenHealth(tokenId);
  if (trap.damage && h) {
    const rolled = Math.max(0, rollDice(trap.damage)), before = saved ? (trap.save_half ? Math.floor(rolled / 2) : 0) : rolled;
    const r = trap.damage_type ? combineResist(resistancesOf(tokenId, levelId)[trap.damage_type]) : null, n = afterResist(before, r);
    if (n > 0) {
      const next = takeDamage(h, n);
      saveTokenHealth(tokenId, next);
      gm.push(`${n}${trap.damage_type ? ` ${trap.damage_type}` : ""} damage${r ? ` (${r})` : ""}${next.current <= 0 ? ", down" : ""}`);
      you.push(`${saved ? "you partly get clear but are" : "you're"} hurt: ${severity(n / Math.max(1, h.maximum))} (-${n})${next.current <= 0 ? ", and you go down" : ""}`);
    } else you.push(saved ? "you get clear" : "it does you no harm");
  } else if (saved) you.push("you get clear");
  if (!saved) for (const id of trap.effects) {
    const c = getCondition(id);
    if (!c) continue;
    const happened = applyConditionNow(levelId, tokenId, c);
    gm.push(`${c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`);
    you.push(`you're ${c.name.toLowerCase()}`);
  }
  if (trap.stops) you.push("you stop where you are");
  logSessionEvent(`${name} sets off ${trap.name}${gm.length ? `: ${gm.join("; ")}` : ""}.`);
  return { trap, stops: !!trap.stops, gm: `${name} sets off ${trap.name}${gm.length ? `: ${gm.join("; ")}` : ""}.`, player: `You set off a trap (${trap.name})! ${you.join(", ").replace(/^./, (c) => c.toUpperCase()) || "Nothing seems to happen"}.` };
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
