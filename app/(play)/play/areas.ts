/**
 * Areas out of combat (lasting areas: a fire wall left after an encounter). There are no rounds, so a walk coming into
 * one catches the walker whatever its round timings say: its save, its damage, its effects on a failed save. Rounds
 * work lasting areas out in round resolution instead. Saves are rolled by the server for now (players rolling their
 * own: the areas design, build step 5).
 */
import { listLastingAreas, listStructures, listTokens, logSessionEvent } from "@/lib/db";
import { caughtBy, type LastingArea } from "@/lib/aoe";
import { fightersOn } from "@/lib/combat";
import { rollDice } from "@/lib/dice";
import { takeDamage, saveTokenHealth, tokenHealth } from "@/lib/health";
import { severity } from "@/lib/roundStory";
import { movementBlockers, type Point, type Segment } from "@/lib/visibility";
import { applyConditionNow } from "./workOutRound";

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre

/** A lasting area catches a token: the save, the damage (half or none on a success), effects on a failed save. Returns what they're told. */
export function catchInArea(levelId: number, l: LastingArea, tokenId: number): string {
  const name = listTokens(levelId).find((t) => t.id === tokenId)?.name ?? "Someone";
  const f = fightersOn(levelId).get(tokenId);
  const save = f ? f.save(l.save) : null;
  const saved = !!save && save.total >= l.dc;
  const gm: string[] = [save ? `${l.save} ${save.total} vs DC ${l.dc}${saved ? " (saved)" : ""}` : ""].filter(Boolean), you: string[] = [];
  const h = tokenHealth(tokenId);
  if (l.damage && h) {
    const rolled = Math.max(0, rollDice(l.damage)), n = saved ? (l.half ? Math.floor(rolled / 2) : 0) : rolled;
    if (n > 0) {
      const next = takeDamage(h, n);
      saveTokenHealth(tokenId, next);
      gm.push(`${n} damage${next.current <= 0 ? ", down" : ""}`);
      you.push(`${saved ? "you partly get clear but are" : "you're"} hurt: ${severity(n / Math.max(1, h.maximum))} (-${n})${next.current <= 0 ? ", and you go down" : ""}`);
    } else you.push(saved ? "you get clear" : "it does you no harm");
  } else if (saved) you.push("you get clear");
  if (!saved) for (const c of l.conditions ?? []) {
    const happened = applyConditionNow(levelId, tokenId, c);
    gm.push(`${c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`);
    you.push(`you're ${c.name.toLowerCase()}`);
  }
  logSessionEvent(`${name} walks into ${l.name}${gm.length ? `: ${gm.join("; ")}` : ""}.`);
  return `You walk into ${l.name}! ${you.join(", ").replace(/^./, (c) => c.toUpperCase())}.`;
}

/** Whether a step (token corners) comes into the area: outside where it starts, inside where it ends or halfway (a thin wall of fire stepped across). */
export function stepsInto(l: LastingArea, from: Point, to: Point, walls: Segment[]): boolean {
  const a = centre(from), b = centre(to), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return !caughtBy(l.area, a, walls) && (caughtBy(l.area, b, walls) || caughtBy(l.area, mid, walls));
}

/** The lasting areas a walk step comes into, each catching the walker; what they're told. */
export function areasOnStep(levelId: number, tokenId: number, from: Point, to: Point): string[] {
  const walls = movementBlockers(listStructures(levelId));
  return listLastingAreas(levelId).filter((l) => stepsInto(l, from, to, walls)).map((l) => catchInArea(levelId, l, tokenId));
}
