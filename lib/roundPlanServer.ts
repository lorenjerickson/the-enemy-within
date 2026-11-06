import { getEncounter, getRoundPlan, getTokenMover, isGridlessLevel, listStructures, saveRoundPlan, tokenLabels } from "@/lib/db";
import { snapHeight } from "@/lib/gravity";
import { FEET_PER_SQUARE, clearPath, reachableSquares, squareKey } from "@/lib/movement";
import type { PlayerActionId } from "@/lib/playerActions";
import { cannotAdd, planEnd, timeline, type GearAction, type PlanStep } from "@/lib/roundPlan";
import { gearActions } from "@/lib/combat";
import { movementBlockers } from "@/lib/visibility";

/** Round planning for one token (a player's character or a GM creature), shared by players' and the GM's actions. */
export function tokenPlanner(tokenId: number) {
  const tok = getTokenMover(tokenId);
  if (!tok || !getEncounter(tok.level_id)) return null;
  return { tok, walking: (JSON.parse(tok.movement).walking as number) ?? 0, ...getRoundPlan(tok.level_id, tok.token_id) };
}
export type Planner = NonNullable<ReturnType<typeof tokenPlanner>>;

export type StepRequest = { kind: "action"; action: PlayerActionId; target?: number; use?: number } | { kind: "move"; col: number; row: number };

/** Adds a step: an action, or a move to a spot reachable from where the plan leaves them, in the time left. */
export function addPlanStep(p: Planner, step: StepRequest): string | null {
  if (p.ready) return "Ready already; undo that to change the plan";
  let add: PlanStep;
  if (step.kind === "move") {
    const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
    const feetLeft = (timeline(p.plan, p.walking).left * p.walking) / 6;
    const walls = movementBlockers(listStructures(p.tok.level_id));
    if (isGridlessLevel(p.tok.level_id)) {
      const to = { col: snapHeight(Number(step.col)), row: snapHeight(Number(step.row)) };
      const feet = Math.round(Math.hypot(to.col - from.col, to.row - from.row) * FEET_PER_SQUARE * 10) / 10;
      if (feet > feetLeft + 0.05 || !clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls)) return "Can't get there in time";
      add = { kind: "move", to, feet };
    } else {
      const sq = reachableSquares(from, feetLeft / FEET_PER_SQUARE, walls).get(squareKey(Math.round(Number(step.col)), Math.round(Number(step.row))));
      if (!sq || !sq.steps) return "Can't get there in time";
      add = { kind: "move", to: { col: sq.col, row: sq.row }, feet: sq.steps * FEET_PER_SQUARE };
    }
  } else {
    const name = step.target !== undefined ? tokenLabels(p.tok.level_id).get(Number(step.target)) : undefined;
    if (step.target !== undefined && (!name || Number(step.target) === p.tok.token_id)) return "Pick someone else on this map";
    // A gear action must be one this token actually has (an equipped item's, or a creature's own).
    const use = step.use !== undefined ? gearActions(p.tok.token_id).find((g) => g.id === Number(step.use)) : undefined;
    if (step.use !== undefined && !use) return "That isn't one of their actions";
    const { source: _source, ...gear } = use ?? { source: "" };
    add = { kind: "action", action: step.action, ...(name ? { target: { id: Number(step.target), name } } : {}), ...(use ? { use: gear as GearAction } : {}) };
  }
  const why = cannotAdd(p.plan, add, p.walking);
  if (why) return why;
  saveRoundPlan(p.tok.level_id, p.tok.token_id, [...p.plan, add], false);
  return null;
}

export const undoPlanStep = (p: Planner) => saveRoundPlan(p.tok.level_id, p.tok.token_id, p.plan.slice(0, -1), false);
export const setReady = (p: Planner, ready: boolean) => saveRoundPlan(p.tok.level_id, p.tok.token_id, p.plan, !!ready);

/** A token's plan laid out for showing: steps in time, seconds used, ready, where it leaves them and the feet they can still move. */
export function planView(tokenId: number) {
  const p = tokenPlanner(tokenId);
  if (!p) return null;
  const t = timeline(p.plan, p.walking);
  return {
    steps: t.steps.map((s) => ({ ...s.step, start: s.start, end: s.end })),
    used: t.used,
    ready: p.ready,
    from: planEnd(p.plan, { col: p.tok.col, row: p.tok.row }),
    feetLeft: (t.left * p.walking) / 6,
  };
}
