/**
 * Everything that changes a creature's numbers right now, in one place, so every roll and every speed sees the same
 * thing: statuses left by actions, conditions on it (their effects' modifiers), and a character's profession
 * modifiers (always on).
 */
import { db, getProfession, listAfflictions, listCharacterProfessionIds, listProfessionModifiers, listTokenStatuses } from "@/lib/db";
import { rollChanges } from "@/lib/conditions";
import { combineModes, type Status } from "@/lib/status";
import { diceRange } from "@/lib/dice";
import { ATTRIBUTES, SKILLS_BY_ATTRIBUTE, formatModifier, modifier, type Attribute, type Attributes } from "@/lib/attributes";
import type { RollPart, RollSpec } from "@/lib/rolls";
import type { ModifierTarget } from "@/lib/modifiers";
import type { MovementType } from "@/lib/creatureTypes";

/** A character's profession modifiers, as statuses (one per profession) that never run out. */
export function professionStatuses(characterId: number | null): Status[] {
  if (!characterId) return [];
  return listCharacterProfessionIds(characterId).flatMap((pid) => {
    const boosts = listProfessionModifiers(pid).filter((m) => m.value.trim() && m.value.trim() !== "0").map((m) => ({ target: m.target as ModifierTarget, value: /^[+-]/.test(m.value.trim()) ? m.value.trim() : `+${m.value.trim()}` }));
    return boosts.length ? [{ source: getProfession(pid)?.name ?? "Profession", boosts, grants: [] }] : [];
  });
}

/** Every status-like change on a token now: statuses, conditions, professions. */
export function changesOn(tokenId: number): Status[] {
  const t = db.prepare<[number], { level_id: number; character_id: number | null }>("SELECT level_id, character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return [];
  return [
    ...(listTokenStatuses(t.level_id).get(tokenId) ?? []),
    ...(listAfflictions(t.level_id).get(tokenId) ?? []).map((a) => ({ source: a.condition.name, ...rollChanges(a.condition) })),
    ...professionStatuses(t.character_id),
  ];
}

/** A boost's value as a steady number (dice count as their average: speed and scores can't be rolled each time). */
const steady = (value: string) => {
  const r = diceRange(value.replace(/^\+/, ""));
  return Math.round((r.min + r.max) / 2);
};

/** The boosts on one thing, added up as steady numbers. */
export const steadyBoost = (changes: Status[], target: ModifierTarget) => changes.flatMap((s) => s.boosts.filter((b) => b.target === target)).reduce((sum, b) => sum + steady(b.value), 0);

/** A token's speed (feet a round) of one kind, with what changes it; never below 0. */
export function speedOf(tokenId: number, movement: string | Record<string, number>, type: MovementType = "walking"): number {
  const base = (typeof movement === "string" ? JSON.parse(movement || "{}") : movement)[type] ?? 0;
  return Math.max(0, base + steadyBoost(changesOn(tokenId), `movement:${type}`));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A skill check for a token: d20 + the best attribute's modifier for the skill (attributes as boosted now) + every
 * boost on the skill (professions, statuses, conditions), with advantage or disadvantage from anything granting it on
 * the skill or that attribute's checks.
 */
export function skillCheckFor(tokenId: number, skill: string, attributes: Attributes): RollSpec {
  const changes = changesOn(tokenId);
  const score = (a: Attribute) => (attributes[a] ?? 10) + steadyBoost(changes, `attribute:${a}`);
  const attrs = ATTRIBUTES.filter((a) => SKILLS_BY_ATTRIBUTE[a].includes(skill));
  const best = attrs.reduce((b, a) => (modifier(score(a)) > modifier(score(b)) ? a : b), attrs[0]);
  const parts: RollPart[] = [{ formula: "1d20", source: `${cap(skill)} check` }];
  if (best) {
    const m = modifier(score(best));
    if (m !== 0) parts.push({ formula: String(m), source: `${cap(best)} ${score(best)} (${formatModifier(m)})` });
  }
  for (const s of changes) for (const b of s.boosts) if (b.target === `skill:${skill}`) parts.push({ formula: b.value.replace(/^\+/, ""), source: s.source });
  const mode = combineModes("normal", changes, `skill:${skill}`, best ? [combineModes("normal", changes, `check:${best}`)] : []);
  return { label: `${cap(skill)} check`, parts, mode };
}
