import type { ModifierTarget } from "@/lib/modifiers";

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
}

/** "" = instant. Clock units, then units relative to play ("until the next turn / long rest"). */
export const DURATION_UNITS = ["", "minute", "hour", "day", "turn", "round", "short rest", "long rest"] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export function formatDuration(amount: number, unit: DurationUnit): string {
  if (!unit) return "instant";
  if (["turn", "round", "short rest", "long rest"].includes(unit) && amount <= 1) return `until next ${unit}`;
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}
