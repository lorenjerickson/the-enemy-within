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
  tweaks?: RollTweak[]; // what happens to the dice: rerolls, a minimum, a wider critical range, no criticals against them
}

/**
 * Changes to how a d20 comes up: reroll a result at or below `at` once and keep the new one (Lucky: 1); count a
 * result below `min` as `min` (Reliable Talent: 10 on skill checks); attacks critical on `range`–20 (Improved
 * Critical: 19); critical hits against them are normal hits (adamantine armour).
 */
export type RollTweak = { kind: "reroll"; roll: RollKind; at: number } | { kind: "minroll"; roll: RollKind; min: number } | { kind: "crit"; range: number } | { kind: "nocrit" };

/** The reroll and minimum on a d20 for any of these kinds of roll (the most generous of each), and where they come from. */
export function d20Tweaks(statuses: Status[], kinds: RollKind[]): { reroll: number; min: number } {
  let reroll = 0, min = 0;
  for (const s of statuses) for (const t of s.tweaks ?? []) {
    if (t.kind === "reroll" && kinds.includes(t.roll)) reroll = Math.max(reroll, t.at);
    if (t.kind === "minroll" && kinds.includes(t.roll)) min = Math.max(min, t.min);
  }
  return { reroll, min };
}
/** The lowest natural roll that's a critical hit for them (20 unless something widens it). */
export const critRange = (statuses: Status[]) => Math.min(20, ...statuses.flatMap((s) => (s.tweaks ?? []).flatMap((t) => (t.kind === "crit" ? [t.range] : []))));
/** Whether critical hits against them count as normal hits. */
export const critImmune = (statuses: Status[] = []) => statuses.some((s) => (s.tweaks ?? []).some((t) => t.kind === "nocrit"));

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
