/**
 * Areas out of combat (lasting areas: a fire wall left after an encounter). There are no rounds, so a walk coming into
 * one catches the walker whatever its round timings say: its save, its damage, its effects on a failed save. Rounds
 * work lasting areas out in round resolution instead. A player's character rolls its own save (it's asked, and the
 * area lands when the roll comes in); the server rolls for the GM's creatures.
 */
import { setLastingAreaFound, getCharacterPlayer, getExposures, leaveAreaAfflictions, listLastingAreas, listStructures, listTokens, logSessionEvent, requestRoll, saveExposures } from "@/lib/db";
import { saveRollFor } from "@/lib/creatureChanges";
import { decayed, exposedInside, exposureExtra, harmOf } from "@/lib/exposure";
import { caughtBy, type LastingArea } from "@/lib/aoe";
import { fightersOn } from "@/lib/combat";
import { rollDice } from "@/lib/dice";
import { takeDamage, saveTokenHealth, tokenHealth } from "@/lib/health";
import { severity } from "@/lib/roundStory";
import { movementBlockers, type Point, type Segment } from "@/lib/visibility";
import { applyConditionNow } from "./workOutRound";

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre

/** A lasting area catches a token: the save, the damage (half or none on a success), effects on a failed save. Returns what they're told. */
export function catchInArea(levelId: number, l: LastingArea, tokenId: number, leaving = false, staying = false, saveTotal?: number): string {
  const doing = leaving ? ["leaves", "leave"] : staying ? ["is still in", "are still in"] : ["walks into", "walk into"];
  setLastingAreaFound(l.id); // hidden: walking into it finds it
  // A player's character rolls its own save: asked now, settled when the roll comes in (this again, with its total).
  const tok = listTokens(levelId).find((t) => t.id === tokenId), player = saveTotal === undefined && tok?.character_id ? getCharacterPlayer(tok.character_id) : null;
  if (player && tok?.character_id) {
    requestRoll(player, tok.character_id, saveRollFor(tokenId, l.save, `${l.name}: ${l.save} save (DC ${l.dc})`), { kind: "areaSave", levelId, areaId: l.id, tokenId, ...(leaving ? { leaving } : {}), ...(staying ? { staying } : {}) });
    return `You ${doing[1]} ${l.name}! Roll your ${l.save} save.`;
  }
  const exposures = l.lingers && !leaving ? getExposures(levelId) : null, extra = exposures ? exposureExtra(exposures, tokenId, harmOf(l)) : 0; // lingering: plus the build-up so far
  const whileIn = (l.fires ?? []).includes("inside") && !leaving; // its effects last while they're in it
  const name = listTokens(levelId).find((t) => t.id === tokenId)?.name ?? "Someone";
  const f = fightersOn(levelId).get(tokenId);
  const save = saveTotal !== undefined ? { total: saveTotal } : f ? f.save(l.save) : null;
  const saved = !!save && save.total >= l.dc;
  const gm: string[] = [save ? `${l.save} ${save.total} vs DC ${l.dc}${saved ? " (saved)" : ""}` : ""].filter(Boolean), you: string[] = [];
  const h = tokenHealth(tokenId);
  if (l.damage && h) {
    const rolled = Math.max(0, rollDice(l.damage)) + extra, n = saved ? (l.half ? Math.floor(rolled / 2) : 0) : rolled;
    if (exposures && n > 0) { exposedInside(exposures, tokenId, l, n); saveExposures(levelId, exposures); }
    if (n > 0) {
      const next = takeDamage(h, n);
      saveTokenHealth(tokenId, next);
      gm.push(`${n} damage${next.current <= 0 ? ", down" : ""}`);
      you.push(`${saved ? "you partly get clear but are" : "you're"} hurt: ${severity(n / Math.max(1, h.maximum))} (-${n})${next.current <= 0 ? ", and you go down" : ""}`);
    } else you.push(saved ? "you get clear" : "it does you no harm");
  } else if (saved) you.push("you get clear");
  if (!saved) for (const c of l.conditions ?? []) {
    const happened = applyConditionNow(levelId, tokenId, c, whileIn ? l.id : undefined);
    gm.push(`${c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`);
    you.push(`you're ${c.name.toLowerCase()}`);
  }
  logSessionEvent(`${name} ${doing[0]} ${l.name}${gm.length ? `: ${gm.join("; ")}` : ""}.`);
  return `You ${doing[1]} ${l.name}! ${you.join(", ").replace(/^./, (c) => c.toUpperCase())}.`;
}

/** Whether a step (token corners) comes into the area: outside where it starts, inside where it ends or halfway (a thin wall of fire stepped across). */
export function stepsInto(l: LastingArea, from: Point, to: Point, walls: Segment[]): boolean {
  const a = centre(from), b = centre(to), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return !caughtBy(l.area, a, walls) && (caughtBy(l.area, b, walls) || caughtBy(l.area, mid, walls));
}

/**
 * What a walk step does with lasting areas: coming into one catches the walker (unless it only catches those leaving
 * it); leaving one takes off what it put on them while inside, and catches them if it catches those leaving. What
 * they're told.
 */
export function areasOnStep(levelId: number, tokenId: number, from: Point, to: Point): string[] {
  const walls = movementBlockers(listStructures(levelId)), told: string[] = [];
  for (const l of listLastingAreas(levelId)) {
    const fires = l.fires ?? ["end"];
    if (stepsInto(l, from, to, walls)) {
      if (fires.some((f) => f !== "leave")) told.push(catchInArea(levelId, l, tokenId));
    } else if (caughtBy(l.area, centre(from), walls) && !caughtBy(l.area, centre(to), walls)) {
      const off = leaveAreaAfflictions(levelId, tokenId, l.id);
      if (off.length) told.push(`Out of ${l.name}, you're no longer ${off.map((n) => n.toLowerCase()).join(" or ")}.`);
      if (fires.includes("leave")) told.push(catchInArea(levelId, l, tokenId, true));
    }
  }
  return told;
}

/**
 * Another 6 s walked (an interval, out of combat): each lingering harm on the walker lands again: built up if they're
 * still in an area of that kind, else less by its decay, until it's gone. What they're told.
 */
export function exposureTick(levelId: number, tokenId: number, at: Point): string[] {
  const all = getExposures(levelId), list = all.get(tokenId);
  if (!list?.length) return [];
  const walls = movementBlockers(listStructures(levelId)), areas = listLastingAreas(levelId), told: string[] = [];
  for (const e of [...list]) {
    const inIt = areas.find((l) => l.lingers && harmOf(l) === e.kind && caughtBy(l.area, centre(at), walls));
    if (inIt) { told.push(catchInArea(levelId, inIt, tokenId, false, true)); continue; } // still in it: it lands again, built up
    const d = decayed(e), now = getExposures(levelId);
    now.set(tokenId, (now.get(tokenId) ?? []).flatMap((x) => (x.kind === e.kind ? (d.next ? [d.next] : []) : [x])));
    saveExposures(levelId, now);
    const h = tokenHealth(tokenId);
    if (!h || d.damage <= 0) continue;
    const next = takeDamage(h, d.damage);
    saveTokenHealth(tokenId, next);
    logSessionEvent(`${listTokens(levelId).find((t) => t.id === tokenId)?.name ?? "Someone"}: ${e.source} still hurts (${d.damage}).`);
    told.push(`${e.source} still hurts: ${severity(d.damage / Math.max(1, h.maximum))} (-${d.damage})${next.current <= 0 ? ", and you go down" : d.next ? "" : ", and it fades"}.`);
  }
  return told;
}
