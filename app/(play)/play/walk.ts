import { getTokenMover, downTokens, getEncounter, isGridlessLevel, listStandingOrdersOn, listStructures, listTokens, moveToken, setLinkPrompt } from "@/lib/db";
import { standingRoute, walkLength } from "@/lib/standing";
import { revealAfterStep } from "./hiding";
import { speedFps } from "@/lib/creatureChanges";
import { movementBlockers } from "@/lib/visibility";
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
    told.push(...revealAfterStep(levelId, tokenId)); // hidden ones given away (moving into view, or right next to an enemy)
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

/**
 * Out of an encounter, after a token has moved `moved` (walkLength): whoever follows, pursues or evades it walks
 * (walkRoute: traps, triggers and level links as for anyone walking), then those following them, and so on (each
 * token once). A follower who comes onto a level link is asked whether to take it. Returns the walks, to play back.
 */
export function moveFollowers(levelId: number, leaderId: number, moved: number, done = new Set<number>()): { tokenId: number; route: Point[]; fps: number }[] {
  if (getEncounter(levelId)) return [];
  done.add(leaderId);
  const tokens = listTokens(levelId), leader = tokens.find((t) => t.id === leaderId);
  if (!leader) return [];
  const walls = movementBlockers(listStructures(levelId)), gridless = isGridlessLevel(levelId), down = downTokens(levelId);
  const walks: { tokenId: number; route: Point[]; fps: number }[] = [];
  for (const o of listStandingOrdersOn(leaderId)) {
    const t = tokens.find((x) => x.id === o.tokenId);
    if (!t || done.has(t.id) || down.has(t.id)) continue;
    done.add(t.id);
    const route = standingRoute(o.mode, { x: t.col, y: t.row }, { x: leader.col, y: leader.row }, moved, walls, gridless);
    if (route.length < 2) continue;
    const w = walkRoute(levelId, t.id, route);
    if (w.link) { const back = w.walked[w.walked.length - 2]; setLinkPrompt(t.id, w.link.id, { col: back.x, row: back.y }); }
    walks.push({ tokenId: t.id, route: w.walked, fps: speedFps(t.id, getTokenMover(t.id)?.movement ?? "{}") || 5 }); // at their own walking speed
    walks.push(...moveFollowers(levelId, t.id, walkLength(w.walked, gridless), done));
  }
  return walks;
}
