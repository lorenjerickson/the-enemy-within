/**
 * Effects (conditions): named effects kept in the catalog (Poisoned: 1d2 poison damage a round for 6 rounds, Fortitude DC 12
 * ends it). Actions put them on whoever they're used on (or their user); while one lasts it may hurt or heal each
 * round, boost or hinder rolls, and the creature rolls its save at the end of each round to shake it off.
 */
import type { Boost, DamageType, RollGrant } from "@/lib/actions";
import { rollKindLabel } from "@/lib/actions";
import type { Attribute } from "@/lib/attributes";
import { targetLabel } from "@/lib/modifiers";

export interface EffectDef {
  id: number;
  name: string;
  description: string;
  per_round: string; // dice taken (or healed) at the end of each round; '' = none
  per_round_kind: "damage" | "healing";
  damage_type: DamageType | "";
  rounds: number; // how many rounds it lasts (6 s each; out of an encounter, every 6 s of game time is a round)
  save_attr: Attribute | ""; // the save that ends it, rolled at the end of each round; '' = none
  save_dc: number;
  boosts: Boost[]; // while it lasts
  roll_grants: RollGrant[];
}

/** An effect on a creature: how many rounds it has left, and who put it there. */
export interface Affliction {
  id?: number;
  effect: EffectDef;
  left: number;
  by: number | null;
}

/** "1d2 poison damage a round · 6 rounds · Fortitude DC 12 ends it · disadvantage on attacks". */
export function describeEffect(e: Pick<EffectDef, "per_round" | "per_round_kind" | "damage_type" | "rounds" | "save_attr" | "save_dc" | "boosts" | "roll_grants">, withRounds = true): string {
  return [
    e.per_round && (e.per_round_kind === "healing" ? `heals ${e.per_round} a round` : `${e.per_round}${e.damage_type ? ` ${e.damage_type}` : ""} damage a round`),
    ...e.roll_grants.map((g) => `${g.mode} on ${rollKindLabel(g.roll).toLowerCase()}`),
    ...e.boosts.map((b) => `${b.value} ${targetLabel(b.target).toLowerCase()}`),
    withRounds && `${e.rounds} round${e.rounds === 1 ? "" : "s"}`,
    e.save_attr && `${e.save_attr[0].toUpperCase()}${e.save_attr.slice(1)} DC ${e.save_dc} ends it`,
  ].filter(Boolean).join(" · ");
}
