import { getTokenMover, downTokens, listStandingOrdersOn, listTokens, moveToken, setLinkPrompt } from "@/lib/db/tokens";
import { getEncounter } from "@/lib/db/encounters";
import { isGridlessLevel, listStructures } from "@/lib/db/maps";
import { pointAlong, routeTimes, standingRoute, truncateRoute, walkLength, type StandingMode } from "@/lib/standing";
import { revealAfterStep } from "./hiding";
import { speedFps } from "@/lib/creatureChanges";
import { movementBlockers } from "@/lib/visibility";
import { fireTriggers } from "@/lib/game";
import { syncAurasOn } from "@/lib/auraSync";
import { linkEntered } from "@/lib/levelLinks";
import type { Point } from "@/lib/visibility";
import { hazardsStep, hazardsWhereStopped } from "./hazards";
import { triggersOnStep, triggersWhereStopped } from "./mapTriggers";
import { exposureTick } from "./areas";

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
 * traps, walk into lasting areas, fire map triggers and game scripts' triggers, or come onto a level link, any of which can cut the walk short.
 * Where it ends, traps and triggers for ending a move in them get their turn. Auras are brought up to date after.
 */
export function walkRoute(levelId: number, tokenId: number, route: Point[]): Walk {
  const walked: Point[] = [route[0]];
  let stopped = false;
  let link: Walk["link"];
  const links = listStructures(levelId);
  const told: string[] = [];
  const fps = speedFps(tokenId, getTokenMover(tokenId)?.movement ?? "{}") || 5; // for how long the walk takes: lingering harm lands every 6 s of it
  let seconds = 0;
  for (const step of route.slice(1)) {
    const from = walked[walked.length - 1];
    moveToken(tokenId, step.x, step.y); // also remembers what they saw from here
    walked.push(step);
    told.push(...revealAfterStep(levelId, tokenId)); // hidden ones given away (moving into view, or right next to an enemy)
    const hz = hazardsStep(levelId, tokenId, from, step); // hazards: dormant ones set off, active ones (a fire wall) catching
    told.push(...hz.told);
    if (hz.stops) { stopped = true; break; }
    const was = seconds;
    seconds += (Math.hypot(step.x - from.x, step.y - from.y) * 5) / fps;
    for (let k = Math.floor(was / 6); k < Math.floor(seconds / 6); k++) told.push(...exposureTick(levelId, tokenId, step)); // each 6 s walked: still burning…
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
    told.push(...hazardsWhereStopped(levelId, tokenId, end).map((t) => t.player)); // ending a move in one
    for (const f of triggersWhereStopped(levelId, tokenId, end)) told.push(...(f.told.get(tokenId) ?? []));
  }
  syncAurasOn(levelId); // walked into (or out of) an aura
  return { walked, stopped, told, ...(link ? { link } : {}) };
}

/** A walk to play back: its route (corners, start first) and the seconds from the start at each point (real time). */
export interface TimedWalk {
  tokenId: number;
  route: Point[];
  times: number[];
}

/**
 * Out of an encounter: a token walks `route` at `fps` feet per second (or, with `walked`, has already got there, as
 * when the GM drags it), and everyone with a standing order on it, then on them and so on, moves alongside it second
 * by second at their own walking speed: Follow toward them as far as they went that second, Pursue as fast as they
 * can until next to them, Evade away as far as they went (each never faster than their own speed). Every step goes
 * through walkRoute (traps, triggers, level links). Returns the leader's walk and every walk with its timing.
 */
export function walkWithFollowers(levelId: number, leaderId: number, route: Point[], fps: number, walked?: Point[]): { leader: Walk; walks: TimedWalk[] } {
  const gridless = isGridlessLevel(levelId);
  const leader: Walk = walked ? { walked, stopped: false, told: [] } : walkRoute(levelId, leaderId, route);
  const path = leader.walked, speed = Math.max(0.01, fps);
  const walks: TimedWalk[] = path.length > 1 ? [{ tokenId: leaderId, route: path, times: routeTimes(path, speed, gridless) }] : [];
  if (getEncounter(levelId) || path.length < 2) return { leader, walks };
  const tokens = listTokens(levelId), down = downTokens(levelId), walls = movementBlockers(listStructures(levelId));
  // Who moves, in order: those on the leader first, then those on them (each once).
  const order: { id: number; target: number; mode: StandingMode; units: number }[] = [];
  const done = new Set([leaderId]);
  for (let i = -1; i < order.length; i++) {
    const on = i < 0 ? leaderId : order[i].id;
    for (const o of listStandingOrdersOn(on)) {
      if (done.has(o.tokenId) || down.has(o.tokenId) || !tokens.some((t) => t.id === o.tokenId)) continue;
      done.add(o.tokenId);
      order.push({ id: o.tokenId, target: on, mode: o.mode, units: (speedFps(o.tokenId, getTokenMover(o.tokenId)?.movement ?? "{}") || 0) / 5 });
    }
  }
  const pos = new Map<number, Point>(tokens.map((t) => [t.id, { x: t.col, y: t.row }]));
  const trail = new Map(order.map((f) => [f.id, { route: [pos.get(f.id)!], times: [0] }]));
  const bank = new Map(order.map((f) => [f.id, 0])), stopped = new Set<number>();
  const length = walkLength(path, gridless), seconds = Math.ceil((length * 5) / speed - 1e-9);
  const gap = (a: Point, b: Point) => (gridless ? Math.hypot(a.x - b.x, a.y - b.y) : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
  pos.set(leaderId, path[0]);
  for (let sec = 1; sec <= seconds; sec++) {
    const before = new Map(pos);
    pos.set(leaderId, pointAlong(path, Math.min(length, (speed * sec) / 5), gridless));
    for (const f of order) {
      if (stopped.has(f.id)) continue;
      const here = pos.get(f.id)!, was = before.get(f.target)!, now = pos.get(f.target)!;
      const budget = bank.get(f.id)! + f.units, moved = gap(was, now);
      const cap = f.mode === "pursue" ? budget : Math.min(moved, budget);
      let r = standingRoute(f.mode, here, now, f.mode === "pursue" ? budget : moved, walls, gridless);
      r = truncateRoute(r, cap, gridless);
      const used = walkLength(r, gridless);
      bank.set(f.id, gridless ? 0 : Math.max(0, budget - used) % 1); // only a part square carries over (7 ft/s: a square, a square, then two)
      if (r.length < 2) continue;
      const w = walkRoute(levelId, f.id, r);
      if (w.link) { const back = w.walked[w.walked.length - 2]; setLinkPrompt(f.id, w.link.id, { col: back.x, row: back.y }); }
      if (w.stopped) stopped.add(f.id);
      const t = trail.get(f.id)!, steps = w.walked.slice(1), len = walkLength(w.walked, gridless) || 1;
      let so = 0;
      steps.forEach((p, i) => { so += walkLength([w.walked[i], p], gridless); t.route.push(p); t.times.push(sec - 1 + so / len); });
      pos.set(f.id, w.walked[w.walked.length - 1]);
    }
  }
  for (const f of order) { const t = trail.get(f.id)!; if (t.route.length > 1) walks.push({ tokenId: f.id, ...t }); }
  return { leader, walks };
}
