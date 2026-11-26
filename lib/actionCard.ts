// Client-safe: turns a saved action into the card a player sees (no database here: the action editor builds it live).
import { areaFires } from "@/lib/aoe";
import type { Action } from "@/lib/db/catalog"; // type only
import type { Condition } from "@/lib/conditions";
import type { EffectKind } from "@/lib/effects";
import type { GearAction } from "@/lib/roundPlan";
import type { ActionStatuses, Status } from "@/lib/status";

/** How long an action's effect lasts, in game minutes (a round is 6 s; rests count as 1 and 8 hours); 0 = instant. */
export function durationMinutes(amount: number, unit: string): number {
  const per: Record<string, number> = { round: 0.1, turn: 0.1, minute: 1, hour: 60, day: 1440, "short rest": 60, "long rest": 480 };
  return (per[unit] ?? 0) * Math.max(1, amount);
}

/** How a lasting area looks, from its damage type. */
export const lookOf = (type: string): EffectKind =>
  type === "fire" ? "fire" : type === "lightning" ? "lightning" : type === "cold" ? "snow" : type === "thunder" ? "wind"
  : type === "poison" ? "poison" : type === "acid" ? "acid" : type === "necrotic" ? "necrotic" : type === "radiant" ? "radiant"
  : type === "psychic" ? "psychic" : type === "force" ? "force" : "fog";

export type ActionFields = Omit<Action, "id" | "profession_id" | "item_id" | "creature_id"> & { id?: number };

/** The statuses an action leaves (on whoever uses it, and on its target), lasting its duration (instant: 1 round). */
function statusesOf(a: ActionFields, conditionOf: (id: number) => Condition | undefined): { statuses?: ActionStatuses } {
  const on = (who: "self" | "target"): Status | undefined => {
    // (Actions' own boosts and roll effects were folded into catalog conditions; any left over still count.)
    const boosts = a.boosts.filter((b) => (b.on ?? "self") === who), grants = a.roll_grants.filter((g) => (g.on ?? "self") === who);
    const conditions = (a.conditions ?? []).filter((c) => c.on === who).flatMap((c) => conditionOf(c.id) ?? []); // as they are now in the catalog
    return boosts.length || grants.length || conditions.length ? { source: a.name, boosts, grants, ...(conditions.length ? { conditions } : {}) } : undefined;
  };
  const self = on("self"), target = on("target");
  if (!self && !target) return {};
  return { statuses: { ...(self ? { self } : {}), ...(target ? { target } : {}), minutes: durationMinutes(a.duration_amount, a.duration_unit) || 0.1 } };
}

/** An action as a plan (and the player's card) needs it. itemRange: an item's reach, for an action with no range of its own. */
export function gearOf(a: ActionFields, conditionOf: (id: number) => Condition | undefined, itemRange = 5): GearAction {
  return {
    id: a.id ?? 0, name: a.name, description: a.description, damageType: a.damage_type || undefined, ...(a.kind && a.kind !== "action" ? { kind: a.kind } : {}), seconds: a.seconds, range: Math.max(1, Math.round((a.range_ft || itemRange) / 5)), attack: a.attack, damage: a.damage, roll: a.roll,
    ...(a.area_shape && a.area_ft > 0
      ? { area: { shape: a.area_shape, ft: a.area_ft, dc: a.save_dc, save: a.save_attr, half: !!a.save_half, minutes: a.area_lasts ? durationMinutes(a.duration_amount, a.duration_unit) || 0.1 : 0, look: lookOf(a.damage_type), fires: areaFires(a.area_fires), ...(a.area_shape === "circle" && a.area_at === "self" ? { at: "self" as const } : {}) } }
      : {}),
    ...statusesOf(a, conditionOf),
    ...((): { targets: "self" | "others" | "anyone"; self?: true } => {
      // Who it can be used on: as the GM set it, else others if it does damage or affects a target, else themselves.
      const auto = !a.damage && !a.boosts.some((b) => b.on === "target") && !a.roll_grants.some((g) => g.on === "target") && !a.conditions.some((c) => c.on === "target") ? "self" : "others";
      const targets = a.kind === "reaction" ? "self" : a.area_shape ? "others" : a.targets || auto; // a reaction readies something on its user
      return targets === "self" ? { targets, self: true } : { targets };
    })(),
    targeting: { who: a.target_who, count: a.target_count, n: a.target_n },
  };
}
