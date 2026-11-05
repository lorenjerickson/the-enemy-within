import { CHASE_ACTIONS, TARGETED_ACTIONS, type PlayerActionId } from "@/lib/playerActions";

/** A combat round lasts six seconds; everyone plans theirs at once (see the project's encounters doc). */
export const ROUND_SECONDS = 6;

/** How long each action takes, in seconds (defaults; tune freely). Move and Dash are movement, timed by distance. */
export const ACTION_SECONDS: Partial<Record<PlayerActionId, number>> = {
  interact: 1, use: 2, attack: 2, disengage: 1, dodge: 1, assist: 1, hide: 2, ready: 1, search: 3,
};

/** One step of a round plan, in the order declared. */
export type PlanStep =
  | { kind: "move"; to: { col: number; row: number }; feet: number }
  | { kind: "action"; action: PlayerActionId; target?: { id: number; name: string } }; // attacks have a target

/** Seconds a step takes: moving at walking speed covers speed / 6 feet a second (30 ft → 5 ft/s). */
export function stepSeconds(step: PlanStep, walkingFeet: number): number {
  if (step.kind === "move") return walkingFeet > 0 ? Math.round((step.feet / (walkingFeet / ROUND_SECONDS)) * 10) / 10 : Infinity;
  return ACTION_SECONDS[step.action] ?? 1;
}

/** The plan laid out in time: when each step starts and ends, and the seconds used. */
export function timeline(plan: PlanStep[], walkingFeet: number) {
  let t = 0;
  const steps = plan.map((step) => {
    const start = t;
    // Evade / Pursue run for the rest of the round (they stop early once within 5 ft of the target).
    t += step.kind === "action" && CHASE_ACTIONS.includes(step.action) ? Math.max(0, ROUND_SECONDS - t) : stepSeconds(step, walkingFeet);
    return { step, start, end: t };
  });
  return { steps, used: t, left: Math.max(0, ROUND_SECONDS - t) };
}

/** Why a step can't be added (or null if it can): it must fit in the round, and there's only one action. */
export function cannotAdd(plan: PlanStep[], step: PlanStep, walkingFeet: number): string | null {
  if (step.kind === "action" && plan.some((s) => s.kind === "action")) return "You've already planned your action this round";
  if (step.kind === "action" && TARGETED_ACTIONS.includes(step.action) && !step.target) return "Pick a target";
  if (step.kind === "action" && CHASE_ACTIONS.includes(step.action) && timeline(plan, walkingFeet).left <= 0) return "No time left this round";
  if (timeline([...plan, step], walkingFeet).used > ROUND_SECONDS + 1e-9) return "That doesn't fit in the six seconds left";
  return null;
}

/** Where the plan leaves the character: the last planned move's square, or where they stand. */
export const planEnd = (plan: PlanStep[], from: { col: number; row: number }) =>
  plan.reduce((at, s) => (s.kind === "move" ? s.to : at), from);
