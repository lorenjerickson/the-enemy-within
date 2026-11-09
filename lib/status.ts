/**
 * Statuses: what an action leaves on someone for a while (Blinding flash: disadvantage on their attack rolls; Shield:
 * +2 defense). Kept on a token until game time passes `ends`; combat rolls take them into account.
 */
import type { Boost, RollGrant, RollKind, RollMode } from "@/lib/actions";
import { rollKindLabel } from "@/lib/actions";
import type { Condition } from "@/lib/conditions";
import { targetLabel, type ModifierTarget } from "@/lib/modifiers";

export interface Status {
  source: string; // the action's name
  boosts: Boost[];
  grants: RollGrant[];
  conditions?: Condition[]; // catalog conditions it puts on them (Poisoned…): these run on by rounds, apart from the status
}

/** An action's statuses: on whoever uses it, on who it's used on, and how long they last (game minutes). */
export interface ActionStatuses {
  self?: Status;
  target?: Status;
  minutes: number;
}

/** The roll mode from a base mode plus every advantage / disadvantage that applies: one of each cancels out. */
export function combineModes(base: RollMode, statuses: Status[], kind: RollKind, more: RollMode[] = []): RollMode {
  const modes = [base, ...more, ...statuses.flatMap((s) => s.grants.filter((g) => g.roll === kind).map((g) => g.mode))];
  const adv = modes.includes("advantage"), dis = modes.includes("disadvantage");
  return adv && dis ? "normal" : adv ? "advantage" : dis ? "disadvantage" : "normal";
}

/** The boosts on one thing (attack, defense, attribute:might…), as formulas to add up. */
export const boostsOn = (statuses: Status[], target: ModifierTarget): string[] => statuses.flatMap((s) => s.boosts.filter((b) => b.target === target).map((b) => b.value));

export const describeStatus = (s: Pick<Status, "boosts" | "grants">) =>
  [...s.grants.map((g) => `${g.mode} on ${rollKindLabel(g.roll).toLowerCase()}`), ...s.boosts.map((b) => `${b.value} ${targetLabel(b.target).toLowerCase()}`)].join(", ");
