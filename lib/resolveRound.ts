import { FEET_PER_SQUARE, reachableSquares, routeTo, squareKey } from "@/lib/movement";
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

/**
 * Resolves a round's movement second by second: evaluation (each mover's proposed spot at the end of the second),
 * reconciliation (in initiative order, nobody ends a second where someone already is; the loser is held back a
 * second), result (positions applied). Actions are only logged for now. Returns final spots and a log.
 */
export function resolveMovement(movers: Mover[], bystanders: Pos[], walls: Segment[], gridless: boolean) {
  const order = [...movers].sort((a, b) => b.initiative - a.initiative);
  const wants = new Map(order.map((m) => [m.tokenId, planner(m, walls, gridless)]));
  const lag = new Map(order.map((m) => [m.tokenId, 0])); // seconds each has been held back
  const pos = new Map(order.map((m) => [m.tokenId, m.start]));
  const same = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) < 0.9 : a.col === b.col && a.row === b.row);
  const log: string[] = [];
  const actionsAt = new Map<number, string[]>(); // second → actions finishing then
  for (const m of order) {
    for (const s of timeline(m.plan, m.walking).steps) {
      if (s.step.kind === "action") {
        const sec = Math.max(1, Math.ceil(s.end - 1e-9));
        actionsAt.set(sec, [...(actionsAt.get(sec) ?? []), `${m.name}: ${s.step.action} (not resolved yet)`]);
      }
    }
  }

  for (let sec = 1; sec <= ROUND_SECONDS; sec++) {
    // Evaluation: where each would like to be at the end of this second.
    const proposed = new Map(order.map((m) => [m.tokenId, wants.get(m.tokenId)!(sec - lag.get(m.tokenId)!)]));
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
        (bystanders.some((b) => same(b, want)) ? { id: -1, at: want } : undefined);
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
    for (const line of actionsAt.get(sec) ?? []) log.push(`${sec} s: ${line}`);
  }
  for (const m of order) {
    const end = pos.get(m.tokenId)!;
    if (!same(end, m.start)) log.push(`${m.name} ends at ${end.col}, ${end.row}.`);
  }
  return { final: pos, log };
}
