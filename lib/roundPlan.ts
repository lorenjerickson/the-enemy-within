import type { AreaSpec } from "@/lib/aoe";
import type { ActionStatuses } from "@/lib/status";
import type { EquipSlot } from "@/lib/itemTypes";
import type { Targeting } from "@/lib/sides";
type Equipment = Partial<Record<EquipSlot, number | null>>;
import { CHASE_ACTIONS, TARGETED_ACTIONS, actionKind, type PlayerActionId } from "@/lib/playerActions";

/** A combat round lasts six seconds; everyone plans theirs at once (see the project's encounters doc). */
export const ROUND_SECONDS = 6;

/** How long each action takes, in seconds (defaults; tune freely). Move and Dash are movement, timed by distance. */
export const ACTION_SECONDS: Partial<Record<PlayerActionId, number>> = {
  wait: 1, interact: 1, use: 2, attack: 2, refit: 2, shake: 2, disengage: 1, dodge: 1, assist: 1, hide: 2, ready: 1, search: 3,
};

/** One step of a round plan, in the order declared. */
/** An action from someone's gear (an item's or a creature's own, e.g. Aimed shot or Bite), as a plan needs it. */
export interface GearAction {
  item?: { id: number; where: "hand" | "worn" | "belt" | "pack"; container?: number }; // an item's action: which item, and where it is (Use: in hand or on a belt; consumables are used up)
  id: number;
  name: string;
  seconds: number;
  range: number; // squares (1 = within reach)
  attack: string | null; // to-hit modifier
  damage: string | null;
  roll: "normal" | "advantage" | "disadvantage";
  area?: AreaSpec; // an area attack: aimed at a spot, everyone caught rolls a save
  statuses?: ActionStatuses; // what it leaves on whoever uses it and on its target, and for how long
  self?: boolean; // only on themselves: planned without a target
  targets?: "self" | "others" | "anyone"; // who it can be used on
  targeting?: Targeting; // friendlies / enemies; one, exactly N, up to N or all (in range, or in its area)
  description?: string; // what it is, in the GM's words
  damageType?: string; // acid, fire…
  kind?: "action" | "reaction"; // a reaction: planned as the round's reaction, on themselves (it readies conditions whose triggers react)
}

/** A gear action that does damage (an attack roll and a damage roll); one that doesn't just takes effect. */
export const dealsDamage = (g: GearAction | undefined) => !!g?.damage;

export type PlanStep =
  | { kind: "move"; to: { col: number; row: number }; feet: number; run?: number } // run: a Dash, at this running speed (feet per second); it uses the round's action
  // Attacks, evasion and pursuit have a target; a gear attack (Aimed shot…) carries its action in `use`.
  // An area attack is aimed at a spot (map position) instead of at someone.
  | { kind: "action"; action: PlayerActionId; target?: { id: number; name: string }; use?: GearAction; aim?: { col: number; row: number }; seconds?: number; swap?: Refit; put?: Put; improv?: { id: number; name: string; seconds: number; cost: "action" | "bonus" | "free" }; dice?: StepDice; picks?: { id: number; name: string }[]; door?: { id: number; name: string; open: boolean }; thing?: { id: number; name: string }; hurried?: boolean };
// hurried: a Hide after slipping into a blind spot while seen (its Stealth roll has disadvantage)
// thing: Interact with a lever / switch / object (an interactable map trigger): it fires after the round
// door: Interact with a door (opened or closed after the round; open: how it was when planned)
// picks: the targets chosen for an action aimed at several (or, in an area, which of those there it's meant for)
// seconds: how long an Evade / Pursue lasts (unset = the rest of the round).

/**
 * A refit: what goes into a slot (and what comes out), whatever has to leave the other hand for something held in
 * both, and the reach a plain Attack gets from it (main hand only, squares).
 */
export interface Refit {
  slot: EquipSlot;
  item: { id: number; name: string };
  from: { id: number; name: string } | null;
  clears?: EquipSlot; // the other hand, emptied for a two-handed item
  reach?: number;
}

/**
 * Refit putting one thing away (stowing it): from an equipment slot (left empty) or out of a pack, into a worn
 * container (a belt, a pack). belt: the container is at the waist, so what's in it is at hand (Use) from then on.
 */
export interface Put {
  item: { id: number; name: string };
  slot?: EquipSlot; // out of this slot (left empty)…
  from?: { id: number; name: string }; // …or out of this container (a pack)
  into: { id: number; name: string };
  belt: boolean;
}

/** Items the plan puts on their belt (at hand from then on): which, and into which container. */
export function onBelt(plan: PlanStep[]): { id: number; name: string; container: number; containerName: string }[] {
  return plan.flatMap((s) => (s.kind === "action" && s.put?.belt ? [{ id: s.put.item.id, name: s.put.item.name, container: s.put.into.id, containerName: s.put.into.name }] : []));
}

/** Dice a player threw for a step with the plan (in the order resolution rolls them: both d20s first). */
export interface StepDice {
  hit?: number[];
  damage?: number[];
  check?: number[]; // Dodge: d20 + agility vs DODGE_DC
}

/** Dodge: d20 + agility against this; beating it gives attacks against them disadvantage. */
export const DODGE_DC = 12;

/** Equipment once the plan's refits have happened. */
export function afterRefits(equipment: Equipment, plan: PlanStep[]): Equipment {
  const out = { ...equipment };
  for (const s of plan) {
    if (s.kind !== "action") continue;
    if (s.swap) {
      out[s.swap.slot] = s.swap.item.id;
      if (s.swap.clears) out[s.swap.clears] = null;
    }
    if (s.put?.slot) out[s.put.slot] = null; // put away: the slot's left empty
  }
  return out;
}

/** Seconds a step takes: a move at their walking speed (feet per second), or a Dash at its running speed. */
export function stepSeconds(step: PlanStep, walkFps: number): number {
  if (step.kind === "move") {
    const speed = step.run ?? walkFps; // a Dash goes at running speed
    return speed > 0 ? Math.round((step.feet / speed) * 10) / 10 : Infinity;
  }
  return step.improv?.seconds ?? step.use?.seconds ?? ACTION_SECONDS[step.action] ?? 1;
}

/** The plan laid out in time: when each step starts and ends, and the seconds used. */
export function timeline(plan: PlanStep[], walkFps: number) {
  let t = 0;
  const steps = plan.map((step) => {
    const start = t;
    // Evade / Pursue run for their seconds, or the rest of the round (stopping early within 5 ft of the target,
    // or once the next action's target is within its range).
    t += step.kind === "action" && CHASE_ACTIONS.includes(step.action) ? (step.seconds ?? Math.max(0, ROUND_SECONDS - t)) : stepSeconds(step, walkFps);
    return { step, start, end: t };
  });
  return { steps, used: t, left: Math.max(0, ROUND_SECONDS - t) };
}

/** Why a step can't be added (or null if it can): it must fit in the round, and there's only one action. */
/** A step's kind: movement, action (gear actions too), bonus action or reaction. */
/** A Dash: a move at running speed, which takes the round's action (any number of Dash legs, but no other action). */
export const isDash = (s: PlanStep) => s.kind === "move" && !!s.run;

export const stepKind = (s: PlanStep) => (s.kind === "move" ? "movement" : s.improv ? s.improv.cost : s.use ? (s.use.kind === "reaction" ? "reaction" : "action") : actionKind(s.action)); // an improvisation costs what the GM said

/**
 * Why something of this kind, taking these seconds, can't be added to the plan now (for greying out its button), or
 * null if it can: one action, one bonus action and one reaction a round, and only what fits the time left.
 */
export function unavailable(plan: PlanStep[], used: number, kind: ReturnType<typeof stepKind>, seconds: number, forbidden: Partial<Record<string, string>> = {}): string | null {
  if (forbidden[kind]) return `${forbidden[kind]}: can't ${kind === "movement" ? "move" : kind === "action" ? "take actions" : kind === "bonus" ? "take bonus actions" : "react"}`;
  const left = ROUND_SECONDS - used;
  if (kind !== "movement" && kind !== "free" && plan.some((s) => stepKind(s) === kind)) return `You've already planned your ${kind === "bonus" ? "bonus action" : kind} this round`;
  if (kind === "action" && plan.some(isDash)) return "You're dashing this round: that's your action";
  if (left <= 1e-9) return "No time left this round";
  if (seconds > left + 1e-9) return `Not enough time left (${+left.toFixed(1)} s)`;
  return null;
}

export function cannotAdd(plan: PlanStep[], step: PlanStep, walkFps: number): string | null {
  // One action, one bonus action and one reaction a round; movement (Move, Dash, Evade, Pursue) as time allows.
  const kind = stepKind;
  if (kind(step) === "action" && plan.some((s) => kind(s) === "action")) return "You've already planned your action this round";
  if (kind(step) === "action" && plan.some(isDash)) return "You're dashing this round: that's your action";
  if (isDash(step) && plan.some((s) => kind(s) === "action")) return "You've already planned your action this round: no Dash";
  if (kind(step) === "reaction" && plan.some((s) => kind(s) === "reaction")) return "You've already planned your reaction this round";
  if (kind(step) === "bonus" && plan.some((s) => kind(s) === "bonus")) return "You've already planned your bonus action this round";
  if (step.kind === "action" && TARGETED_ACTIONS.includes(step.action) && !step.target && !(step.use?.area && step.aim) && step.use?.targeting?.count !== "all") return step.use?.area ? "Aim it on the map" : "Pick a target";
  if (step.kind === "action" && CHASE_ACTIONS.includes(step.action) && timeline(plan, walkFps).left <= 0) return "No time left this round";
  if (timeline([...plan, step], walkFps).used > ROUND_SECONDS + 1e-9) return "That doesn't fit in the six seconds left";
  return null;
}

/** Where the plan leaves the character: the last planned move's square, or where they stand. */
export const planEnd = (plan: PlanStep[], from: { col: number; row: number }) =>
  plan.reduce((at, s) => (s.kind === "move" ? s.to : at), from);
