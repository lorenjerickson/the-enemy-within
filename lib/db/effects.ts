import { db } from "@/lib/db/connection";
import { asCondition, DEFAULT_LIFECYCLE, reapplied } from "@/lib/conditions";
import type { Effect, Modifier, Condition, Lifecycle, Duration, Affliction } from "@/lib/conditions";
import { BUILTIN_PIECES, BUILTIN_CONDITIONS, BUILTIN_EFFECTS } from "@/lib/builtinConditions";
import { SEEDED_EFFECTS, compileSeed } from "@/lib/seedEffects";
import { ftPerSec } from "@/lib/speed";
import type { Attribute } from "@/lib/attributes";
import { listCharacterProfessionIds } from "@/lib/db/catalog";
import type { DamageType, Boost, RollGrant } from "@/lib/actions";

// ---------- Conditions, effects and modifiers (Poisoned…) ----------

/** The catalog effects an item gives whoever has it equipped, or a creature always has (its "standing" effects). */
export function getStandingEffects(owner: { item_id: number } | { creature_id: number }): number[] {
  const [table, id] = "item_id" in owner ? ["items", owner.item_id] : ["creatures", owner.creature_id];
  return JSON.parse(db.prepare<[number], { effects: string }>(`SELECT effects FROM ${table} WHERE id = ?`).get(id)?.effects ?? "[]");
}

export function setStandingEffects(owner: { item_id: number } | { creature_id: number }, effects: number[]): void {
  const [table, id] = "item_id" in owner ? ["items", owner.item_id] : ["creatures", owner.creature_id];
  db.prepare<[string, number]>(`UPDATE ${table} SET effects = ? WHERE id = ?`).run(JSON.stringify(effects), id);
}

 // a built-in effect's key (lib/builtinConditions.ts): its rules follow the code
export const LIFECYCLE_COLUMNS: [keyof Lifecycle | "duration", string][] = [
  ["duration", "TEXT NOT NULL DEFAULT 'rounds'"], // rounds | equipped | always
  ["rounds", "INTEGER NOT NULL DEFAULT 1"],
  ["save_attr", "TEXT NOT NULL DEFAULT ''"], // the save that ends it ('' = none)
  ["save_dc", "INTEGER NOT NULL DEFAULT 12"],
  ["apply_save_attr", "TEXT NOT NULL DEFAULT ''"], // a save as it lands ('' = none)
  ["apply_save_dc", "INTEGER NOT NULL DEFAULT 12"],
  ["apply_save_outcome", "TEXT NOT NULL DEFAULT 'negates'"], // on a success: negates | halves (its rounds)
  ["save_when", "TEXT NOT NULL DEFAULT 'end'"], // when the save to end it is rolled: end | start | damaged
  ["save_action", "INTEGER NOT NULL DEFAULT 0"], // 1: Shake off (an action) rolls it too
  ["saves_needed", "INTEGER NOT NULL DEFAULT 1"], // successful saves to end it
  ["ends_on_damage", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when hurt
  ["ends_on_attack", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when they attack
  ["ends_on_trigger", "INTEGER NOT NULL DEFAULT 0"], // 1: ends once its trigger fires
  ["concentration", "INTEGER NOT NULL DEFAULT 0"], // 1: needs whoever put it on to keep concentrating
  ["reapply", "TEXT NOT NULL DEFAULT 'refresh'"], // put on again: refresh | stack | ignore
  ["stack_limit", "INTEGER NOT NULL DEFAULT 0"], // stacking: at most this many (0 = no limit)
];

type EffectRow = Omit<Effect, "modifiers"> & { modifiers: string };

const parseEffect = (r: EffectRow): Effect => ({ ...r, modifiers: JSON.parse(r.modifiers) as Modifier[] });

/** Every catalog effect; an aura's (or trigger's) effect filled in as `given` (one level, so they can't loop). */
export function listEffectDefs(): Effect[] {
  const raw = db.prepare<[], EffectRow>("SELECT * FROM effects ORDER BY name").all().map(parseEffect);
  const gives = (m: Modifier) => m.kind === "aura" || (m.kind === "trigger" && !!m.condition);
  if (!raw.some((e) => e.modifiers.some(gives))) return raw;
  const given = (id: number) => { const e = raw.find((x) => x.id === id); return e ? asCondition(e) : undefined; };
  return raw.map((e) => ({ ...e, modifiers: e.modifiers.map((m) => (gives(m) ? { ...m, given: given((m as { condition: number }).condition) } : m)) }));
}

export function getEffectDef(id: number): Effect | undefined {
  return listEffectDefs().find((e) => e.id === id);
}

/** A catalog effect as it's put on a creature (what the round engine and afflictions keep). */
export function getCondition(effectId: number): Condition | undefined {
  const e = getEffectDef(effectId);
  return e ? asCondition(e) : undefined;
}

/**
 * Inserts when id is null, otherwise updates; returns the id. Lifecycle fields left out keep what the effect had (a
 * new one: the defaults, lasting 1 round).
 */
export function saveEffectDef(id: number | null, e: Pick<Effect, "name" | "description" | "modifiers"> & Partial<Lifecycle & { duration: Duration; builtin: string }>): number {
  const was = id === null ? undefined : db.prepare<[number], EffectRow>("SELECT * FROM effects WHERE id = ?").get(id);
  const life = Object.fromEntries(LIFECYCLE_COLUMNS.map(([k]) => [k, (e as Record<string, unknown>)[k] ?? (was as Record<string, unknown> | undefined)?.[k] ?? (k === "duration" ? "rounds" : DEFAULT_LIFECYCLE[k])]));
  const params = { ...life, name: e.name, description: e.description, builtin: e.builtin ?? was?.builtin ?? "", modifiers: JSON.stringify(e.modifiers.map((m) => (m.kind === "aura" || m.kind === "trigger" ? { ...m, given: undefined } : m))) };
  const cols = ["name", "description", "modifiers", "builtin", ...LIFECYCLE_COLUMNS.map(([k]) => k)];
  if (id === null) return Number(db.prepare(`INSERT INTO effects (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`).run(params).lastInsertRowid);
  db.prepare(`UPDATE effects SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...params, id });
  return id;
}

/** Removes an effect, and takes it off the actions that grant it and the items and creatures that have it. */
export function removeEffectDef(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM effects WHERE id = ?").run(id);
    for (const a of db.prepare<[], { id: number; conditions: string }>("SELECT id, conditions FROM actions WHERE conditions != '[]'").all()) {
      const list = (JSON.parse(a.conditions) as { id: number; on: string }[]).filter((c) => c.id !== id);
      db.prepare("UPDATE actions SET conditions = ? WHERE id = ?").run(JSON.stringify(list), a.id);
    }
    for (const table of ["items", "creatures"]) for (const r of db.prepare<[], { id: number; effects: string }>(`SELECT id, effects FROM ${table} WHERE effects != '[]'`).all()) {
      db.prepare(`UPDATE ${table} SET effects = ? WHERE id = ?`).run(JSON.stringify((JSON.parse(r.effects) as number[]).filter((x) => x !== id)), r.id);
    }
  })();
}

/** An effect as the first version kept it (effect_defs: one row per condition, modifiers inline). */
export type OldEffectDef = { id: number; name: string; description: string; per_round: string; per_round_kind: string; damage_type: DamageType | ""; rounds: number; save_attr: Attribute | ""; save_dc: number; boosts: Boost[]; roll_grants: RollGrant[] };

export const oldModifiers = (o: OldEffectDef): Modifier[] => [
  ...(o.per_round ? [{ kind: "periodic" as const, value: o.per_round, heal: o.per_round_kind === "healing", damage_type: o.damage_type }] : []),
  ...o.boosts.map((b) => ({ kind: "boost" as const, target: b.target, value: b.value })),
  ...o.roll_grants.map((g) => ({ kind: "roll" as const, roll: g.roll, mode: g.mode })),
];

/** An old effect as the condition it really was, with one effect of the same name holding its modifiers. */
const oldToCondition = (o: OldEffectDef): Condition => ({ id: o.id, name: o.name, description: o.description, rounds: o.rounds, save_attr: o.save_attr, save_dc: o.save_dc, effects: [{ id: o.id, name: o.name, description: "", modifiers: oldModifiers(o) }] });

/**
 * Turns the retired conditions into effects (once at start-up, and after importing an older campaign export). Each
 * condition becomes an effect with its lifecycle: a custom condition with one effect of its own merges into that
 * effect (which keeps its name: Mesmerize → Mesmerized); any other (several effects, shared ones, none) becomes a new
 * effect named after it, with all their rules. Everything that pointed at a condition then points at its effect:
 * actions, triggers and auras in effects' rules, effects on tokens now, aura passes. The building blocks the old
 * built-ins were made of go, unless something has one or no built-in effect has its rules. Returns how many conditions it turned into effects.
 */
export function migrateConditions(): number {
  type CondRow = Lifecycle & { id: number; name: string; description: string; effects: string; builtin: string };
  const conds = db.prepare<[], CondRow>("SELECT * FROM conditions ORDER BY id").all();
  if (!conds.length) return 0;
  db.transaction(() => {
    const pieceKeys = new Set(BUILTIN_PIECES.map((p) => p.key));
    const effects = db.prepare<[], EffectRow>("SELECT * FROM effects").all().map(parseEffect);
    const pieces = new Set(effects.filter((e) => e.builtin && pieceKeys.has(e.builtin)).map((e) => e.id));
    db.prepare(`UPDATE effects SET builtin = '' WHERE builtin IN (${[...pieceKeys].map(() => "?").join(", ")})`).run(...pieceKeys); // their keys now name the merged built-ins
    const lists = new Map(conds.map((c) => [c.id, (JSON.parse(c.effects) as number[]).filter((id) => effects.some((e) => e.id === id))]));
    const usedBy = (effectId: number) => conds.filter((c) => lists.get(c.id)!.includes(effectId)).length;
    const lifecycle = (c: CondRow) => Object.fromEntries(LIFECYCLE_COLUMNS.flatMap(([k]) => (k === "duration" ? [] : [[k, c[k] ?? DEFAULT_LIFECYCLE[k]]]))) as unknown as Lifecycle;
    const map = new Map<number, number>(), merged = new Set<number>();
    for (const c of conds) {
      const list = lists.get(c.id)!, only = list.length === 1 ? effects.find((e) => e.id === list[0]) : undefined;
      if (only && !pieces.has(only.id) && usedBy(only.id) === 1 && !merged.has(only.id)) {
        saveEffectDef(only.id, { name: only.name, description: only.description || c.description, modifiers: only.modifiers, ...lifecycle(c), duration: "rounds", builtin: c.builtin });
        merged.add(only.id);
        map.set(c.id, only.id);
      } else {
        const modifiers = list.flatMap((id) => effects.find((e) => e.id === id)!.modifiers);
        map.set(c.id, saveEffectDef(null, { name: c.name, description: c.description, modifiers, ...lifecycle(c), duration: "rounds", builtin: c.builtin }));
      }
    }
    const to = (id: number) => map.get(id);
    // Actions grant the effects.
    for (const a of db.prepare<[], { id: number; conditions: string }>("SELECT id, conditions FROM actions WHERE conditions != '[]'").all()) {
      const list = (JSON.parse(a.conditions) as { id: number; on: string }[]).flatMap((x) => (to(x.id) ? [{ ...x, id: to(x.id)! }] : []));
      db.prepare("UPDATE actions SET conditions = ? WHERE id = ?").run(JSON.stringify(list), a.id);
    }
    // Rules that give an effect (a trigger's, an aura's) name the effect.
    for (const e of db.prepare<[], { id: number; modifiers: string }>("SELECT id, modifiers FROM effects").all()) {
      const mods = JSON.parse(e.modifiers) as Modifier[];
      if (!mods.some((m) => (m.kind === "trigger" && m.condition) || m.kind === "aura")) continue;
      const next = mods.map((m) => (m.kind === "trigger" && m.condition ? { ...m, condition: to(m.condition) ?? 0 } : m.kind === "aura" ? { ...m, condition: to(m.condition) ?? m.condition } : m));
      db.prepare("UPDATE effects SET modifiers = ? WHERE id = ?").run(JSON.stringify(next), e.id);
    }
    // Effects on tokens now (their kept copies stay as they were; only what they're known by changes), and aura passes.
    for (const t of db.prepare<[], { id: number; effect_id: number; effect: string }>("SELECT id, effect_id, effect FROM token_afflictions").all()) {
      const id = to(t.effect_id);
      if (id) db.prepare("UPDATE token_afflictions SET effect_id = ?, effect = ? WHERE id = ?").run(id, JSON.stringify({ ...JSON.parse(t.effect), id }), t.id);
    }
    for (const p of db.prepare<[], { level_id: number; token_id: number; condition_id: number }>("SELECT * FROM aura_passes").all()) {
      db.prepare("DELETE FROM aura_passes WHERE level_id = ? AND token_id = ? AND condition_id = ?").run(p.level_id, p.token_id, p.condition_id);
      const id = to(p.condition_id);
      if (id) db.prepare("INSERT OR IGNORE INTO aura_passes (level_id, token_id, condition_id) VALUES (?, ?, ?)").run(p.level_id, p.token_id, id);
    }
    // What's left that only conditions used: effects merged into nothing are given a duration from what has them now.
    const standing = (table: string) => new Set(db.prepare<[], { effects: string }>(`SELECT effects FROM ${table}`).all().flatMap((r) => JSON.parse(r.effects) as number[]));
    const onItems = standing("items"), onCreatures = standing("creatures");
    const givenByRules = new Set(db.prepare<[], { modifiers: string }>("SELECT modifiers FROM effects").all().flatMap((r) => (JSON.parse(r.modifiers) as Modifier[]).flatMap((m) => (m.kind === "trigger" || m.kind === "aura" ? [m.condition] : []))));
    for (const e of effects) {
      if (merged.has(e.id)) continue;
      const covered = BUILTIN_CONDITIONS.some((c) => c.effects.includes(e.builtin ?? "")); // a built-in effect has its rules now (See invisible isn't in any)
      if (pieces.has(e.id) && covered && !onItems.has(e.id) && !onCreatures.has(e.id) && !givenByRules.has(e.id)) { db.prepare("DELETE FROM effects WHERE id = ?").run(e.id); continue; }
      const duration: Duration = onItems.has(e.id) ? "equipped" : onCreatures.has(e.id) ? "always" : "rounds";
      db.prepare("UPDATE effects SET duration = ? WHERE id = ?").run(duration, e.id);
    }
    db.prepare("DELETE FROM conditions").run();
  })();
  return conds.length;
}

/** The built-in effects, each seeded once (by key); one sharing its name with an effect the GM made is left out. Their rules follow the code. */
function seedBuiltinEffects(): void {
  const have = new Set(db.prepare<[], { builtin: string }>("SELECT builtin FROM effects WHERE builtin != ''").all().map((r) => r.builtin));
  const names = new Set(db.prepare<[], { name: string }>("SELECT name FROM effects WHERE builtin = ''").all().map((r) => r.name.toLowerCase()));
  db.transaction(() => {
    for (const e of BUILTIN_EFFECTS) {
      if (have.has(e.key)) db.prepare("UPDATE effects SET modifiers = ? WHERE builtin = ?").run(JSON.stringify(e.modifiers), e.key); // names, rounds and saves stay the GM's
      else if (!names.has(e.name.toLowerCase())) saveEffectDef(null, { name: e.name, description: e.description, modifiers: e.modifiers, builtin: e.key });
    }
  })();
}

/** Adds each seeded effect not added before (one the GM already has by that name counts as added). */
export function seedCatalogEffects(): void {
  const done = new Set(db.prepare<[], { name: string }>("SELECT name FROM seeded_effects").all().map((r) => r.name));
  const todo = SEEDED_EFFECTS.filter((e) => !done.has(e.name));
  if (!todo.length) return;
  db.transaction(() => {
    const idOf = (name: string) => db.prepare<[string], { id: number }>("SELECT id FROM effects WHERE name = ? COLLATE NOCASE").get(name)?.id ?? -1;
    // An effect a rule names: by name, else a built-in piece of that name (Sickly, Hampered), added if it isn't there.
    const named = (name: string) => {
      const piece = BUILTIN_PIECES.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (idOf(name) !== -1 || !piece) return idOf(name);
      return db.prepare<[string], { id: number }>("SELECT id FROM effects WHERE builtin = ?").get(piece.key)?.id ?? saveEffectDef(null, { name: piece.name, description: piece.description, modifiers: piece.modifiers, builtin: piece.key });
    };
    for (const e of todo) {
      if (idOf(e.name) === -1) {
        const { modifiers, lifecycle } = compileSeed(e, named, (m) => (idOf(m.name) !== -1 ? idOf(m.name) : saveEffectDef(null, { name: m.name, description: "Made by an effect's rule.", modifiers: m.effect, rounds: m.rounds, reapply: m.reapply, stack_limit: m.stack_limit })));
        saveEffectDef(null, { name: e.name, description: e.description, modifiers, ...lifecycle });
      }
      db.prepare("INSERT INTO seeded_effects (name) VALUES (?)").run(e.name);
    }
  })();
}

/** Conditions to effects, then the built-ins, then the seeded catalog effects: at start-up, and after a campaign import. */
export function settleEffects(): void {
  migrateConditions();
  seedBuiltinEffects();
  seedCatalogEffects();
  settleSpeeds();
}

/** Old speeds (plain numbers, feet per round) become distance over time: feet per second (30 → 5 ft/s). Idempotent. */
export function settleSpeeds(): void {
  for (const table of ["creatures", "characters"] as const) {
    for (const r of db.prepare<[], { id: number; movement: string }>(`SELECT id, movement FROM ${table}`).all()) {
      const raw = JSON.parse(r.movement || "{}") as Record<string, unknown>;
      if (!Object.values(raw).some((v) => typeof v === "number")) continue;
      const next = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "number" ? ftPerSec(Math.round((v / 6) * 100) / 100) : v]));
      db.prepare(`UPDATE ${table} SET movement = ? WHERE id = ?`).run(JSON.stringify(next), r.id);
    }
  }
}

const strainOwner = (tokenId: number) => {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  return t?.character_id ? `c:${t.character_id}` : `t:${tokenId}`;
};

/** A token's strain points, by attribute. */
export function getStrain(tokenId: number): Partial<Record<Attribute, number>> {
  return Object.fromEntries(db.prepare<[string], { attribute: Attribute; points: number }>("SELECT attribute, points FROM strain WHERE owner = ?").all(strainOwner(tokenId)).map((r) => [r.attribute, r.points]));
}

/** Adds strain points to one of a token's attributes (negative: takes them off, not below none); returns the points now. */
export function addStrain(tokenId: number, attribute: Attribute, points: number): number {
  const owner = strainOwner(tokenId), now = Math.max(0, (getStrain(tokenId)[attribute] ?? 0) + points);
  if (now) db.prepare("INSERT INTO strain (owner, attribute, points) VALUES (?, ?, ?) ON CONFLICT (owner, attribute) DO UPDATE SET points = excluded.points").run(owner, attribute, now);
  else db.prepare("DELETE FROM strain WHERE owner = ? AND attribute = ?").run(owner, attribute);
  return now;
}

/** Rest drains everyone's strain: a short rest 1 point per attribute, a long rest all but 1. */
export function restStrain(kind: "short" | "long"): void {
  db.transaction(() => {
    db.prepare(kind === "short" ? "UPDATE strain SET points = points - 1" : "UPDATE strain SET points = MIN(points, 1)").run();
    db.prepare("DELETE FROM strain WHERE points <= 0").run();
  })();
}

/** A level's aura passes, as "token:condition". */
export function listAuraPasses(levelId: number): Set<string> {
  return new Set(db.prepare<[number], { token_id: number; condition_id: number }>("SELECT token_id, condition_id FROM aura_passes WHERE level_id = ?").all(levelId).map((r) => `${r.token_id}:${r.condition_id}`));
}

export function saveAuraPasses(levelId: number, passes: Set<string>): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM aura_passes WHERE level_id = ?").run(levelId);
    const insert = db.prepare("INSERT OR IGNORE INTO aura_passes (level_id, token_id, condition_id) VALUES (?, ?, ?)");
    for (const k of passes) { const [t, c] = k.split(":").map(Number); insert.run(levelId, t, c); }
  })();
}

/** A kept copy as a Condition (one kept by the first version is an old effect). */
const keptCondition = (json: string): Condition => {
  const c = JSON.parse(json);
  return "per_round" in c ? oldToCondition(c) : c;
};

/** The conditions on a level's tokens, by token id. */
export function listAfflictions(levelId: number): Map<number, Affliction[]> {
  const out = new Map<number, Affliction[]>();
  for (const r of db.prepare<[number], { id: number; token_id: number; effect: string; rounds_left: number; by_token: number | null; saved: number; aura: number | null; area: number | null }>("SELECT id, token_id, effect, rounds_left, by_token, saved, aura, area FROM token_afflictions WHERE level_id = ? ORDER BY id").all(levelId)) {
    out.set(r.token_id, [...(out.get(r.token_id) ?? []), { id: r.id, condition: keptCondition(r.effect), left: r.rounds_left, by: r.by_token, saved: r.saved, ...(r.aura != null ? { aura: r.aura } : {}), ...(r.area != null ? { area: r.area } : {}) }]);
  }
  return out;
}

/** Replaces a level's conditions with these (after a round, or time passing). */
export function saveAfflictions(levelId: number, all: Map<number, Affliction[]>): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM token_afflictions WHERE level_id = ?").run(levelId);
    const insert = db.prepare("INSERT INTO token_afflictions (level_id, token_id, effect_id, effect, rounds_left, by_token, saved, aura, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const [tokenId, list] of all) for (const a of list) if (a.left > 0) insert.run(levelId, tokenId, a.condition.id, JSON.stringify(a.condition), a.left, a.by, a.saved ?? 0, a.aura ?? null, a.area ?? null);
  })();
}

/** Takes off what an area put on a token while it was in it (it has left); returns the names taken off. */
export function leaveAreaAfflictions(levelId: number, tokenId: number, area: number): string[] {
  const all = listAfflictions(levelId), list = all.get(tokenId) ?? [];
  const gone = list.filter((a) => a.area === area);
  if (!gone.length) return [];
  all.set(tokenId, list.filter((a) => a.area !== area));
  saveAfflictions(levelId, all);
  return gone.map((a) => a.condition.name);
}

/** Puts a condition on a token (again: by its re-application rule); returns whether anything changed. */
export function addAffliction(levelId: number, tokenId: number, condition: Condition, by: number | null, area?: number): boolean {
  const all = listAfflictions(levelId);
  if (area != null) { // while in this area: once (no rounds); it comes off as they leave
    const list = all.get(tokenId) ?? [];
    if (list.some((a) => a.area === area && a.condition.id === condition.id)) return false;
    all.set(tokenId, [...list, { condition, left: 1, by, area }]);
    saveAfflictions(levelId, all);
    return true;
  }
  const r = reapplied(all.get(tokenId) ?? [], condition, condition.rounds, by);
  if (!r.applied) return false;
  all.set(tokenId, r.list);
  saveAfflictions(levelId, all);
  return true;
}

/** Takes a condition off; returns its level. */
export function removeAffliction(id: number): number | undefined {
  const levelId = db.prepare<[number], { level_id: number }>("SELECT level_id FROM token_afflictions WHERE id = ?").get(id)?.level_id;
  db.prepare<[number]>("DELETE FROM token_afflictions WHERE id = ?").run(id);
  return levelId;
}

/** Levels with conditions on anyone (for time passing out of an encounter). */
export function afflictedLevels(): number[] {
  return db.prepare<[], { level_id: number }>("SELECT DISTINCT level_id FROM token_afflictions").all().map((r) => r.level_id);
}

/** A character's profession modifiers to one target, e.g. "skill:sleight of hand". */
export function characterModifiers(characterId: number, target: string): { profession: string; value: string }[] {
  const q = db.prepare<[number, string], { profession: string; value: string }>(
    "SELECT p.name AS profession, m.value FROM professions p JOIN profession_modifiers m ON m.profession_id = p.id WHERE p.id = ? AND m.target = ?",
  );
  return listCharacterProfessionIds(characterId).flatMap((pid) => q.all(pid, target)); // every rank held (cumulative)
}
