import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { SKILLS, type ModifierTarget } from "@/lib/modifiers";

export const ROLL_MODES = ["normal", "advantage", "disadvantage"] as const;
export type RollMode = (typeof ROLL_MODES)[number];

/** D&D 5e damage types. */
export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** A temporary change an action applies, e.g. +2 to stealth. */
export interface Boost {
  target: ModifierTarget;
  value: string; // signed number or dice
  on?: "self" | "target"; // who gets it: whoever uses the action (default), or who it's used on
}

/** "" = instant. Clock units, then units relative to play ("until the next turn / long rest"). */
export const DURATION_UNITS = ["", "minute", "hour", "day", "turn", "round", "short rest", "long rest"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export function formatDuration(amount: number, unit: DurationUnit): string {
  if (!unit) return "instant";
  if (["turn", "round", "short rest", "long rest"].includes(unit) && amount <= 1) return `until next ${unit}`;
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

/** Rolls an action can give advantage/disadvantage on. */
export type RollKind = "attack" | "attacked" | `save:${Attribute}` | `check:${Attribute}` | `skill:${string}`;

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const ROLL_KIND_GROUPS: [string, [RollKind, string][]][] = [
  ["Combat", [["attack", "Their attack rolls"], ["attacked", "Attack rolls against them"]]],
  ["Saving throws", ATTRIBUTES.map((a) => [`save:${a}`, `${cap(a)} save`])],
  ["Ability checks", ATTRIBUTES.map((a) => [`check:${a}`, `${cap(a)} check`])],
  ["Skill checks", SKILLS.map((s) => [`skill:${s}`, `${cap(s)} check`])],
];
const ROLL_KIND_LABELS = new Map(ROLL_KIND_GROUPS.flatMap(([, opts]) => opts));
export const isRollKind = (s: string): s is RollKind => ROLL_KIND_LABELS.has(s as RollKind);
export const rollKindLabel = (k: RollKind) => ROLL_KIND_LABELS.get(k) ?? k;

/** Advantage or disadvantage an action grants on a kind of roll. */
export interface RollGrant {
  roll: RollKind;
  mode: "advantage" | "disadvantage";
  on?: "self" | "target"; // who gets it: whoever uses the action (default), or who it's used on
}
