/**
 * Statuses: what an action leaves on someone for a while (Blinding flash: disadvantage on their attack rolls; Shield:
 * +2 defense). Kept on a token until game time passes `ends`; combat rolls take them into account.
 */
import type { Boost, RollGrant, RollKind, RollMode } from "@/lib/actions";
import { rollKindLabel } from "@/lib/actions";
import type { Condition } from "@/lib/conditions";
import type { Attribute } from "@/lib/attributes";
import { targetLabel, type ModifierTarget } from "@/lib/modifiers";

export interface Status {
  source: string; // the action's name
  boosts: Boost[];
  grants: RollGrant[];
  conditions?: Condition[]; // catalog conditions it puts on them (Poisoned…): these run on by rounds, apart from the status
  sets?: { target: ModifierTarget; value: number; plus?: Attribute }[]; // "becomes" (at least): Strength 19, defense 13 + Agility
  factors?: { target: ModifierTarget; factor: number }[]; // multiplied: damage ×2, defense ×½
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

/**
 * One number as statuses leave it: `base` with boosts already added, then "becomes" (the highest one, if higher than
 * what it is: the most potent wins), then multipliers (rounded down). `attrMod` gives an attribute's modifier for a
 * "13 + Agility" kind of setting.
 */
export function settled(base: number, statuses: Status[], target: ModifierTarget, attrMod: (a: Attribute) => number = () => 0): { value: number; note: string } {
  const sets = statuses.flatMap((s) => (s.sets ?? []).filter((x) => x.target === target).map((x) => ({ v: x.value + (x.plus ? attrMod(x.plus) : 0), src: s.source })));
  const best = sets.reduce<{ v: number; src: string } | null>((b, x) => (!b || x.v > b.v ? x : b), null);
  let value = best && best.v > base ? best.v : base;
  const notes: string[] = best && best.v > base ? [`becomes ${best.v} (${best.src})`] : [];
  for (const s of statuses) for (const f of s.factors ?? []) if (f.target === target) {
    value = Math.floor(value * f.factor);
    notes.push(`×${f.factor === 0.5 ? "½" : f.factor} (${s.source})`);
  }
  return { value, note: notes.length ? ` [${notes.join(", ")}]` : "" };
}

/** The boosts on one thing (attack, defense, attribute:might…), as formulas to add up. */
export const boostsOn = (statuses: Status[], target: ModifierTarget): string[] => statuses.flatMap((s) => s.boosts.filter((b) => b.target === target).map((b) => b.value));

export const describeStatus = (s: Pick<Status, "boosts" | "grants">) =>
  [...s.grants.map((g) => `${g.mode} on ${rollKindLabel(g.roll).toLowerCase()}`), ...s.boosts.map((b) => `${b.value} ${targetLabel(b.target).toLowerCase()}`)].join(", ");
