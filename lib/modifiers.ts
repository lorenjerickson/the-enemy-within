import { ATTRIBUTES, SKILLS_BY_ATTRIBUTE, type Attribute } from "@/lib/attributes";
import { MOVEMENT_TYPES, type MovementType } from "@/lib/creatureTypes";

export const SKILLS = [...new Set(Object.values(SKILLS_BY_ATTRIBUTE).flat())].sort();

/** What a modifier changes. */
export type ModifierTarget =
  | `attribute:${Attribute}`
  | `skill:${string}`
  | "health"
  | "attack"
  | "damage"
  | "defense"
  | `movement:${MovementType}`;

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Grouped options for pickers: [group label, [target, label][]]. */
export const MODIFIER_TARGET_GROUPS: [string, [ModifierTarget, string][]][] = [
  ["Attributes", ATTRIBUTES.map((a) => [`attribute:${a}`, capitalize(a)])],
  ["Skills", SKILLS.map((s) => [`skill:${s}`, capitalize(s)])],
  ["Combat", [["health", "Health"], ["attack", "Attack (to-hit)"], ["damage", "Damage"], ["defense", "Defense"]]],
  ["Movement", MOVEMENT_TYPES.map((m) => [`movement:${m}`, capitalize(m)])],
];

const LABELS = new Map(MODIFIER_TARGET_GROUPS.flatMap(([, opts]) => opts));
export const isModifierTarget = (s: string): s is ModifierTarget => LABELS.has(s as ModifierTarget);
export const targetLabel = (t: ModifierTarget) => {
  const group = MODIFIER_TARGET_GROUPS.find(([, opts]) => opts.some(([v]) => v === t))?.[0];
  return group === "Combat" ? LABELS.get(t)! : `${LABELS.get(t)} (${group?.replace(/s$/, "").toLowerCase()})`;
};
