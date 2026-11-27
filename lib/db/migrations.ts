// One-time data migrations: older campaigns' data brought up to date. Run at start-up (runMigrations), after the
// tables exist (lib/db/connection.ts). Each either checks for itself whether there's anything to do, or runs once only
// (`once`, recorded in migrations_done).
import { db } from "@/lib/db/connection";
import { listProfessions, rankChain, saveProfessionGroup, setCharacterRank } from "@/lib/db/catalog";
import { oldModifiers, saveEffectDef, settleEffects, type OldEffectDef } from "@/lib/db/effects";
import type { Modifier } from "@/lib/conditions";
import { getCondition, usesOf, withCopies, type EffectUse } from "@/lib/db/effects";
import { hazardFromTrap } from "@/lib/hazards";
import type { Trap } from "@/lib/traps";
import type { Boost, RollGrant } from "@/lib/actions";

/** Runs a migration the first time only. */
function once(name: string, run: () => void): void {
  if (db.prepare("SELECT 1 FROM migrations_done WHERE name = ?").get(name)) return;
  run();
  db.prepare("INSERT OR IGNORE INTO migrations_done (name) VALUES (?)").run(name);
}

let ran = false;
/** Brings an older campaign's data up to date (once per process). */
export function runMigrations(): void {
  if (ran) return;
  ran = true;
  // their rank (professions)
  // One-time migration: each first rank (no rank advances to it) becomes a profession, with every rank it leads to;
  // a character's ticked professions become their furthest rank.
  if (db.prepare("SELECT 1 FROM professions WHERE group_id IS NULL").get()) {
    db.transaction(() => {
      db.prepare("UPDATE professions SET name = 'Infantryman' WHERE name = 'Infrantryman'").run();
      const NAMES: Record<string, string> = { Infantryman: "Military", "Beat Cop": "Law Enforcement", "Fortune Teller": "Mysticism", Nurse: "Medicine", "Lab Technician": "Science", Tinkerer: "Engineering", "School Teacher": "Education", "Street Rat": "Underworld" };
      const links = db.prepare<[], { from_id: number; to_id: number }>("SELECT from_id, to_id FROM profession_advancements").all();
      const firsts = listProfessions().filter((p) => p.group_id === null && !links.some((l) => l.to_id === p.id));
      for (const first of firsts) {
        const group = saveProfessionGroup(null, { name: NAMES[first.name] ?? first.name, description: "" });
        const todo = [first.id], seen = new Set<number>();
        while (todo.length) {
          const id = todo.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          db.prepare("UPDATE professions SET group_id = ? WHERE id = ? AND group_id IS NULL").run(group, id);
          todo.push(...links.filter((l) => l.from_id === id).map((l) => l.to_id));
        }
      }
      // Anything left (a loop with no first rank): a profession of its own.
      for (const p of listProfessions().filter((x) => x.group_id === null)) db.prepare("UPDATE professions SET group_id = ? WHERE id = ?").run(saveProfessionGroup(null, { name: p.name, description: "" }), p.id);
      const held = db.prepare<[], { character_id: number; profession_id: number }>("SELECT character_id, profession_id FROM character_professions").all();
      for (const c of new Set(held.map((h) => h.character_id))) {
        const furthest = held.filter((h) => h.character_id === c).map((h) => h.profession_id).sort((a, b) => rankChain(b).length - rankChain(a).length)[0];
        setCharacterRank(c, furthest);
      }
    })();
  }

  // Once: the first version's effects (effect_defs) become conditions, each applying an effect of the same name (same
  // ids, so actions and effects already on creatures still point at them); actions' "effects" become "conditions".
  // (Then migrateConditions turns those into effects.)
  {
    const hasOld = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'effect_defs'").get()!.n > 0;
    if (hasOld) {
      db.transaction(() => {
        const old = db.prepare<[], Omit<OldEffectDef, "boosts" | "roll_grants"> & { boosts: string; roll_grants: string }>("SELECT * FROM effect_defs").all()
          .map((r) => ({ ...r, boosts: JSON.parse(r.boosts), roll_grants: JSON.parse(r.roll_grants) }) as OldEffectDef);
        for (const o of old) {
          db.prepare("INSERT INTO effects (id, name, description, modifiers) VALUES (?, ?, '', ?)").run(o.id, o.name, JSON.stringify(oldModifiers(o)));
          db.prepare("INSERT INTO conditions (id, name, description, effects, rounds, save_attr, save_dc) VALUES (?, ?, ?, ?, ?, ?, ?)").run(o.id, o.name, o.description, JSON.stringify([o.id]), o.rounds, o.save_attr, o.save_dc);
        }
        db.prepare("UPDATE actions SET conditions = effects WHERE effects != '[]' AND conditions = '[]'").run();
        db.exec("ALTER TABLE effect_defs RENAME TO effect_defs_migrated"); // kept, but never migrated again
      })();
    }
  }

  // Once per action: its own boosts and roll effects become a condition (named after it) applying an effect of the
  // same name, on whoever it was for; health boosts become an instant heal. Its lists are then emptied, so this ran
  // only for actions saved before conditions existed. (Then migrateConditions turns those into effects.)
  // Once only: the action interview saves boosts again (Defend, Aid, Heal); left running, it would turn them into effects.
  once("action-boosts-to-conditions", () => {
    type Row = { id: number; name: string; boosts: string; roll_grants: string; duration_amount: number; duration_unit: string; conditions: string };
    const per: Record<string, number> = { round: 1, turn: 1, minute: 10, hour: 600, day: 14400, "short rest": 600, "long rest": 4800 };
    const rows = db.prepare<[], Row>("SELECT id, name, boosts, roll_grants, duration_amount, duration_unit, conditions FROM actions WHERE boosts != '[]' OR roll_grants != '[]'").all();
    if (rows.length) db.transaction(() => {
      for (const r of rows) {
        const boosts: Boost[] = JSON.parse(r.boosts), grants: RollGrant[] = JSON.parse(r.roll_grants), granted: { id: number; on: "self" | "target" }[] = JSON.parse(r.conditions);
        const sides = (["target", "self"] as const).filter((on) => boosts.some((b) => (b.on ?? "self") === on) || grants.some((g) => (g.on ?? "self") === on));
        for (const on of sides) {
          const modifiers: Modifier[] = [
            ...boosts.filter((b) => (b.on ?? "self") === on).map((b): Modifier => (b.target === "health" ? { kind: "instant", value: b.value.replace(/^\+/, ""), heal: true, damage_type: "" } : { kind: "boost", target: b.target, value: b.value })),
            ...grants.filter((g) => (g.on ?? "self") === on).map((g): Modifier => ({ kind: "roll", roll: g.roll, mode: g.mode })),
          ];
          const name = sides.length > 1 && on === "self" ? `${r.name} (self)` : r.name;
          const rounds = Math.max(1, (per[r.duration_unit] ?? 1) * Math.max(1, r.duration_amount));
          const effect = saveEffectDef(null, { name, description: `From ${r.name}.`, modifiers });
          granted.push({ id: Number(db.prepare("INSERT INTO conditions (name, description, effects, rounds, save_attr, save_dc) VALUES (?, ?, ?, ?, '', 12)").run(name, `From ${r.name}.`, JSON.stringify([effect]), rounds).lastInsertRowid), on });
        }
        db.prepare("UPDATE actions SET boosts = '[]', roll_grants = '[]', conditions = ? WHERE id = ?").run(JSON.stringify(granted), r.id);
      }
    })();
  });

  // Last, once every table exists: the retired conditions become effects, and the built-in effects are seeded.
  settleEffects();
  trapsToHazards(); // traps become dormant hazards (backlog X): nothing to do once map_traps is empty
  // Effects copied into each use (backlog W): every action, item and creature gets its own copy of the catalog effects
  // it has, as they are now, so later catalog edits don't reach it. Once; after an import, uses without one get one too.
  once("effect-copies", effectCopies);
}

/** Every action's, item's and creature's effects without a copy get one (the catalog effect as it is now). */
export function effectCopies(): void {
  db.transaction(() => {
    for (const a of db.prepare<[], { id: number; conditions: string }>("SELECT id, conditions FROM actions WHERE conditions != '[]'").all()) {
      db.prepare("UPDATE actions SET conditions = ? WHERE id = ?").run(JSON.stringify(withCopies(JSON.parse(a.conditions) as EffectUse[])), a.id);
    }
    for (const table of ["items", "creatures"]) for (const r of db.prepare<[], { id: number; effects: string }>(`SELECT id, effects FROM ${table} WHERE effects != '[]'`).all()) {
      db.prepare(`UPDATE ${table} SET effects = ? WHERE id = ?`).run(JSON.stringify(withCopies(usesOf(r.effects))), r.id);
    }
  })();
}

/**
 * Traps become hazards (backlog X, claude/hazards-design.md): each trap a dormant hazard on its level (a spent "once"
 * trap is dropped), trigger outcomes that set one off now set off its hazard, and `map_traps` is left empty. Runs at
 * start-up and after an import (an older export's traps); nothing to do once the table is empty.
 */
export function trapsToHazards(): void {
  db.transaction(() => {
    const rows = db.prepare<[], Record<string, unknown>>("SELECT * FROM map_traps").all();
    const moved = new Map<number, number>();
    for (const r of rows) {
      const t = { ...r, area: JSON.parse(String(r.area)), springs: String(r.springs).split(",").filter(Boolean), effects: JSON.parse(String(r.effects)), sprung: JSON.parse(String(r.sprung)), seen_by: JSON.parse(String(r.seen_by ?? "[]")) } as unknown as Trap & { level_id: number };
      const h = hazardFromTrap(t, getCondition);
      if (!h) continue;
      const { name, ends, ...spec } = h;
      moved.set(t.id, Number(db.prepare("INSERT INTO hazards (level_id, name, ends, spec) VALUES (?, ?, ?, ?)").run(t.level_id, name, ends, JSON.stringify(spec)).lastInsertRowid));
    }
    for (const tr of db.prepare<[], { id: number; outcomes: string }>("SELECT id, outcomes FROM map_triggers").all()) {
      const outcomes = (JSON.parse(tr.outcomes) as { kind: string; trap?: number }[]).flatMap((o) => (o.kind !== "trap" ? [o] : moved.has(o.trap!) ? [{ kind: "area", area: moved.get(o.trap!), to: "set off" }] : []));
      db.prepare("UPDATE map_triggers SET outcomes = ? WHERE id = ?").run(JSON.stringify(outcomes), tr.id);
    }
    db.prepare("DELETE FROM map_traps").run();
  })();
}
