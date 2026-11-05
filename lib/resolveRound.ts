import { FEET_PER_SQUARE, clearPath, reachableSquares, routeTo, squareKey } from "@/lib/movement";
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
  // Actions by the second they finish in (order within a second = initiative order).
  type Act = { m: Mover; start: number; step: Extract<PlanStep, { kind: "action" }> };
  const actionsAt = new Map<number, Act[]>();
  for (const m of order) {
    for (const s of timeline(m.plan, m.walking).steps) {
      if (s.step.kind === "action") {
        const sec = Math.max(1, Math.ceil(s.end - 1e-9));
        actionsAt.set(sec, [...(actionsAt.get(sec) ?? []), { m, start: s.start, step: s.step }]);
      }
    }
  }
  const hp = new Map([...fighters].map(([id, f]) => [id, f.hp]));
  const down = new Set([...hp].filter(([, h]) => h <= 0).map(([id]) => id));
  const hitAt = new Map<number, number[]>(); // seconds each was hit in
  const where = (id: number) => pos.get(id) ?? bystanders.find((b) => b.tokenId === id)?.at;
  const inReach = (a: Pos, b: Pos) =>
    (gridless ? Math.hypot(a.col - b.col, a.row - b.row) <= 1.5 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= 1) &&
    clearPath({ x: a.col + 0.5, y: a.row + 0.5 }, { x: b.col + 0.5, y: b.row + 0.5 }, walls); // not through a wall

  // What each second ended with, for playing the round back: everyone's spot, who's down, and what happened.
  const frames: ReplayFrame[] = [];
  for (let sec = 1; sec <= ROUND_SECONDS; sec++) {
    const logFrom = log.length;
    // Evaluation: where each would like to be at the end of this second.
    const proposed = new Map(order.map((m) => [m.tokenId, down.has(m.tokenId) ? pos.get(m.tokenId)! : wants.get(m.tokenId)!(sec - lag.get(m.tokenId)!)]));
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
    // Result.
    for (const s of settled) pos.set(s.id, s.at);
    // Anyone left sharing a spot (a held-back mover whose spot was taken): the GM decides.
    for (let i = 0; i < settled.length; i++) for (let j = i + 1; j < settled.length; j++) {
      if (same(settled[i].at, settled[j].at)) {
        const a = order.find((o) => o.tokenId === settled[i].id)!.name, b = order.find((o) => o.tokenId === settled[j].id)!.name;
        log.push(`${sec} s: ${a} and ${b} end up in the same spot — GM to decide.`);
      }
    }
    // Actions finishing this second.
    for (const { m, start, step } of actionsAt.get(sec) ?? []) {
      const say = (text: string) => log.push(`${sec} s: ${text}`);
      if (down.has(m.tokenId)) continue; // down: the rest of their plan is gone
      if ((hitAt.get(m.tokenId) ?? []).some((t) => t > start && t <= sec)) {
        say(`${m.name}'s ${step.action} is interrupted: they were hit.`);
        continue;
      }
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
      } else if (!inReach(pos.get(m.tokenId)!, at)) {
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
    frames.push({ sec, pos: Object.fromEntries([...pos].map(([id, p]) => [id, p])), down: [...down], lines: log.slice(logFrom).map((l) => l.replace(/^\d+ s: /, "")) });
  }
  for (const m of order) {
    const end = pos.get(m.tokenId)!;
    if (!same(end, m.start)) log.push(`${m.name} ends at ${end.col}, ${end.row}.`);
  }
  return { final: pos, hp, log, frames };
}
