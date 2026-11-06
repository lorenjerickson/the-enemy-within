import { FEET_PER_SQUARE, clearPath, reachableSquares, routeTo, shortestPath, squareKey } from "@/lib/movement";
import { ACTION_RANGE, CHASE_ACTIONS } from "@/lib/playerActions";
import { ROUND_SECONDS, timeline, type PlanStep } from "@/lib/roundPlan";
import type { Segment } from "@/lib/visibility";

type Pos = { col: number; row: number };

/** Someone (or something) taking part in the round. */
export interface Mover {
  tokenId: number;
  name: string;
  initiative: number; // tie breaker only; not rolled yet = lowest
  start: Pos;
  plan: PlanStep[];
  walking: number; // feet per round
}

/** Where a plan puts a mover at time t (seconds into the round), ignoring everyone else. */
function planner(m: Mover, walls: Segment[], gridless: boolean): (t: number) => Pos {
  const legs: { start: number; end: number; points: Pos[] }[] = [];
  let at = m.start;
  for (const s of timeline(m.plan, m.walking).steps) {
    if (s.step.kind !== "move") continue;
    const to = s.step.to;
    let points: Pos[];
    if (gridless) points = [at, to];
    else {
      const reach = reachableSquares(at, s.step.feet / FEET_PER_SQUARE, walls);
      points = reach.has(squareKey(to.col, to.row)) ? routeTo(reach, squareKey(to.col, to.row)) : [at, to];
    }
    legs.push({ start: s.start, end: s.end, points });
    at = to;
  }
  return (t) => {
    let pos = m.start;
    for (const leg of legs) {
      if (t <= leg.start) break;
      const f = Math.min(1, (t - leg.start) / Math.max(1e-9, leg.end - leg.start));
      if (gridless) {
        const [a, b] = leg.points;
        pos = { col: Math.round((a.col + (b.col - a.col) * f) * 20) / 20, row: Math.round((a.row + (b.row - a.row) * f) * 20) / 20 };
      } else {
        pos = leg.points[Math.floor(f * (leg.points.length - 1) + 1e-9)];
      }
    }
    return pos;
  };
}

/** One second of a resolved round, for playback. */
export interface ReplayFrame {
  sec: number;
  pos: Record<number, Pos>;
  down: number[];
  lines: string[];
}

/** A resolved round to play back: frames shown one a second from `starts` (ms since epoch). */
export interface Replay {
  round: number;
  starts: number;
  start: Record<number, Pos>; // where everyone was before the round
  frames: ReplayFrame[];
}

/** What resolving needs to settle an attack (see lib/combat.ts for the rules). */
export interface Combatant {
  hp: number;
  attack: () => { total: number; text: string };
  defense: () => { total: number; text: string };
  damage: () => { total: number; text: string };
}

/**
 * Resolves a round second by second. Movement: evaluation (each mover's proposed spot at the end of the second),
 * reconciliation (in initiative order, nobody ends a second where someone already is; the loser is held back a
 * second), result (positions applied). Then actions finishing that second, in initiative order: an attack hits if
 * its target is still in reach (1 square) and the roll beats their defense; an attacker hit while their action is
 * under way loses it; anyone down (0 health) does nothing more. Other actions only log for now.
 * Returns final spots, health and a log.
 */
export function resolveMovement(
  movers: Mover[],
  bystanders: { tokenId: number; name: string; at: Pos }[],
  walls: Segment[],
  gridless: boolean,
  fighters: Map<number, Combatant> = new Map(),
) {
  const order = [...movers].sort((a, b) => b.initiative - a.initiative);
  const wants = new Map(order.map((m) => [m.tokenId, planner(m, walls, gridless)]));
  const lag = new Map(order.map((m) => [m.tokenId, 0])); // seconds each has been held back
  const pos = new Map(order.map((m) => [m.tokenId, m.start]));
  const same = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) < 0.9 : a.col === b.col && a.row === b.row);
  const log: string[] = [];
  // Each mover's actions in its own plan time. An action finishes when the mover's plan clock (seconds minus the
  // seconds it was held back or spent closing in) passes its end; order within a second = initiative order.
  type Act = { start: number; end: number; step: Extract<PlanStep, { kind: "action" }> };
  const acts = new Map<number, Act[]>(
    order.map((m) => [
      m.tokenId,
      timeline(m.plan, m.walking).steps.flatMap((s) => (s.step.kind === "action" ? [{ start: s.start, end: s.end, step: s.step }] : [])),
    ])
  );
  const finished = new Set<Act>();
  const begun = new Set<Act>(); // ranged actions that started in reach (no more closing in for them)
  const hp = new Map([...fighters].map(([id, f]) => [id, f.hp]));
  const down = new Set([...hp].filter(([, h]) => h <= 0).map(([id]) => id));
  const hitAt = new Map<number, number[]>(); // seconds each was hit in
  const where = (id: number) => pos.get(id) ?? bystanders.find((b) => b.tokenId === id)?.at;
  const inReach = (a: Pos, b: Pos, range = 1) =>
    (gridless ? Math.hypot(a.col - b.col, a.row - b.row) <= range + 0.5 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= range) &&
    clearPath({ x: a.col + 0.5, y: a.row + 0.5 }, { x: b.col + 0.5, y: b.row + 0.5 }, walls); // not through a wall

  // What each second ended with, for playing the round back: everyone's spot, who's down, and what happened.
  const frames: ReplayFrame[] = [];
  // Evade / Pursue: from when each starts (in its own plan time), its target, and whether it's over (within 5 ft).
  const chases = new Map<number, { start: number; action: string; target: { id: number; name: string } }>();
  for (const m of order) {
    for (const s of timeline(m.plan, m.walking).steps) {
      if (s.step.kind === "action" && CHASE_ACTIONS.includes(s.step.action) && s.step.target) chases.set(m.tokenId, { start: s.start, action: s.step.action, target: s.step.target });
    }
  }
  const chaseOver = new Set<number>();
  const close = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) <= 1.05 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= 1);
  const dist = (a: Pos, b: Pos) => Math.hypot(a.col - b.col, a.row - b.row);
  const budget = new Map(order.map((m) => [m.tokenId, 0])); // squares (or units) of chase movement banked
  /** One second of Evade / Pursue from `from` with the target at `them`: toward by the most direct route, or as far away as it can get. */
  function chaseStep(m: Mover, from: Pos, them: Pos, pursue: boolean): Pos {
    const perSecond = m.walking / FEET_PER_SQUARE / ROUND_SECONDS; // 30 ft speed → 1 square a second
    const b = budget.get(m.tokenId)! + perSecond;
    // Spots someone else stands in now: a chaser goes around them rather than waiting behind them.
    const others = [...[...pos].filter(([id]) => id !== m.tokenId).map(([, p]) => p), ...bystanders.map((x) => x.at)];
    const taken = (p: Pos) => others.some((o) => same(o, p));
    if (gridless) {
      budget.set(m.tokenId, 0);
      if (pursue) {
        const path = shortestPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: them.col + 0.5, y: them.row + 0.5 }, walls, () => true) ?? [];
        let left = b, at = { x: from.col + 0.5, y: from.row + 0.5 };
        for (const p of path.slice(1)) {
          const d = Math.hypot(p.x - at.x, p.y - at.y);
          const goal = Math.hypot(them.col + 0.5 - at.x, them.row + 0.5 - at.y);
          const step = Math.min(left, d, Math.max(0, goal - 1)); // stop 5 ft short of them
          at = { x: at.x + ((p.x - at.x) / (d || 1)) * step, y: at.y + ((p.y - at.y) / (d || 1)) * step };
          left -= step;
          if (left <= 1e-6 || step < d) break;
        }
        let to = { col: at.x - 0.5, row: at.y - 0.5 };
        if (taken(to)) {
          // Someone's there: angle off to either side (30° steps) for the free spot that gets closest.
          const dx = to.col - from.col, dy = to.row - from.row, len = Math.hypot(dx, dy) || b;
          const heading = Math.atan2(dy, dx);
          let best: Pos | null = null;
          for (const turn of [30, -30, 60, -60, 90, -90]) {
            const a = heading + (turn * Math.PI) / 180, p = { col: from.col + Math.cos(a) * len, row: from.row + Math.sin(a) * len };
            if (taken(p) || !clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: p.col + 0.5, y: p.row + 0.5 }, walls)) continue;
            if (!best || dist(p, them) < dist(best, them)) best = p;
          }
          to = best ?? from;
        }
        return { col: Math.round(to.col * 20) / 20, row: Math.round(to.row * 20) / 20 };
      }
      // Evade: of 16 directions (clear of walls), the one ending furthest away.
      let best = from;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, to = { col: from.col + Math.cos(a) * b, row: from.row + Math.sin(a) * b };
        if (!taken(to) && clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls) && dist(to, them) > dist(best, them)) best = to;
      }
      return { col: Math.round(best.col * 20) / 20, row: Math.round(best.row * 20) / 20 };
    }
    const squares = Math.floor(b + 1e-9);
    budget.set(m.tokenId, b - squares);
    if (!squares) return from;
    const reach = reachableSquares(from, squares, walls); // where they can get to this second
    if (pursue) {
      // Steps from each square to the target (searching out from the target), so the next spot is the one on the
      // shortest route; equally short ones go to whichever is nearest in a straight line (the most direct).
      const toThem = reachableSquares({ col: Math.round(them.col), row: Math.round(them.row) }, 60, walls);
      let best: Pos = from, bestKey = [toThem.get(squareKey(from.col, from.row))?.steps ?? Infinity, dist(from, them)];
      for (const sq of reach.values()) {
        if ((sq.col === Math.round(them.col) && sq.row === Math.round(them.row)) || taken(sq)) continue; // not onto them or anyone else
        const k = [toThem.get(squareKey(sq.col, sq.row))?.steps ?? Infinity, dist(sq, them)];
        if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1] - 1e-9)) [best, bestKey] = [sq, k];
      }
      return { col: best.col, row: best.row };
    }
    let best = { ...from, steps: 0 };
    for (const s of reach.values()) if (!taken(s) && dist(s, them) > dist(best, them) + 1e-9) best = s;
    return { col: best.col, row: best.row };
  }

  const closingIn = new Set<number>(); // who has been told they're closing in (logged once)
  const skipped = new Set<number>(); // whose later planned moves were skipped (logged once)
  for (let sec = 1; sec <= ROUND_SECONDS; sec++) {
    const logFrom = log.length;
    const lagBefore = new Map(lag);
    const autoPursue = new Set<number>(); // closing in on an out-of-reach target this second (their plan waits)
    // Evaluation: where each would like to be at the end of this second (Evade / Pursue decided afresh from where their target is now).
    const proposed = new Map(
      order.map((m) => {
        const here = pos.get(m.tokenId)!;
        if (down.has(m.tokenId)) return [m.tokenId, here];
        const c = chases.get(m.tokenId), t = sec - lag.get(m.tokenId)!;
        // A ranged action due now on someone out of reach: pursue them first, while that still leaves time to do it.
        const tp = t - 1;
        const due = acts.get(m.tokenId)!.find((a) => ACTION_RANGE[a.step.action] && a.step.target && !begun.has(a) && !finished.has(a) && a.start <= tp + 1e-9 && tp < a.end);
        if (due) {
          const them = where(due.step.target!.id);
          if (them && !down.has(due.step.target!.id) && !inReach(here, them, ACTION_RANGE[due.step.action])) {
            if (ROUND_SECONDS - sec >= due.end - due.start - 1e-9) {
              autoPursue.add(m.tokenId);
              if (!closingIn.has(m.tokenId)) log.push(`${sec} s: ${m.name} closes in on ${due.step.target!.name} to ${due.step.action}.`);
              closingIn.add(m.tokenId);
              return [m.tokenId, chaseStep(m, here, them, true)];
            }
          } else begun.add(due);
        }
        // Having closed in, they stay where that got them: moves planned for later this round are skipped.
        if (closingIn.has(m.tokenId) && !(c && t > c.start)) {
          const planned = wants.get(m.tokenId)!;
          if (!same(planned(t), planned(t - 1)) && !skipped.has(m.tokenId)) {
            skipped.add(m.tokenId);
            log.push(`${sec} s: ${m.name}'s planned move is skipped: they closed in instead.`);
          }
          return [m.tokenId, here];
        }
        if (c && t > c.start) {
          // Chasing (or done chasing, which ends the round's movement: they stay where it left them).
          const them = where(c.target.id);
          if (chaseOver.has(m.tokenId) || !them || down.has(c.target.id) || close(here, them)) return [m.tokenId, here];
          return [m.tokenId, chaseStep(m, here, them, c.action === "pursue")];
        }
        return [m.tokenId, wants.get(m.tokenId)!(t)];
      })
    );
    // Reconciliation, highest initiative first.
    const settled: { id: number; at: Pos }[] = [];
    for (const m of order) {
      const here = pos.get(m.tokenId)!, want = proposed.get(m.tokenId)!;
      if (same(here, want)) {
        settled.push({ id: m.tokenId, at: here });
        continue;
      }
      const stillUnmoved = order.filter((o) => !settled.some((s) => s.id === o.tokenId) && o.tokenId !== m.tokenId && same(proposed.get(o.tokenId)!, pos.get(o.tokenId)!));
      const blocker =
        settled.find((s) => same(s.at, want)) ??
        stillUnmoved.map((o) => ({ id: o.tokenId, at: pos.get(o.tokenId)! })).find((s) => same(s.at, want)) ??
        (bystanders.some((b) => same(b.at, want)) ? { id: -1, at: want } : undefined);
      if (blocker) {
        lag.set(m.tokenId, lag.get(m.tokenId)! + 1);
        const who = order.find((o) => o.tokenId === blocker.id)?.name ?? "someone";
        log.push(`${sec} s: ${m.name} is held back by ${who}.`);
        settled.push({ id: m.tokenId, at: here });
      } else {
        settled.push({ id: m.tokenId, at: want });
      }
    }
    // Closing in pauses the rest of their plan (unless being held back already did).
    for (const id of autoPursue) if (lag.get(id) === lagBefore.get(id)) lag.set(id, lag.get(id)! + 1);
    // Result.
    for (const s of settled) pos.set(s.id, s.at);
    // Anyone left sharing a spot (a held-back mover whose spot was taken): the GM decides.
    for (let i = 0; i < settled.length; i++) for (let j = i + 1; j < settled.length; j++) {
      if (same(settled[i].at, settled[j].at)) {
        const a = order.find((o) => o.tokenId === settled[i].id)!.name, b = order.find((o) => o.tokenId === settled[j].id)!.name;
        log.push(`${sec} s: ${a} and ${b} end up in the same spot — GM to decide.`);
      }
    }
    // Actions finishing this second: their end passed on the mover's own plan clock.
    const finishing = order.flatMap((m) => {
      const from = sec - 1 - lagBefore.get(m.tokenId)!, to = sec - lag.get(m.tokenId)!;
      return acts.get(m.tokenId)!.filter((a) => !finished.has(a) && a.end > from + 1e-9 && a.end <= to + 1e-9).map((a) => ({ m, a }));
    });
    for (const { m, a: act } of finishing) {
      finished.add(act);
      const { step } = act;
      const start = act.start + lag.get(m.tokenId)!; // when it really started
      const say = (text: string) => log.push(`${sec} s: ${text}`);
      if (down.has(m.tokenId)) continue; // down: the rest of their plan is gone
      if ((hitAt.get(m.tokenId) ?? []).some((t) => t > start && t <= sec)) {
        say(`${m.name}'s ${step.action} is interrupted: they were hit.`);
        continue;
      }
      if (CHASE_ACTIONS.includes(step.action)) continue; // movement, handled above
      if (step.action !== "attack") {
        say(`${m.name}: ${step.action} (no effect yet).`);
        continue;
      }
      const target = step.target;
      const me = fighters.get(m.tokenId), them = target && fighters.get(target.id);
      const at = target && where(target.id);
      if (!target || !me || !them || !at) {
        say(`${m.name}'s attack fails: no target.`);
      } else if (down.has(target.id)) {
        say(`${m.name}'s attack fails: ${target.name} is already down.`);
      } else if (!inReach(pos.get(m.tokenId)!, at, ACTION_RANGE.attack)) {
        say(`${m.name}'s attack on ${target.name} fails: out of reach.`);
      } else {
        const a = me.attack(), d = them.defense();
        if (a.total < d.total) say(`${m.name} attacks ${target.name}: ${a.total} (${a.text}) vs defense ${d.total} (${d.text}): miss.`);
        else {
          const dmg = me.damage();
          const left = Math.max(0, hp.get(target.id)! - dmg.total);
          hp.set(target.id, left);
          hitAt.set(target.id, [...(hitAt.get(target.id) ?? []), sec]);
          say(`${m.name} attacks ${target.name}: ${a.total} vs defense ${d.total}: hit for ${dmg.total} (${dmg.text}); ${target.name} has ${left} left.`);
          if (left <= 0) {
            down.add(target.id);
            say(`${target.name} is down.`);
          }
        }
      }
    }
    // Evade / Pursue end once the two are within 5 ft (or the target is down).
    for (const [id, c] of chases) {
      const them = where(c.target.id);
      if (!chaseOver.has(id) && sec - lag.get(id)! > c.start && them && (close(pos.get(id)!, them) || down.has(c.target.id))) {
        chaseOver.add(id);
        log.push(`${sec} s: ${order.find((o) => o.tokenId === id)!.name}'s ${c.action} ends: ${down.has(c.target.id) ? `${c.target.name} is down` : `within 5 ft of ${c.target.name}`}.`);
      }
    }
    frames.push({ sec, pos: Object.fromEntries([...pos].map(([id, p]) => [id, p])), down: [...down], lines: log.slice(logFrom).map((l) => l.replace(/^\d+ s: /, "")) });
  }
  // Actions pushed past the end of the round (by closing in or being held back) don't happen.
  for (const m of order) {
    if (down.has(m.tokenId)) continue;
    for (const a of acts.get(m.tokenId)!) if (!finished.has(a) && !CHASE_ACTIONS.includes(a.step.action)) log.push(`${m.name}'s ${a.step.action} runs out of time this round.`);
  }
  for (const m of order) {
    const end = pos.get(m.tokenId)!;
    if (!same(end, m.start)) log.push(`${m.name} ends at ${end.col}, ${end.row}.`);
  }
  return { final: pos, hp, log, frames };
}
