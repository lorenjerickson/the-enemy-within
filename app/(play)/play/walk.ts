import { listStructures, moveToken } from "@/lib/db";
import { fireTriggers } from "@/lib/game";
import { syncAurasOn } from "@/lib/auraSync";
import { linkEntered } from "@/lib/levelLinks";
import type { Point } from "@/lib/visibility";
import { trapsOnStep, trapsWhereStopped } from "./traps";
import { triggersOnStep, triggersWhereStopped } from "./mapTriggers";

/** How a walk out of an encounter went: the corners walked (start first), whether it was cut short, what the walker
 * learns (traps, triggers' doings to them), and a level link they stepped onto (they're asked whether to take it). */
export interface Walk {
  walked: Point[];
  stopped: boolean;
  told: string[];
  link?: { id: number; to: string };
}

/**
 * Walks a token out of an encounter along `route` (token corners, start first), a step at a time: each step can spring
 * traps, fire map triggers and game scripts' triggers, or come onto a level link, any of which can cut the walk short.
 * Where it ends, traps and triggers for ending a move in them get their turn. Auras are brought up to date after.
 */
export function walkRoute(levelId: number, tokenId: number, route: Point[]): Walk {
  const walked: Point[] = [route[0]];
  let stopped = false;
  let link: Walk["link"];
  const links = listStructures(levelId);
  const told: string[] = [];
  for (const step of route.slice(1)) {
    const from = walked[walked.length - 1];
    moveToken(tokenId, step.x, step.y); // also remembers what they saw from here
    walked.push(step);
    const sprung = trapsOnStep(levelId, tokenId, from, step);
    told.push(...sprung.map((t) => t.player));
    if (sprung.some((t) => t.stops)) { stopped = true; break; }
    const fired = triggersOnStep(levelId, tokenId, from, step); // map triggers: the walker learns only what they do to them
    for (const f of fired) told.push(...(f.told.get(tokenId) ?? []));
    if (fired.some((f) => f.stops)) { stopped = true; break; }
    if (fireTriggers().length) {
      stopped = true; // they aren't told which trigger (that's the GM's script)
      break;
    }
    const onto = linkEntered(links, from, step);
    if (onto) {
      stopped = true;
      link = { id: onto.id, to: links.find((l) => l.id === onto.id)?.target_name ?? "another level" };
      break;
    }
  }
  if (!stopped && walked.length > 1) {
    const end = walked[walked.length - 1];
    told.push(...trapsWhereStopped(levelId, tokenId, end).map((t) => t.player)); // ending a move in one
    for (const f of triggersWhereStopped(levelId, tokenId, end)) told.push(...(f.told.get(tokenId) ?? []));
  }
  syncAurasOn(levelId); // walked into (or out of) an aura
  return { walked, stopped, told, ...(link ? { link } : {}) };
}
