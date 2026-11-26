import type { Modifier } from "@/lib/conditions";

import { CREATURE_TYPES, type CreatureType } from "@/lib/creatureTypes";

import type { Boost, RollGrant } from "@/lib/actions";

import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";

import { DATA_DIR, addColumn, db } from "@/lib/db/connection";
export { DATA_DIR, addColumn, db };

export default db;

export { CREATURE_TYPES, type CreatureType };
export { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity };
export * from "@/lib/db/calendar";

export * from "@/lib/db/users";

export * from "@/lib/db/sessions";

export * from "@/lib/db/catalog";
import { setCharacterRank, rankChain, saveProfessionGroup, listProfessions } from "@/lib/db/catalog";
export * from "@/lib/db/maps";

export * from "@/lib/db/encounters";

export * from "@/lib/db/tokens";

export * from "@/lib/db/media";
export * from "@/lib/db/mapThings";

export * from "@/lib/db/effects";
import { saveEffectDef, settleEffects, LIFECYCLE_COLUMNS, type OldEffectDef, oldModifiers } from "@/lib/db/effects";
export * from "@/lib/db/areas";
export * from "@/lib/db/traps";
export * from "@/lib/db/story";
export * from "@/lib/db/rolls";
export * from "@/lib/db/rounds";

// Professions are progressions of ranks: each rank (a `professions` row) belongs to a profession (`profession_groups`),
// and a character has one rank (`characters.rank_id`), holding every rank before it too.
db.exec("CREATE TABLE IF NOT EXISTS profession_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '')");
addColumn("professions", "group_id", "INTEGER"); // its profession (profession_groups)
addColumn("characters", "rank_id", "INTEGER"); // their rank (professions)
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
db.exec(`CREATE TABLE IF NOT EXISTS token_follows (
  token_id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  mode TEXT NOT NULL
)`);

// Walks out of encounters (free moves, followers), so every map on the level plays them, not just the walker's.
// Kept a few seconds: a map polls each second and only plays what's fresh.
db.exec(`CREATE TABLE IF NOT EXISTS token_walks (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  route TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL
)`);

addColumn("token_walks", "fps", "REAL NOT NULL DEFAULT 5"); // how fast it went (feet per second): played back in real time
addColumn("token_walks", "times", "TEXT");

// A level link a token came onto in a round: its player is asked (before planning again) whether to take it;
// `back` is where they stepped from (where "Stay" puts them).
db.exec(`CREATE TABLE IF NOT EXISTS link_prompts (
  token_id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL,
  back_col REAL NOT NULL,
  back_row REAL NOT NULL
)`);

addColumn("link_prompts", "show_at", "INTEGER NOT NULL DEFAULT 0");

// Fog of war: every spot a character's token has stood on a level (its centre, grid units); what was seen from them stays explored.
db.exec(`CREATE TABLE IF NOT EXISTS sightings (
  character_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  PRIMARY KEY (character_id, level_id, x, y)
)`);

// What the GM is playing on a level (ambient), shared with every player's browser on it. rev changes with each new
// play (or stop), so browsers start it again; volume can change without a new rev.
db.exec(`CREATE TABLE IF NOT EXISTS level_ambient (
  level_id INTEGER PRIMARY KEY,
  sound_id INTEGER,          -- null: nothing playing
  clip_id INTEGER,           -- a single clip played once (else the sound's loop and layer clips)
  volume REAL NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0
)`);

/** Runs fn in a single transaction. */
export const transaction = <T>(fn: () => T): T => db.transaction(fn)();

// ---------- Sessions (game nights) ----------

// Not "sessions": that table holds login tokens.
db.exec(`CREATE TABLE IF NOT EXISTS game_sessions (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,   -- real date and time (ISO)
  game_time REAL NOT NULL     -- game time when it started, in minutes
)`);
addColumn("game_sessions", "ended_at", "TEXT"); // real time it ended; null while it's running
addColumn("game_sessions", "start_state", "TEXT"); // JSON snapshot of game state when it started (lib/sessionLog.ts)
addColumn("game_sessions", "summary", "TEXT"); // JSON summary written when it ended
addColumn("game_sessions", "began_at", "TEXT"); // when the GM began play; until then the session is in its lobby
db.exec("UPDATE game_sessions SET began_at = started_at WHERE began_at IS NULL AND ended_at IS NOT NULL"); // sessions from before lobbies
// Who's in a session's lobby (or game): a player is present while their page keeps checking in.
db.exec(`CREATE TABLE IF NOT EXISTS session_presence (
  session_id INTEGER NOT NULL REFERENCES game_sessions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  last_seen INTEGER NOT NULL, -- epoch ms
  PRIMARY KEY (session_id, user_id)
)`);
// Things that happened during a session that its start and end states can't show (e.g. triggers going off).
db.exec(`CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES game_sessions(id),
  game_time REAL NOT NULL,
  text TEXT NOT NULL
)`);

// Who the GM put in or took out of a session (its lobby): "gm" = an absent player the GM plays; "removed" = kept out.
// Anyone else is in the session by being present.
db.exec(`CREATE TABLE IF NOT EXISTS session_members (
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'gm' | 'removed'
  PRIMARY KEY (session_id, user_id)
)`);

// ---------- Lasting areas ----------

// An area an action left on the map for a while (a fire wall); it's gone once game time passes `ends`.
db.exec(`CREATE TABLE IF NOT EXISTS lasting_areas (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  ends REAL NOT NULL,
  spec TEXT NOT NULL
)`);

// Exposure to lingering areas' harm, per level: who is still burning, poisoned… (lib/exposure.ts), as JSON.
db.exec("CREATE TABLE IF NOT EXISTS level_exposure (level_id INTEGER PRIMARY KEY, data TEXT NOT NULL)");

// ---------- Statuses ----------

// What an action left on a token for a while (disadvantage on its attacks, +2 defense); gone once game time passes `ends`.
db.exec(`CREATE TABLE IF NOT EXISTS token_statuses (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  ends REAL NOT NULL,
  status TEXT NOT NULL
)`);

// The catalog: effects. An effect is a name, its rules (modifiers) and how long it lasts: so many rounds (with its
// saves and what ends it), while equipped, or always. Actions, the GM, items, creatures and professions grant them.
// See lib/conditions.ts.
db.exec(`CREATE TABLE IF NOT EXISTS effects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  modifiers TEXT NOT NULL DEFAULT '[]'
)`);
addColumn("effects", "builtin", "TEXT NOT NULL DEFAULT ''");
for (const [column, definition] of LIFECYCLE_COLUMNS) addColumn("effects", column, definition);

// Retired 2026-11-13: conditions (an effect's lifecycle lived here, applying effects by id). Kept, empty, so an older
// campaign export can still be imported: its rows become effects (migrateConditions, below).
db.exec(`CREATE TABLE IF NOT EXISTS conditions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  effects TEXT NOT NULL DEFAULT '[]',
  rounds INTEGER NOT NULL DEFAULT 1,
  save_attr TEXT NOT NULL DEFAULT '',
  save_dc INTEGER NOT NULL DEFAULT 12
)`);
for (const [column, definition] of LIFECYCLE_COLUMNS) if (column !== "duration") addColumn("conditions", column, definition);
addColumn("conditions", "builtin", "TEXT NOT NULL DEFAULT ''");

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
// same name, on whoever it was for; health boosts become an instant heal. Its lists are then emptied, so this runs
// only for actions saved before conditions existed. (Then migrateConditions turns those into effects.)
{
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
}

// Catalog effects added once each (lib/seedEffects.ts), by name: after that they're the GM's to edit, rename or delete.
db.exec("CREATE TABLE IF NOT EXISTS seeded_effects (name TEXT PRIMARY KEY)");

// Strain: points on a creature's attributes (each −1 to it, never below half), left by conditions; they outlast them
// and drain with rest. A character's follow them from map to map ("c:<character id>"); a creature's stay with its
// token ("t:<token id>").
db.exec(`CREATE TABLE IF NOT EXISTS strain (
  owner TEXT NOT NULL,
  attribute TEXT NOT NULL,
  points INTEGER NOT NULL,
  PRIMARY KEY (owner, attribute)
)`);

// Conditions on creatures right now: a copy of the condition (and its effects) as it was put on, the rounds it has
// left, and who put it there.
db.exec(`CREATE TABLE IF NOT EXISTS token_afflictions (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  effect_id INTEGER NOT NULL, -- the condition's id
  effect TEXT NOT NULL, -- JSON Condition
  rounds_left INTEGER NOT NULL,
  by_token INTEGER
)`);

addColumn("token_afflictions", "saved", "INTEGER NOT NULL DEFAULT 0"); // successful saves so far
addColumn("token_afflictions", "aura", "INTEGER"); // given by this token's aura (while within it)
addColumn("token_afflictions", "area", "INTEGER"); // given by this lasting area (while in it)

// Creatures that passed the save against an aura's condition as they came within it: safe until they leave.
db.exec(`CREATE TABLE IF NOT EXISTS aura_passes (
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  condition_id INTEGER NOT NULL,
  PRIMARY KEY (level_id, token_id, condition_id)
)`);

// ---------- Effects played by scripts ----------

// A one-off visual effect a script played (fx('arrow', A, B)): every map in the session draws it from `starts` (ms).
db.exec(`CREATE TABLE IF NOT EXISTS map_fx (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  starts INTEGER NOT NULL,
  fx TEXT NOT NULL
)`);

// ---------- Pings ----------

// Someone pressed and held on the map to point at a spot; everyone in the session sees it for a few seconds.
db.exec(`CREATE TABLE IF NOT EXISTS pings (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  gm INTEGER NOT NULL,
  created INTEGER NOT NULL
)`);

// ---------- Roll requests ----------

// A roll a player has to make (e.g. picking a lock): shown to them as a prompt until they roll it and close it.
// `action` says what the result is for, so the server settles it once rolled.
db.exec(`CREATE TABLE IF NOT EXISTS roll_requests (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES users(id),
  character_id INTEGER NOT NULL,
  spec TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT,
  done INTEGER NOT NULL DEFAULT 0
)`);

/** Asks a player to roll; replaces any roll they haven't made yet (and puts away one they rolled but left open). */
// Hide: a token hidden from everyone not on its side, with its Stealth total (what a Search has to beat). Kept until revealed.
db.exec(`CREATE TABLE IF NOT EXISTS token_hidden (
  token_id INTEGER PRIMARY KEY,
  stealth INTEGER NOT NULL
)`);

// Assist: whoever was helped has advantage on their next roll (one help at a time; a new one replaces it). Kept until used.
db.exec(`CREATE TABLE IF NOT EXISTS assists (
  token_id INTEGER PRIMARY KEY,
  by_token INTEGER NOT NULL,
  by_name TEXT NOT NULL
)`);

// ---------- Secrets ----------

// Hidden things on a map (a trapdoor, a note under the rug), optionally a story discovery. The GM sees them all;
// players see one once it's revealed (by a successful Search nearby, or by the GM).
db.exec(`CREATE TABLE IF NOT EXISTS map_secrets (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  x REAL NOT NULL,
  y REAL NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  discovery_id INTEGER,
  revealed INTEGER NOT NULL DEFAULT 0
)`);

// ---------- Round plans ----------

// What each creature in an encounter plans to do this round (steps in order) and whether its planner is ready.
db.exec(`CREATE TABLE IF NOT EXISTS round_plans (
  level_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT '[]',
  ready INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (level_id, token_id)
)`);

addColumn("round_plans", "rolled", "INTEGER NOT NULL DEFAULT 0");

// ---------- The GM's map ----------

// The level the GM has loaded in the session (null = follow the party). Players are unaffected.
db.exec("CREATE TABLE IF NOT EXISTS gm_view (id INTEGER PRIMARY KEY CHECK (id = 1), level_id INTEGER)");

// ---------- Containers ----------

// What's in a character's containers (a belt, a pack…): each container they own has its own inventory, kept with
// the container (unequip it and equip it again, and its contents are still there). A stack fills one of the
// container's slots (its capacity), up to the item's max stack.
db.exec(`CREATE TABLE IF NOT EXISTS container_items (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL,
  container_id INTEGER NOT NULL, -- the container item
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1
)`);

// ---------- Traps (lib/traps.ts) ----------

// Hazards the GM places on a level, hidden from players until found; `sprung`: the tokens each has sprung on.
db.exec(`CREATE TABLE IF NOT EXISTS map_traps (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  name TEXT NOT NULL DEFAULT 'Trap',
  area TEXT NOT NULL, -- JSON TrapArea
  springs TEXT NOT NULL DEFAULT 'enter', -- enter,start,end
  who TEXT NOT NULL DEFAULT '', -- '' | party | hostile
  often TEXT NOT NULL DEFAULT 'once', -- once | each | always
  damage TEXT,
  damage_type TEXT NOT NULL DEFAULT '',
  save_attr TEXT NOT NULL DEFAULT 'agility',
  save_dc INTEGER NOT NULL DEFAULT 12,
  save_half INTEGER NOT NULL DEFAULT 1,
  effects TEXT NOT NULL DEFAULT '[]', -- JSON catalog effect ids
  stops INTEGER NOT NULL DEFAULT 1,
  find_dc INTEGER NOT NULL DEFAULT 14,
  found INTEGER NOT NULL DEFAULT 0,
  sprung TEXT NOT NULL DEFAULT '[]' -- JSON token ids
)`);

addColumn("map_traps", "seen_by", "TEXT NOT NULL DEFAULT '[]'");

// ---------- Map triggers (lib/triggers.ts) ----------

// Zones that make things happen when someone comes into one (and the like); always hidden from players.
db.exec(`CREATE TABLE IF NOT EXISTS map_triggers (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  name TEXT NOT NULL DEFAULT 'Trigger',
  area TEXT NOT NULL, -- JSON TrapArea
  springs TEXT NOT NULL DEFAULT 'enter', -- enter,start,end
  who TEXT NOT NULL DEFAULT '', -- '' | party | hostile
  often TEXT NOT NULL DEFAULT 'once', -- once | each | always
  outcomes TEXT NOT NULL DEFAULT '[]', -- JSON TriggerOutcome[]
  sprung TEXT NOT NULL DEFAULT '[]' -- JSON token ids
)`);

addColumn("map_triggers", "interact", "INTEGER NOT NULL DEFAULT 0");

// Last, once every table exists: the retired conditions become effects, and the built-in effects are seeded.
settleEffects();
