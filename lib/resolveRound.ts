import type { AreaHit, AttackFx, Fx } from "@/lib/vfx";
import { caughtBy, describeArea, placeArea, type AreaAt, type LastingArea } from "@/lib/aoe";
import { rollDice, usingDice } from "@/lib/dice";
import { describeStatus, type Status } from "@/lib/status";
import type { Attribute } from "@/lib/attributes";
import { FEET_PER_SQUARE, clearPath, crosses, reachableSquares, routeTo, shortestPath, squareKey } from "@/lib/movement";
import { ACTION_RANGE, CHASE_ACTIONS, REACTIONS } from "@/lib/playerActions";
import { DODGE_DC, ROUND_SECONDS, timeline, type GearAction, type PlanStep, type Refit } from "@/lib/roundPlan";

/** How close a planned action needs its target: a gear action's own range, else the action's (attack = within reach). */
/** How far an action reaches (squares): a gear action's own range, a plain Attack the mover's weapon's. */
const rangeOf = (step: Extract<PlanStep, { kind: "action" }>, m?: Mover) =>
  step.use?.range ?? (step.action === "attack" && m?.attackRange ? m.attackRange : ACTION_RANGE[step.action]);
import type { Segment } from "@/lib/visibility";
import type { EquipSlot } from "@/lib/itemTypes";
import type { StoryEvent } from "@/lib/roundStory";

type Pos = { col: number; row: number };

/** Someone (or something) taking part in the round. */
export interface Mover {
  tokenId: number;
  name: string;
  initiative: number; // tie breaker only; not rolled yet = lowest
  start: Pos;
  plan: PlanStep[];
  walking: number; // feet per round
  attackRange?: number; // squares a plain Attack reaches (their main-hand weapon's range); 1 = within reach
  equipment?: Partial<Record<EquipSlot, number | null>>; // what they wear (refits change it mid-round)
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
  fx?: Fx[]; // attacks landing (or missing) this second, for the map to draw
}

/** A resolved round to play back: frames shown one a second from `starts` (ms since epoch). */
export interface Replay {
  round: number;
  starts: number;
  start: Record<number, Pos>; // where everyone was before the round
  startDown?: number[]; // who was already down before it
  story?: StoryEvent[]; // what happened, for telling each player their part (stripped before it reaches a browser)
  frames: ReplayFrame[];
}

/** What resolving needs to settle an attack (see lib/combat.ts for the rules). */
export interface Combatant {
  hp: number;
  attack: (use?: GearAction, against?: Combatant) => { total: number; text: string };
  statuses?: Status[]; // what actions left on them; a status added this round counts straight away
  defense: () => { total: number; text: string };
  damage: (use?: GearAction) => { total: number; text: string };
  save?: (attr: Attribute) => { total: number; text: string };
  wear?: (equipment: Partial<Record<EquipSlot, number | null>>) => void; // after a refit
  maxHp?: number; // for how bad a wound sounds in the players' story
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
  effectWalls: Segment[] = walls, // what stops an area (walls, closed doors; not windows)
  lasting: LastingArea[] = [], // areas already on the map: whoever is in one at the end of the round rolls its save
) {
  const refits: { tokenId: number; equipment: Partial<Record<EquipSlot, number | null>>; before: Partial<Record<EquipSlot, number | null>>; swap: Refit }[] = []; // refits done, to keep
  const created: (Omit<LastingArea, "id" | "ends"> & { minutes: number })[] = []; // lasting areas this round's actions leave behind
  const statuses: { tokenId: number; status: Status; minutes: number }[] = []; // statuses this round's actions leave
  const story: StoryEvent[] = []; // the round as events, for each player's own account of it
  const hurt = (id: number, dmg: number) => dmg / Math.max(1, fighters.get(id)?.maxHp ?? hp.get(id) ?? 1);
  const nameOf = (id: number) => order.find((o) => o.tokenId === id)?.name ?? bystanders.find((b) => b.tokenId === id)?.name ?? "someone";
  /** Leaves a status on someone (for the rest of this round too), and logs it. */
  const leave = (id: number, status: Status | undefined, minutes: number, sec: number) => {
    if (!status || down.has(id)) return;
    // A health boost heals straight away (Healing Draught: +1d10), up to their full health.
    const healing = status.boosts.filter((b) => b.target === "health").reduce((sum, b) => sum + rollDice(b.value.replace(/^\+/, "")), 0);
    if (healing > 0 && hp.has(id)) {
      const before = hp.get(id)!, max = fighters.get(id)?.maxHp ?? Infinity, after = Math.min(max, before + healing);
      hp.set(id, after);
      log.push(`${sec} s: ${nameOf(id)} is healed for ${after - before} (${status.source}); ${after} health.`);
      story.push({ sec, k: "healed", who: id, source: status.source, much: after - before });
    }
    // Nothing more to it than healing: done (it doesn't linger as an effect).
    if (status.boosts.every((b) => b.target === "health") && !status.grants.length) return;
    fighters.get(id)?.statuses?.push(status);
    statuses.push({ tokenId: id, status, minutes });
    story.push({ sec, k: "status", who: id, source: status.source });
    log.push(`${sec} s: ${nameOf(id)}: ${describeStatus(status)} (${status.source}, ${minutes < 1 ? `${Math.round(minutes * 10)} round(s)` : `${minutes} min`}).`);
  };
  /** Everyone caught by an area (but `except`) rolls its save against `total` damage; returns how each fared. */
  const catchIn = (at: AreaAt, spec: { dc: number; save: Attribute; half: boolean }, total: number, except: number, sec: number, what = "the area"): AreaHit[] => {
    const hits: AreaHit[] = [];
    for (const id of [...fighters.keys()]) {
      const p = where(id);
      if (id === except || down.has(id) || !p || !caughtBy(at, { x: p.col + 0.5, y: p.row + 0.5 }, effectWalls)) continue;
      const f = fighters.get(id)!, name = order.find((o) => o.tokenId === id)?.name ?? bystanders.find((b) => b.tokenId === id)?.name ?? "someone";
      const s = f.save ? f.save(spec.save) : { total: 0, text: "no save" };
      const saved = s.total >= spec.dc;
      const taken = saved ? (spec.half ? Math.floor(total / 2) : 0) : total;
      const left = Math.max(0, hp.get(id)! - taken);
      if (taken > 0) {
        hp.set(id, left);
        hitAt.set(id, [...(hitAt.get(id) ?? []), sec]);
      }
      log.push(`${sec} s: ${name} saves (${spec.save}): ${s.total} (${s.text}) vs DC ${spec.dc}, ${saved ? (taken ? `half damage (${taken})` : "no damage") : `fails, takes ${taken}`}; ${left} left.`);
      hits.push({ id, outcome: left <= 0 ? "down" : !saved ? "hit" : taken ? "half" : "save" });
      story.push({ sec, k: "caught", who: id, by: except >= 0 ? except : null, name: what, outcome: !saved ? "hit" : taken ? "half" : "save", hurt: hurt(id, taken) });
      if (left <= 0) {
        story.push({ sec, k: "down", who: id });
        down.add(id);
        log.push(`${sec} s: ${name} is down.`);
      }
    }
    return hits;
  };
  const order = [...movers].sort((a, b) => b.initiative - a.initiative);
  const wants = new Map(order.map((m) => [m.tokenId, planner(m, walls, gridless)]));
  const lag = new Map(order.map((m) => [m.tokenId, 0])); // seconds each has been held back
  const pos = new Map(order.map((m) => [m.tokenId, m.start]));
  const same = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) < 0.9 : a.col === b.col && a.row === b.row); // the same spot (overlapping)
  const unmoved = (a: Pos, b: Pos) => Math.hypot(a.col - b.col, a.row - b.row) < 0.01; // a short step on a gridless map is still a move
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
    !walls.some((w) => crosses({ x: a.col + 0.5, y: a.row + 0.5 }, { x: b.col + 0.5, y: b.row + 0.5 }, w)); // not through a wall

  // What each second ended with, for playing the round back: everyone's spot, who's down, and what happened.
  const frames: ReplayFrame[] = [];
  // Evade / Pursue: from when each starts (in its own plan time), its target, and whether it's over (within 5 ft).
  const chases = new Map<number, { start: number; end: number; action: string; target: { id: number; name: string } }>();
  for (const m of order) {
    for (const s of timeline(m.plan, m.walking).steps) {
      if (s.step.kind === "action" && CHASE_ACTIONS.includes(s.step.action) && s.step.target) chases.set(m.tokenId, { start: s.start, end: s.end, action: s.step.action, target: s.step.target });
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
  const readied = new Set<Act>(); // reactions that are ready
  const skipped = new Set<number>(); // whose later planned moves were skipped (logged once)
  for (let sec = 1; sec <= ROUND_SECONDS; sec++) {
    const logFrom = log.length;
    const fx: Fx[] = [];
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
        const due = acts.get(m.tokenId)!.find((a) => rangeOf(a.step, m) && a.step.target && !begun.has(a) && !finished.has(a) && a.start <= tp + 1e-9 && tp < a.end);
        if (due) {
          const them = where(due.step.target!.id);
          if (them && !down.has(due.step.target!.id) && !inReach(here, them, rangeOf(due.step, m))) {
            if (ROUND_SECONDS - sec >= due.end - due.start - 1e-9) {
              autoPursue.add(m.tokenId);
              if (!closingIn.has(m.tokenId)) {
                log.push(`${sec} s: ${m.name} closes in on ${due.step.target!.name} to ${due.step.action}.`);
                story.push({ sec, k: "close", who: m.tokenId, target: due.step.target!.id });
              }
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
            story.push({ sec, k: "skip", who: m.tokenId });
          }
          return [m.tokenId, here];
        }
        if (c && t > c.start) {
          // Chasing (or done chasing, which ends the round's movement: they stay where it left them).
          const them = where(c.target.id);
          if (chaseOver.has(m.tokenId) || t - 1 >= c.end - 1e-9) {
            // Over: they stay where the chase left them, so moves planned after it are skipped.
            const planned = wants.get(m.tokenId)!;
            if (!same(planned(t), planned(t - 1)) && !skipped.has(m.tokenId)) {
              skipped.add(m.tokenId);
              log.push(`${sec} s: ${m.name}'s planned move is skipped: they stay where the ${c.action} left them.`);
              story.push({ sec, k: "skip", who: m.tokenId });
            }
            return [m.tokenId, here];
          }
          if (!them || down.has(c.target.id) || close(here, them)) return [m.tokenId, here];
          return [m.tokenId, chaseStep(m, here, them, c.action === "pursue")];
        }
        return [m.tokenId, wants.get(m.tokenId)!(t)];
      })
    );
    // Reconciliation, highest initiative first.
    const settled: { id: number; at: Pos }[] = [];
    for (const m of order) {
      const here = pos.get(m.tokenId)!, want = proposed.get(m.tokenId)!;
      if (unmoved(here, want)) {
        settled.push({ id: m.tokenId, at: here });
        continue;
      }
      const stillUnmoved = order.filter((o) => !settled.some((s) => s.id === o.tokenId) && o.tokenId !== m.tokenId && unmoved(proposed.get(o.tokenId)!, pos.get(o.tokenId)!));
      const blocker =
        settled.find((s) => same(s.at, want)) ??
        stillUnmoved.map((o) => ({ id: o.tokenId, at: pos.get(o.tokenId)! })).find((s) => same(s.at, want)) ??
        (bystanders.some((b) => same(b.at, want)) ? { id: -1, at: want } : undefined);
      if (blocker) {
        lag.set(m.tokenId, lag.get(m.tokenId)! + 1);
        const who = order.find((o) => o.tokenId === blocker.id)?.name ?? "someone";
        log.push(`${sec} s: ${m.name} is held back by ${who}.`);
        story.push({ sec, k: "blocked", who: m.tokenId, by: blocker.id >= 0 ? blocker.id : null });
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
    // Reactions get ready in the second they're planned for (after anything planned before them): Dodge gives
    // attacks against them disadvantage from then until the round ends.
    for (const m of order) {
      if (down.has(m.tokenId)) continue;
      for (const a of acts.get(m.tokenId)!) {
        if (!REACTIONS.includes(a.step.action) || readied.has(a) || a.start > sec - 1 - lag.get(m.tokenId)! + 1e-9) continue;
        readied.add(a);
        // d20 + agility (their own dice, if they rolled with the plan) against DODGE_DC.
        const f = fighters.get(m.tokenId), check = f?.save ? usingDice(a.step.dice?.check, () => f.save!("agility")) : undefined;
        if (check && check.total < DODGE_DC) {
          story.push({ sec, k: "dodge", who: m.tokenId, ok: false });
          log.push(`${sec} s: ${m.name} tries to dodge but isn't quick enough (${check.total}: ${check.text} vs DC ${DODGE_DC}).`);
          continue;
        }
        f?.statuses?.push({ source: "Dodge", boosts: [], grants: [{ roll: "attacked", mode: "disadvantage" }] });
        story.push({ sec, k: "dodge", who: m.tokenId, ok: true });
        log.push(`${sec} s: ${m.name} is ready to dodge${check ? ` (${check.total} vs DC ${DODGE_DC})` : ""}: attacks against them have disadvantage.`);
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
      // A refit (a bonus action) is done: from now on they fight with the new gear.
      if (step.swap) {
        const before = { ...(m.equipment ?? {}) };
        const equipment = { ...before, [step.swap.slot]: step.swap.item.id, ...(step.swap.clears ? { [step.swap.clears]: null } : {}) };
        m.equipment = equipment;
        fighters.get(m.tokenId)?.wear?.(equipment);
        if (step.swap.reach) m.attackRange = step.swap.reach;
        refits.push({ tokenId: m.tokenId, equipment, before, swap: step.swap });
        story.push({ sec, k: "refit", who: m.tokenId, from: step.swap.from?.name ?? null, to: step.swap.item.name });
        say(`${m.name} ${step.swap.from ? `swaps ${step.swap.from.name} for ${step.swap.item.name}` : `takes up ${step.swap.item.name}`} (${step.swap.slot}).`);
        continue;
      }
      // Hit while doing it (not in the second it finishes: blows landing together both count).
      if ((hitAt.get(m.tokenId) ?? []).some((t) => t > start && t < sec)) {
        say(`${m.name}'s ${step.action} is interrupted: they were hit.`);
        story.push({ sec, k: "interrupted", who: m.tokenId, action: step.use ? "attack" : step.action });
        continue;
      }
      if (CHASE_ACTIONS.includes(step.action) || REACTIONS.includes(step.action)) continue; // movement / reactions: handled above
      // An ability used on themselves (Case the Scene): its effects on them.
      if (step.action === "use" && step.use) {
        say(`${m.name} uses ${step.use.name}.`);
        story.push({ sec, k: "ability", who: m.tokenId, name: step.use.name, target: null });
        leave(m.tokenId, step.use.statuses?.self, step.use.statuses?.minutes ?? 0, sec);
        continue;
      }
      if (step.action !== "attack") {
        say(`${m.name}: ${step.action} (no effect yet).`);
        continue;
      }
      // An ability aimed at someone that does no damage (Mesmerize): no attack roll; it takes effect if they're in range.
      if (step.use && !step.use.damage && !step.use.area) {
        const target = step.target, at = target && where(target.id);
        if (!target || !at || down.has(target.id)) say(`${m.name}'s ${step.use.name} fails: no one to use it on.`);
        else if (!inReach(pos.get(m.tokenId)!, at, rangeOf(step, m))) {
          say(`${m.name}'s ${step.use.name} on ${target.name} fails: out of range.`);
          story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use.name, outcome: "reach" });
        } else {
          say(`${m.name} uses ${step.use.name} on ${target.name}.`);
          story.push({ sec, k: "ability", who: m.tokenId, name: step.use.name, target: target.id });
          leave(target.id, step.use.statuses?.target, step.use.statuses?.minutes ?? 0, sec);
          leave(m.tokenId, step.use.statuses?.self, step.use.statuses?.minutes ?? 0, sec);
        }
        continue;
      }
      // An area attack: everyone caught (but the attacker) rolls the save; the damage is rolled once for all.
      const area = step.use?.area;
      if (area && step.aim && step.use) {
        const me = fighters.get(m.tokenId), here = pos.get(m.tokenId)!;
        const at = placeArea(area.shape, area.ft, { x: here.col + 0.5, y: here.row + 0.5 }, { x: step.aim.col, y: step.aim.row });
        let hits: AreaHit[] = [];
        if (me) {
          const dmg = usingDice(step.dice?.damage, () => me.damage(step.use));
          say(`${m.name} uses ${step.use.name} (${describeArea(area)}): ${dmg.total} damage (${dmg.text}), ${area.save} save DC ${area.dc}.`);
          story.push({ sec, k: "area", who: m.tokenId, name: step.use.name });
          hits = catchIn(at, area, dmg.total, m.tokenId, sec, step.use.name);
          if (!hits.length) say(`${m.name}'s ${step.use.name} catches no one.`);
          // Statuses: on the user, and on each one caught who failed the save.
          const st = step.use.statuses;
          if (st) {
            leave(m.tokenId, st.self, st.minutes, sec);
            for (const h of hits) if (h.outcome === "hit") leave(h.id, st.target, st.minutes, sec);
          }
        }
        // A lasting one stays on the map, catching whoever is in it at the end of each round.
        if (area.minutes) {
          created.push({ name: step.use.name, look: area.look ?? "fog", area: at, damage: step.use.damage, dc: area.dc, save: area.save, half: area.half, minutes: area.minutes });
          say(`${step.use.name} stays for ${area.minutes < 1 ? `${Math.round(area.minutes * 10)} round(s)` : `${area.minutes} min`}.`);
        }
        fx.push({ look: "area", from: m.tokenId, area: at, hits });
        continue;
      }
      const target = step.target;
      const me = fighters.get(m.tokenId), them = target && fighters.get(target.id);
      const at = target && where(target.id);
      if (!target || !me || !them || !at) {
        say(`${m.name}'s attack fails: no target.`);
      } else if (down.has(target.id)) {
        say(`${m.name}'s attack fails: ${target.name} is already down.`);
        story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "gone" });
      } else if (!inReach(pos.get(m.tokenId)!, at, rangeOf(step, m))) {
        say(`${m.name}'s attack on ${target.name} fails: out of reach.`);
        story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "reach" });
      } else {
        const a = usingDice(step.dice?.hit, () => me.attack(step.use, them)), d = them.defense();
        const how = step.use ? ` (${step.use.name})` : "";
        const look = (rangeOf(step, m) ?? 1) > 1 ? "arrow" : "slash"; // reach beyond the next square: a projectile
        const shown = (outcome: AttackFx["outcome"]) => fx.push({ look, from: m.tokenId, to: target.id, outcome });
        if (a.total < d.total) shown("miss");
        if (a.total < d.total) say(`${m.name} attacks ${target.name}${how}: ${a.total} (${a.text}) vs defense ${d.total} (${d.text}): miss.`);
        if (a.total < d.total) story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "miss" });
        else {
          const dmg = usingDice(step.dice?.damage, () => me.damage(step.use));
          const left = Math.max(0, hp.get(target.id)! - dmg.total);
          hp.set(target.id, left);
          hitAt.set(target.id, [...(hitAt.get(target.id) ?? []), sec]);
          say(`${m.name} attacks ${target.name}${how}: ${a.total} (${a.text}) vs defense ${d.total}: hit for ${dmg.total} (${dmg.text}); ${target.name} has ${left} left.`);
          story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "hit", hurt: hurt(target.id, dmg.total) });
          shown(left <= 0 ? "down" : "hit");
          if (left <= 0) {
            story.push({ sec, k: "down", who: target.id });
            down.add(target.id);
            say(`${target.name} is down.`);
          }
          leave(target.id, step.use?.statuses?.target, step.use?.statuses?.minutes ?? 0, sec); // on a hit
        }
        leave(m.tokenId, step.use?.statuses?.self, step.use?.statuses?.minutes ?? 0, sec); // whether it hit or not
      }
    }
    // Evade / Pursue end: within range of what's planned next, within 5 ft, the target down, or their time up.
    for (const [id, c] of chases) {
      if (chaseOver.has(id) || down.has(id) || sec - lag.get(id)! <= c.start + 1e-9) continue;
      const m = order.find((o) => o.tokenId === id)!, now = sec - lag.get(id)!;
      // Within range of what they planned next (only theirs: the other may well keep going): they stop and get on
      // with it now, the rest of the chase's time going to it.
      const next = acts.get(id)!.find((a) => a.start >= c.end - 1e-9 && !finished.has(a) && a.step.target && rangeOf(a.step, m));
      const nextAt = next && where(next.step.target!.id);
      if (next && nextAt && !down.has(next.step.target!.id) && inReach(pos.get(id)!, nextAt, rangeOf(next.step, m))) {
        chaseOver.add(id);
        if (now < next.start - 1e-9) lag.set(id, lag.get(id)! - (next.start - now));
        log.push(`${sec} s: ${m.name} stops their ${c.action}: ${next.step.target!.name} is within range to ${next.step.use?.name ?? next.step.action}.`);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: "range" });
        continue;
      }
      const them = where(c.target.id);
      if (them && (close(pos.get(id)!, them) || down.has(c.target.id))) {
        chaseOver.add(id);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: down.has(c.target.id) ? "down" : "close" });
        log.push(`${sec} s: ${m.name}'s ${c.action} ends: ${down.has(c.target.id) ? `${c.target.name} is down` : `within 5 ft of ${c.target.name}`}.`);
        continue;
      }
      if (now >= c.end - 1e-9 && c.end < ROUND_SECONDS - 1e-9) {
        chaseOver.add(id);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: "time" });
        log.push(`${sec} s: ${m.name}'s ${c.action} ends after ${+(c.end - c.start).toFixed(1)} s.`);
      }
    }
    // The end of the round: whoever is in a lasting area rolls its save (its damage dice rolled once for everyone).
    if (sec === ROUND_SECONDS) {
      for (const l of lasting) {
        const total = l.damage ? rollDice(l.damage) : 0;
        const before = log.length;
        const hits = catchIn(l.area, l, total, -1, sec, l.name);
        if (hits.length) log.splice(before, 0, `${sec} s: ${l.name} lingers: ${total} damage, ${l.save} save DC ${l.dc}.`);
        fx.push({ look: "area", from: 0, area: l.area, hits, lasting: true });
      }
    }
    frames.push({ sec, pos: Object.fromEntries([...pos].map(([id, p]) => [id, p])), down: [...down], lines: log.slice(logFrom).map((l) => l.replace(/^\d+ s: /, "")), ...(fx.length ? { fx } : {}) });
  }
  // Actions pushed past the end of the round (by closing in or being held back) don't happen.
  for (const m of order) {
    if (down.has(m.tokenId)) continue;
    for (const a of acts.get(m.tokenId)!) if (!finished.has(a) && !CHASE_ACTIONS.includes(a.step.action)) {
      log.push(`${m.name}'s ${a.step.action} runs out of time this round.`);
      story.push({ sec: ROUND_SECONDS, k: "late", who: m.tokenId, action: a.step.use ? "attack" : a.step.action });
    }
  }
  for (const m of order) {
    const end = pos.get(m.tokenId)!;
    if (!unmoved(end, m.start)) log.push(`${m.name} ends at ${end.col}, ${end.row}.`);
  }
  return { final: pos, hp, log, frames, created, statuses, refits, story };
}
