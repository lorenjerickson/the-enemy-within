/**
 * Conditions, Effects and Modifiers (see the backlog doc's conceptual model):
 * - a Modifier is one change while it's active (+2 defense, disadvantage on attacks, 1d2 poison damage a round);
 * - an Effect is a named, reusable set of modifiers (Incapacitated, Entranced) with no lifecycle of its own;
 * - a Condition is what's put on a creature (Poisoned, Mesmerized): the effects it applies, plus its lifecycle (how
 *   long it lasts, the save that ends it). Actions apply conditions; the engine only ever reads modifiers.
 */
import type { Boost, DamageType, RollGrant, RollKind } from "@/lib/actions";
import { DAMAGE_TYPES, rollKindLabel } from "@/lib/actions";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { targetLabel, type ModifierTarget } from "@/lib/modifiers";

/** One change while it's active. More kinds (set, multiply, resist, forbid…) come with the backlog. */
export type Modifier =
  | { kind: "boost"; target: ModifierTarget; value: string } // add a number or dice (+2, -1d4)
  | { kind: "roll"; roll: RollKind; mode: "advantage" | "disadvantage" }
  | { kind: "periodic"; value: string; heal: boolean; damage_type: DamageType | "" } // at the end of each round
  | { kind: "instant"; value: string; heal: boolean; damage_type: DamageType | "" } // once, as the condition lands (a healing draught)
  | { kind: "resist"; damage_type: DamageType; level: Resist } // how they take a kind of damage
  | { kind: "extra"; value: string; damage_type: DamageType | ""; when: "dealing" | "taking" } // extra dice on a hit: on their hits, or on hits against them (by whoever put it on them)
  | { kind: "forbid"; what: Forbid } // can't do it at all (Incapacitated: no actions, bonus actions or reactions)
  | { kind: "autofail"; save: Attribute }; // fails that kind of save without rolling (Stunned: Might and Agility)

/** What a modifier can forbid: a kind of step, moving, or attacking whoever put the condition on them (Hypnotized). */
export type Forbid = "actions" | "bonus" | "reactions" | "movement" | "attack-source";
export const FORBIDS: [Forbid, string][] = [["actions", "actions"], ["bonus", "bonus actions"], ["reactions", "reactions"], ["movement", "moving"], ["attack-source", "attacking whoever caused it"]];

/** What a creature can't do now, and why (the condition or effect's name), plus saves it fails and who it can't attack. */
export interface Restrictions {
  forbid: Partial<Record<"action" | "bonus" | "reaction" | "movement", string>>; // by step kind (as stepKind names them)
  autofail: Attribute[];
  spare: number[]; // who it can't attack (whoever hypnotized it)
}
export const noRestrictions = (): Restrictions => ({ forbid: {}, autofail: [], spare: [] });
const STEP_KIND: Record<Exclude<Forbid, "attack-source">, "action" | "bonus" | "reaction" | "movement"> = { actions: "action", bonus: "bonus", reactions: "reaction", movement: "movement" };
/** Adds a set of modifiers' restrictions (from a condition named `name`, put on by `by`). */
export function restrictionsOf(mods: Modifier[], name: string, by: number | null, into: Restrictions = noRestrictions()): Restrictions {
  for (const m of mods) {
    if (m.kind === "forbid") {
      if (m.what === "attack-source") { if (by != null && !into.spare.includes(by)) into.spare.push(by); }
      else into.forbid[STEP_KIND[m.what]] ??= name;
    }
    if (m.kind === "autofail" && !into.autofail.includes(m.save)) into.autofail.push(m.save);
  }
  return into;
}

/** Extra damage on hits, as a creature carries it: on its own hits, and on hits it takes (from `from`, or anyone). */
export type Extra = { value: string; damage_type: string; name: string; from?: number | null };
export function extrasOf(mods: Modifier[], name: string, from: number | null = null): { dealing: Extra[]; taking: Extra[] } {
  const x = mods.filter((m) => m.kind === "extra") as Extract<Modifier, { kind: "extra" }>[];
  return {
    dealing: x.filter((m) => m.when === "dealing").map((m) => ({ value: m.value, damage_type: m.damage_type, name })),
    taking: x.filter((m) => m.when === "taking").map((m) => ({ value: m.value, damage_type: m.damage_type, name, from })),
  };
}

/** How a creature takes a kind of damage: half, double, or none. */
export type Resist = "resistant" | "vulnerable" | "immune";
export const RESISTS: Resist[] = ["resistant", "vulnerable", "immune"];

/** Several sources together: immune wins; resistant and vulnerable cancel out. */
export function combineResist(levels: Resist[] | undefined): Resist | null {
  if (!levels?.length) return null;
  if (levels.includes("immune")) return "immune";
  const r = levels.includes("resistant"), v = levels.includes("vulnerable");
  return r && v ? null : r ? "resistant" : v ? "vulnerable" : null;
}

/** Damage as a creature with that resistance takes it (resistant: half, rounded down). */
export const afterResist = (amount: number, r: Resist | null) => (r === "immune" ? 0 : r === "resistant" ? Math.floor(amount / 2) : r === "vulnerable" ? amount * 2 : amount);

/** Resistances from modifiers, by damage type. */
export function resistsOf(mods: Modifier[], into: Record<string, Resist[]> = {}): Record<string, Resist[]> {
  for (const m of mods) if (m.kind === "resist") (into[m.damage_type] ??= []).push(m.level);
  return into;
}

/** A named set of modifiers, reusable across conditions. */
export interface EffectDef {
  id: number;
  name: string;
  description: string;
  modifiers: Modifier[];
  builtin?: string; // a built-in effect's key: its modifiers are fixed
}

/** What's put on a creature: the effects it applies, how long it lasts, and the save that ends it. */
export interface ConditionDef {
  id: number;
  name: string;
  description: string;
  effects: number[]; // effect ids
  rounds: number; // 6 s each; out of an encounter, every 6 s of game time is a round
  save_attr: Attribute | ""; // rolled at the end of each round; success ends it ('' = none)
  save_dc: number;
  apply_save_attr?: Attribute | ""; // rolled as it lands; success negates it or halves its rounds ('' = none)
  apply_save_dc?: number;
  apply_save_outcome?: "negates" | "halves";
  builtin?: string; // a built-in condition's key: the effects it applies are fixed
}

/** A condition with its effects filled in, as it was when it was put on someone (later catalog edits don't reach it). */
export type Condition = Omit<ConditionDef, "effects"> & { effects: EffectDef[] };

/** A condition on a creature: how many rounds it has left, and who put it there. */
export interface Affliction {
  id?: number;
  condition: Condition;
  left: number;
  by: number | null;
}

export const modifiersOf = (c: Condition): Modifier[] => c.effects.flatMap((e) => e.modifiers);

/** Whether a condition stays on once it has landed (an instant heal and nothing else doesn't). */
export const lingers = (c: Condition) => modifiersOf(c).some((m) => m.kind !== "instant");

/** What a condition's modifiers do to rolls, as a status's boosts and roll grants. */
export function rollChanges(c: Condition | Pick<Condition, "effects">): { boosts: Boost[]; grants: RollGrant[] } {
  const mods = c.effects.flatMap((e) => e.modifiers);
  return {
    boosts: mods.flatMap((m) => (m.kind === "boost" ? [{ target: m.target, value: m.value }] : [])),
    grants: mods.flatMap((m) => (m.kind === "roll" ? [{ roll: m.roll, mode: m.mode }] : [])),
  };
}

/** "1d2 poison damage a round", "disadvantage on their attack rolls", "+2 defense". */
export function describeModifier(m: Modifier): string {
  if (m.kind === "periodic") return m.heal ? `heals ${m.value} a round` : `${m.value}${m.damage_type ? ` ${m.damage_type}` : ""} damage a round`;
  if (m.kind === "instant") return m.heal ? `heals ${m.value}` : `${m.value}${m.damage_type ? ` ${m.damage_type}` : ""} damage at once`;
  if (m.kind === "roll") return `${m.mode} on ${rollKindLabel(m.roll).toLowerCase()}`;
  if (m.kind === "forbid") return `can't ${m.what === "actions" ? "take actions" : m.what === "bonus" ? "take bonus actions" : m.what === "reactions" ? "react" : m.what === "movement" ? "move" : "attack whoever caused it"}`;
  if (m.kind === "autofail") return `fails ${m.save} saves`;
  if (m.kind === "extra") return m.when === "dealing" ? `+${m.value}${m.damage_type ? ` ${m.damage_type}` : ""} damage on their hits` : `takes +${m.value}${m.damage_type ? ` ${m.damage_type}` : ""} damage when hit by its source`;
  if (m.kind === "resist") return `${m.level === "immune" ? "immune to" : m.level} ${m.level === "immune" ? "" : "to "}${m.damage_type}`.replace("  ", " ");
  return `${m.value} ${targetLabel(m.target).toLowerCase()}`;
}

/** An effect's modifiers in words, with a full set said once ("resistant to all damage", "disadvantage on ability checks"). */
export function describeEffect(e: Pick<EffectDef, "modifiers">): string {
  let mods = e.modifiers;
  const out: string[] = [];
  for (const level of RESISTS) {
    const r = mods.filter((m) => m.kind === "resist" && m.level === level);
    if (r.length >= DAMAGE_TYPES.length) { out.push(`${level === "immune" ? "immune to" : `${level} to`} all damage`); mods = mods.filter((m) => !r.includes(m)); }
  }
  for (const mode of ["advantage", "disadvantage"] as const) {
    const c = mods.filter((m) => m.kind === "roll" && m.mode === mode && m.roll.startsWith("check:"));
    if (c.length >= ATTRIBUTES.length) { out.push(`${mode} on ability checks`); mods = mods.filter((m) => !c.includes(m)); }
  }
  return [...mods.map(describeModifier), ...out].join(", ");
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Fortitude DC 12 when applied negates · 6 rounds · Fortitude DC 12 ends it". */
export const describeLifecycle = (c: Pick<ConditionDef, "rounds" | "save_attr" | "save_dc" | "apply_save_attr" | "apply_save_dc" | "apply_save_outcome">, withRounds = true) =>
  [
    c.apply_save_attr && `${cap(c.apply_save_attr)} DC ${c.apply_save_dc ?? 12} when applied ${c.apply_save_outcome === "halves" ? "halves it" : "negates"}`,
    withRounds && `${c.rounds} round${c.rounds === 1 ? "" : "s"}`,
    c.save_attr && `${cap(c.save_attr)} DC ${c.save_dc} ends it`,
  ].filter(Boolean).join(" · ");

/** "1d2 poison damage a round, disadvantage on their attack rolls · 6 rounds · Fortitude DC 12 ends it" ("heals 1d10" alone for an instant one). */
export const describeCondition = (c: Condition, withRounds = true) =>
  [c.effects.map(describeEffect).filter(Boolean).join(", "), lingers(c) && describeLifecycle(c, withRounds)].filter(Boolean).join(" · ");
