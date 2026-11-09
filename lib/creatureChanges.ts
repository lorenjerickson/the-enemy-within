/**
 * Everything that changes a creature's numbers right now, in one place, so every roll and every speed sees the same
 * thing: statuses left by actions, conditions on it (their effects' modifiers), and a character's profession
 * modifiers (always on).
 */
import { db, getItem, getProfession, getStandingEffects, listAfflictions, listCharacterProfessionIds, listEffectDefs, listProfessionModifiers, listTokenStatuses, type Equipment } from "@/lib/db";
import { sensesFrom, type Senses } from "@/lib/conditions";
import { combineResist, extrasOf, modifiersOf, resistsOf, restrictionsOf, rollChanges, noRestrictions, type EffectDef, type Extra, type Resist, type Restrictions } from "@/lib/conditions";
import { combineModes, d20Tweaks, settled, type Status } from "@/lib/status";
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

/**
 * A token's standing effects: a creature's own (always on) and those of what it has equipped, each with where it
 * comes from ("Giant Rat", "Rubber gloves").
 */
export function standingEffects(tokenId: number, equipment?: Equipment): (EffectDef & { from: string })[] {
  const t = db.prepare<[number], { creature_id: number | null; character_id: number | null; equipment: string | null }>("SELECT creature_id, character_id, equipment FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return [];
  const all = listEffectDefs(), byId = (ids: number[], from: string) => ids.flatMap((id) => { const e = all.find((x) => x.id === id); return e ? [{ ...e, from }] : []; });
  const creature = t.creature_id ? db.prepare<[number], { name: string; equipment: string }>("SELECT name, equipment FROM creatures WHERE id = ?").get(t.creature_id) : undefined;
  const worn: Equipment = equipment ?? JSON.parse(
    (t.character_id ? db.prepare<[number], { equipment: string }>("SELECT equipment FROM characters WHERE id = ?").get(t.character_id)?.equipment : t.equipment ?? creature?.equipment) ?? "{}",
  );
  return [
    ...(t.creature_id && creature ? byId(getStandingEffects({ creature_id: t.creature_id }), creature.name) : []),
    ...[...new Set(Object.values(worn).filter((id): id is number => !!id))].flatMap((id) => { const item = getItem(id); return item ? byId(getStandingEffects({ item_id: id }), item.name) : []; }),
  ];
}

/** Standing effects as statuses (their boosts and roll effects). */
export const standingStatuses = (tokenId: number, equipment?: Equipment): Status[] =>
  standingEffects(tokenId, equipment).map((e) => ({ source: `${e.name} (${e.from})`, ...rollChanges({ effects: [e] }) })).filter((s) => s.boosts.length || s.grants.length || s.sets.length || s.factors.length || s.tweaks.length);

/** How a token takes each kind of damage now: its standing effects and the conditions on it. */
export function resistancesOf(tokenId: number, levelId: number, equipment?: Equipment): Record<string, Resist[]> {
  const out = resistsOf(standingEffects(tokenId, equipment).flatMap((e) => e.modifiers));
  for (const a of listAfflictions(levelId).get(tokenId) ?? []) resistsOf(modifiersOf(a.condition), out);
  return out;
}
export const resistanceTo = (r: Record<string, Resist[]>, type: string) => combineResist(r[type]);

/** What a token can see, and whether it can be seen, now: its standing effects and the conditions on it. */
export function sensesOf(tokenId: number, levelId?: number): Senses {
  const level = levelId ?? db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(tokenId)?.level_id;
  return sensesFrom([...standingEffects(tokenId).flatMap((e) => e.modifiers), ...(level !== undefined ? (listAfflictions(level).get(tokenId) ?? []).flatMap((a) => modifiersOf(a.condition)) : [])]);
}

/** What a token can't do now (conditions on it, its standing effects), and why. */
export function restrictionsOn(tokenId: number, levelId?: number): Restrictions {
  const level = levelId ?? db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(tokenId)?.level_id;
  const out = noRestrictions();
  for (const e of standingEffects(tokenId)) restrictionsOf(e.modifiers, e.name, null, out);
  if (level !== undefined) for (const a of listAfflictions(level).get(tokenId) ?? []) restrictionsOf(modifiersOf(a.condition), a.condition.name, a.by, out);
  return out;
}

/**
 * A token's maximum health now: the rolled maximum, plus professions' health modifiers (always on) and conditions'
 * or standing effects' changes to it (Aid +5; a necrotic drain); never below 1.
 */
export function effectiveMaxHp(tokenId: number, stored: number): number {
  const t = db.prepare<[number], { level_id: number; character_id: number | null }>("SELECT level_id, character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return stored;
  const fromProfessions = steadyBoost(professionStatuses(t.character_id), "health");
  const mods = [...standingEffects(tokenId).flatMap((e) => e.modifiers), ...(listAfflictions(t.level_id).get(tokenId) ?? []).flatMap((a) => modifiersOf(a.condition))];
  return Math.max(1, stored + fromProfessions + mods.reduce((sum, m) => sum + (m.kind === "maxhp" ? m.value : 0), 0));
}

/** Whether a token has a condition it can spend its action shaking off (Shake off). */
export function canShakeOff(tokenId: number, levelId: number): boolean {
  return (listAfflictions(levelId).get(tokenId) ?? []).some((a) => a.condition.save_action && a.condition.save_attr);
}

/** Extra damage on hits a token carries now: from its standing effects (taking: from anyone) and conditions (taking: from whoever put it on them). */
export function extrasOn(tokenId: number, levelId: number): { dealing: Extra[]; taking: Extra[] } {
  const out = { dealing: [] as Extra[], taking: [] as Extra[] };
  const add = (x: { dealing: Extra[]; taking: Extra[] }) => { out.dealing.push(...x.dealing); out.taking.push(...x.taking); };
  for (const e of standingEffects(tokenId)) add(extrasOf(e.modifiers, e.name));
  for (const a of listAfflictions(levelId).get(tokenId) ?? []) add(extrasOf(modifiersOf(a.condition), a.condition.name, a.by));
  return out;
}

/** Every status-like change on a token now: statuses, conditions, standing effects, professions. */
export function changesOn(tokenId: number): Status[] {
  const t = db.prepare<[number], { level_id: number; character_id: number | null }>("SELECT level_id, character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return [];
  return [
    ...(listTokenStatuses(t.level_id).get(tokenId) ?? []),
    ...(listAfflictions(t.level_id).get(tokenId) ?? []).map((a) => ({ source: a.condition.name, ...rollChanges(a.condition) })),
    ...standingStatuses(tokenId),
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

/** Speed multipliers on a token now (conditions, standing effects): Prone ×½, a haste ×2. */
export function speedFactor(tokenId: number): number {
  const t = db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(tokenId);
  const mods = [...standingEffects(tokenId).flatMap((e) => e.modifiers), ...(t ? (listAfflictions(t.level_id).get(tokenId) ?? []).flatMap((a) => modifiersOf(a.condition)) : [])];
  return mods.reduce((f, m) => (m.kind === "speed" ? f * m.factor : f), 1);
}

/** A token's speed (feet a round) of one kind, with what changes it (boosts, then multipliers); never below 0. */
export function speedOf(tokenId: number, movement: string | Record<string, number>, type: MovementType = "walking"): number {
  const base = (typeof movement === "string" ? JSON.parse(movement || "{}") : movement)[type] ?? 0;
  const changes = changesOn(tokenId);
  return Math.max(0, Math.floor(settled(base + steadyBoost(changes, `movement:${type}`), changes, `movement:${type}`).value * speedFactor(tokenId)));
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * A skill check for a token: d20 + the best attribute's modifier for the skill (attributes as boosted now) + every
 * boost on the skill (professions, statuses, conditions), with advantage or disadvantage from anything granting it on
 * the skill or that attribute's checks.
 */
export function skillCheckFor(tokenId: number, skill: string, attributes: Attributes): RollSpec {
  const changes = changesOn(tokenId);
  const score = (a: Attribute) => settled((attributes[a] ?? 10) + steadyBoost(changes, `attribute:${a}`), changes, `attribute:${a}`).value;
  const attrs = ATTRIBUTES.filter((a) => SKILLS_BY_ATTRIBUTE[a].includes(skill));
  const best = attrs.reduce((b, a) => (modifier(score(a)) > modifier(score(b)) ? a : b), attrs[0]);
  const parts: RollPart[] = [{ formula: "1d20", source: `${cap(skill)} check` }];
  if (best) {
    const m = modifier(score(best));
    if (m !== 0) parts.push({ formula: String(m), source: `${cap(best)} ${score(best)} (${formatModifier(m)})` });
  }
  for (const s of changes) for (const b of s.boosts) if (b.target === `skill:${skill}` || b.target === "check") parts.push({ formula: b.value.replace(/^\+/, ""), source: s.source });
  const mode = combineModes("normal", changes, `skill:${skill}`, best ? [combineModes("normal", changes, `check:${best}`)] : []);
  const t = d20Tweaks(changes, [`skill:${skill}`, ...(best ? [`check:${best}` as const] : [])]);
  return { label: `${cap(skill)} check`, parts, mode, ...(t.reroll ? { reroll: t.reroll } : {}), ...(t.min ? { min: t.min } : {}) };
}

/** A saving throw for a token: d20 + the attribute's modifier (as boosted now), with advantage or disadvantage from anything granting it on that save. */
export function saveRollFor(tokenId: number, attr: Attribute, label: string): RollSpec {
  const changes = changesOn(tokenId);
  const t = db.prepare<[number], { character_id: number | null; creature_id: number | null }>("SELECT character_id, creature_id FROM map_tokens WHERE id = ?").get(tokenId);
  const row = t?.character_id
    ? db.prepare<[number], { attributes: string }>("SELECT attributes FROM characters WHERE id = ?").get(t.character_id)
    : t?.creature_id ? db.prepare<[number], { attributes: string }>("SELECT attributes FROM creatures WHERE id = ?").get(t.creature_id) : undefined;
  const score = (JSON.parse(row?.attributes ?? "{}") as Partial<Attributes>)[attr] ?? 10;
  const boosted = settled(score + steadyBoost(changes, `attribute:${attr}`), changes, `attribute:${attr}`).value, m = modifier(boosted);
  const parts: RollPart[] = [{ formula: "1d20", source: `${cap(attr)} save` }];
  if (m !== 0) parts.push({ formula: String(m), source: `${cap(attr)} ${boosted} (${formatModifier(m)})` });
  for (const s of changes) for (const b of s.boosts) if (b.target === "save" || b.target === `save:${attr}`) parts.push({ formula: b.value.replace(/^\+/, ""), source: s.source });
  const tw = d20Tweaks(changes, [`save:${attr}`]);
  return { label, parts, mode: combineModes("normal", changes, `save:${attr}`), ...(tw.reroll ? { reroll: tw.reroll } : {}), ...(tw.min ? { min: tw.min } : {}) };
}
