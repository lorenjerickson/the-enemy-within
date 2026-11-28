// The database: where it lives, opening it, and its tables (created, and brought up to date, as this module loads).
// Every lib/db/* module and lib/db.ts use \`db\` from here (backlog U: lib/db.ts is being split by area).
import Database from "better-sqlite3";
import fs from "node:fs";
import { timed } from "@/lib/timing";
import type { Lifecycle } from "@/lib/conditions";

// Where the database and uploaded media live: ./data locally, a mounted volume when deployed (DATA_DIR=/data).
export const DATA_DIR = process.env.DATA_DIR ?? "data";
fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new Database(`${DATA_DIR}/game.db`);
// Timing (TIMING=1; productization Phase 0, lib/timing.ts): each statement's run / get / all / iterate, by its SQL.
{
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const st = prepare(sql) as unknown as Record<string, (...a: unknown[]) => unknown>, name = sql.replace(/\s+/g, " ").trim().slice(0, 80);
    for (const m of ["run", "get", "all", "iterate"]) {
      const f = st[m].bind(st);
      st[m] = (...a: unknown[]) => timed("db", name, () => f(...a));
    }
    return st;
  }) as unknown as typeof db.prepare;
}
// Several processes may open it at once (the production build collects pages with parallel workers): wait for each
// other rather than failing with "database is locked".
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    contact TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS creatures (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS professions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS profession_modifiers (
    id INTEGER PRIMARY KEY,
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    target TEXT NOT NULL, -- ModifierTarget, e.g. "attribute:might", "skill:stealth", "health"
    value TEXT NOT NULL   -- signed number or dice expression, e.g. "+1", "-2", "1d4"
  );
  CREATE TABLE IF NOT EXISTS profession_items (
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    PRIMARY KEY (profession_id, item_id)
  );
  -- A character is a single-instance creature: a copy of a creature template that can then be changed freely.
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    creature_id INTEGER REFERENCES creatures(id), -- template it was based on
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT,
    type TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    equipment TEXT NOT NULL DEFAULT '{}',
    health TEXT NOT NULL,
    movement TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS character_professions (
    character_id INTEGER NOT NULL REFERENCES characters(id),
    profession_id INTEGER NOT NULL REFERENCES professions(id),
    PRIMARY KEY (character_id, profession_id)
  );
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES locations(id), -- null = top level
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
  );
  -- A location's map has one or more levels (floors), each with its own layer stack.
  CREATE TABLE IF NOT EXISTS map_levels (
    id INTEGER PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES locations(id),
    name TEXT NOT NULL,
    background TEXT -- JSON MapBackground
  );
  -- Layers the GM has hidden on a level (all layers are visible by default).
  CREATE TABLE IF NOT EXISTS level_hidden_layers (
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    layer TEXT NOT NULL, -- MapLayer
    PRIMARY KEY (level_id, layer)
  );
  -- Tiles placed on a level: an asset covering a rectangle of grid cells.
  CREATE TABLE IF NOT EXISTS map_tiles (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    col INTEGER NOT NULL,
    row INTEGER NOT NULL,
    cols INTEGER NOT NULL DEFAULT 1,
    rows INTEGER NOT NULL DEFAULT 1
  );
  -- Structure on a level. Lines (wall/door/window) run between grid corners (x1,y1)-(x2,y2);
  -- a staircase occupies cell (x1,y1) and leads to target_level_id.
  CREATE TABLE IF NOT EXISTS map_structures (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    kind TEXT NOT NULL, -- StructureKind
    x1 INTEGER NOT NULL,
    y1 INTEGER NOT NULL,
    x2 INTEGER NOT NULL,
    y2 INTEGER NOT NULL,
    target_level_id INTEGER REFERENCES map_levels(id)
  );
  -- Tokens on a level: a creature (initial placement by the GM) or a character, in a grid cell.
  CREATE TABLE IF NOT EXISTS map_tokens (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    creature_id INTEGER REFERENCES creatures(id),
    character_id INTEGER REFERENCES characters(id),
    col INTEGER NOT NULL,
    row INTEGER NOT NULL
  );
  -- Ambient sounds on a level: a named playlist of audio clips. Only one plays at a time.
  CREATE TABLE IF NOT EXISTS ambient_sounds (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ambient_clips (
    id INTEGER PRIMARY KEY,
    sound_id INTEGER NOT NULL REFERENCES ambient_sounds(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    mode TEXT NOT NULL DEFAULT 'loop' -- ClipMode
  );
  -- Positional sounds on a level: an audio asset at a grid position (cell units) heard within a radius (cells).
  CREATE TABLE IF NOT EXISTS positional_sounds (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    radius REAL NOT NULL DEFAULT 3
  );
  -- Light sources on a level, at a grid position (cell units). Directional lights shine a cone
  -- of spread degrees towards angle degrees (0 = east, 90 = south).
  CREATE TABLE IF NOT EXISTS light_sources (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    kind TEXT NOT NULL, -- LightKind
    x REAL NOT NULL,
    y REAL NOT NULL,
    radius REAL NOT NULL DEFAULT 4,
    angle REAL NOT NULL DEFAULT 0,
    spread REAL NOT NULL DEFAULT 60,
    flicker INTEGER NOT NULL DEFAULT 0
  );
  -- GM-only sticky notes on a level; (x, y) is the note's top-left in grid units.
  CREATE TABLE IF NOT EXISTS map_notes (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    x REAL NOT NULL,
    y REAL NOT NULL,
    text TEXT NOT NULL
  );
  -- GM control buttons along an edge of a level's scene, in the order added.
  CREATE TABLE IF NOT EXISTS map_controls (
    id INTEGER PRIMARY KEY,
    level_id INTEGER NOT NULL REFERENCES map_levels(id),
    edge TEXT NOT NULL, -- ControlEdge
    label TEXT NOT NULL
  );
  -- Reusable media for maps, e.g. tile images.
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,  -- AssetType, e.g. 'image'
    usage TEXT NOT NULL, -- AssetUsage, e.g. 'tile'
    url TEXT NOT NULL
  );
  -- An action belongs to exactly one owner: a profession or an item.
  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY,
    profession_id INTEGER REFERENCES professions(id),
    item_id INTEGER REFERENCES items(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    roll TEXT NOT NULL DEFAULT 'normal', -- RollMode for the to-hit roll
    attack TEXT,                         -- to-hit modifier, signed number or dice
    damage TEXT,                         -- damage dice
    damage_type TEXT NOT NULL DEFAULT '', -- DamageType, '' when no damage
    radius REAL NOT NULL DEFAULT 0,      -- metres around the actor; 0 = single target
    split INTEGER NOT NULL DEFAULT 0     -- 1 = damage divided evenly across everyone in the radius
  );
  -- from_id advances to to_id; to_id's prerequisites are all its from_ids.
  CREATE TABLE IF NOT EXISTS profession_advancements (
    from_id INTEGER NOT NULL REFERENCES professions(id),
    to_id INTEGER NOT NULL REFERENCES professions(id),
    PRIMARY KEY (from_id, to_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id)
  );
`);

/** Gives new (or old, unnamed) lights, effects and doors a default name such as "Light 3" or "Fire 7". */
export function nameUnnamed(): void {
  const has = (table: string, column: string) =>
    db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (has("light_sources", "name")) db.exec("UPDATE light_sources SET name = 'Light ' || id WHERE name IS NULL OR name = ''");
  if (has("map_effects", "name"))
    db.exec("UPDATE map_effects SET name = upper(substr(kind, 1, 1)) || substr(kind, 2) || ' ' || id WHERE name IS NULL OR name = ''");
  if (has("map_structures", "name")) db.exec("UPDATE map_structures SET name = 'Door ' || id WHERE kind = 'door' AND (name IS NULL OR name = '')");
}

// Add columns introduced after a database was first created.
export function addColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (e) {
    // Another process (a parallel build worker) added it between the check and now: fine.
    if (!(e instanceof Error && /duplicate column name/i.test(e.message))) throw e;
  }
}
addColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "type", "TEXT NOT NULL DEFAULT 'utility'");
addColumn("items", "weight", "REAL NOT NULL DEFAULT 0");
addColumn("items", "value", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "rarity", "TEXT NOT NULL DEFAULT ''");
addColumn("items", "durability", "INTEGER NOT NULL DEFAULT 0");
addColumn("items", "defense", "TEXT");
addColumn("items", "damage", "TEXT");
addColumn("items", "attack", "TEXT");
addColumn("items", "max_stack", "INTEGER");
addColumn("items", "capacity", "INTEGER");
addColumn("creatures", "type", "TEXT NOT NULL DEFAULT 'beast'");
addColumn("creatures", "attributes", "TEXT NOT NULL DEFAULT '{}'"); // JSON Attributes
addColumn("creatures", "equipment", "TEXT NOT NULL DEFAULT '{}'"); // JSON Equipment
addColumn("creatures", "health", "TEXT NOT NULL DEFAULT '1d8'"); // dice formula for initial health
addColumn("creatures", "movement", "TEXT NOT NULL DEFAULT '{}'"); // JSON Movement
addColumn("actions", "creature_id", "INTEGER REFERENCES creatures(id)");
addColumn("actions", "boosts", "TEXT NOT NULL DEFAULT '[]'"); // JSON Boost[]
addColumn("actions", "duration_amount", "INTEGER NOT NULL DEFAULT 1");
addColumn("actions", "duration_unit", "TEXT NOT NULL DEFAULT ''"); // DurationUnit, '' = instant
addColumn("map_levels", "position", "REAL NOT NULL DEFAULT 0"); // higher = further up
db.exec("UPDATE map_levels SET position = id WHERE position = 0");
addColumn("map_levels", "map_image", "TEXT"); // JSON MapImage
addColumn("map_levels", "grid", "TEXT"); // JSON MapGrid
addColumn("map_levels", "template_colors", "TEXT"); // JSON TemplateColors
addColumn("map_structures", "open", "INTEGER NOT NULL DEFAULT 0"); // doors only: 1 = open
addColumn("map_notes", "w", "REAL NOT NULL DEFAULT 1.6"); // size in grid cells
addColumn("map_notes", "h", "REAL NOT NULL DEFAULT 1.6"); // minimum height; grows to fit text
addColumn("map_controls", "icon", "TEXT NOT NULL DEFAULT 'GiClick'"); // react-icons Game Icons name
addColumn("map_controls", "script", "TEXT NOT NULL DEFAULT ''"); // game script run when the button is clicked
addColumn("creatures", "token_overhead", "TEXT"); // token art seen from above (overhead maps)
addColumn("creatures", "token_side", "TEXT"); // token art seen side-on (portrait maps)
addColumn("characters", "token_overhead", "TEXT");
addColumn("characters", "token_side", "TEXT");
addColumn("map_tokens", "hp", "INTEGER");
addColumn("characters", "in_party", "INTEGER NOT NULL DEFAULT 0"); // 1 = a player character (game.characters.party)
addColumn("characters", "player_id", "INTEGER REFERENCES users(id)"); // the player who plays it (sees its journal)
// Game time, in minutes since the campaign began, moved forward by the GM; and named timers measured against it.
db.exec(`CREATE TABLE IF NOT EXISTS calendar (id INTEGER PRIMARY KEY CHECK (id = 1), now REAL NOT NULL DEFAULT 0)`);
db.exec("INSERT OR IGNORE INTO calendar (id, now) VALUES (1, 0)");
db.exec(`CREATE TABLE IF NOT EXISTS timers (name TEXT PRIMARY KEY, started REAL NOT NULL)`);
addColumn("timers", "duration", "REAL"); // minutes until it expires; null = never
// ON … THEN triggers made by scripts: checked whenever game state changes, run once when the condition holds.
db.exec(`CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY,
  prelude TEXT NOT NULL DEFAULT '[]',
  condition TEXT NOT NULL,
  action TEXT NOT NULL,
  level_id INTEGER,
  created REAL NOT NULL,
  fired REAL,
  error TEXT
)`);
addColumn("triggers", "watches", "TEXT NOT NULL DEFAULT '{}'"); // JSON: watched WITH names -> value at the last check
addColumn("triggers", "last", "INTEGER NOT NULL DEFAULT 0"); // 1 = the condition held at the last check
// Animated effects on a level, drawn in the order added. No position = covers the whole map.
db.exec(`CREATE TABLE IF NOT EXISTS map_effects (
  id INTEGER PRIMARY KEY,
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  kind TEXT NOT NULL,
  x REAL,
  y REAL,
  radius REAL,
  intensity REAL NOT NULL DEFAULT 0.5
)`);
addColumn("light_sources", "name", "TEXT"); // scripts refer to lights, effects and doors by name
addColumn("light_sources", "enabled", "INTEGER NOT NULL DEFAULT 1"); // 0 = switched off
addColumn("map_effects", "name", "TEXT");
addColumn("map_effects", "enabled", "INTEGER NOT NULL DEFAULT 1");
addColumn("map_structures", "name", "TEXT"); // doors only
nameUnnamed();
addColumn("map_effects", "w", "REAL"); // a placed effect's area: (x, y) top-left, w × h cells
addColumn("map_effects", "h", "REAL");
// Effects placed as circles (centre + radius) before areas existed become the square around the circle.
db.exec("UPDATE map_effects SET x = x - radius, y = y - radius, w = 2 * radius, h = 2 * radius WHERE radius IS NOT NULL AND w IS NULL");
addColumn("positional_sounds", "loop", "INTEGER NOT NULL DEFAULT 0"); // 1 = plays on a loop
addColumn("creatures", "height", "REAL NOT NULL DEFAULT 1.8"); // metres, for side-on tokens
addColumn("characters", "height", "REAL NOT NULL DEFAULT 1.8");
addColumn("map_levels", "figure_height", "REAL NOT NULL DEFAULT 1"); // portrait maps: grid cells a 1.8 m figure stands // a creature token's current health; null until first rolled
addColumn("map_levels", "illumination", "REAL NOT NULL DEFAULT 1"); // global light, 0 = dark .. 1 = full
addColumn("ambient_sounds", "volume", "REAL NOT NULL DEFAULT 1"); // 0..1
addColumn("positional_sounds", "volume", "REAL NOT NULL DEFAULT 1"); // 0..1
db.exec("UPDATE level_hidden_layers SET layer = 'structure' WHERE layer = 'walls'"); // layer renamed
addColumn("actions", "roll_grants", "TEXT NOT NULL DEFAULT '[]'"); // JSON RollGrant[]
addColumn("actions", "seconds", "REAL NOT NULL DEFAULT 2"); // time it takes in a combat round
addColumn("actions", "range_ft", "REAL NOT NULL DEFAULT 5"); // how far the target may be (5 = within reach)
addColumn("actions", "area_shape", "TEXT NOT NULL DEFAULT ''"); // AreaShape, '' = single target
addColumn("actions", "area_ft", "REAL NOT NULL DEFAULT 0"); // circle radius, or cone / line length
addColumn("actions", "save_dc", "INTEGER NOT NULL DEFAULT 12"); // an area's save
addColumn("actions", "save_attr", "TEXT NOT NULL DEFAULT 'agility'");
addColumn("actions", "save_half", "INTEGER NOT NULL DEFAULT 1"); // 1 = a successful save takes half damage, 0 = none
addColumn("actions", "area_lasts", "INTEGER NOT NULL DEFAULT 0"); // 1 = the area stays on the map for the duration
addColumn("actions", "area_at", "TEXT NOT NULL DEFAULT ''"); // a circle: '' = aimed at a spot within range; 'self' = where its user stands
addColumn("actions", "area_fires", "TEXT NOT NULL DEFAULT 'end'"); // a lasting area catches whoever: enter,start,end
addColumn("actions", "targets", "TEXT NOT NULL DEFAULT ''");
addColumn("actions", "target_who", "TEXT NOT NULL DEFAULT ''"); // TargetWho: '' anyone, friendly, enemy
addColumn("actions", "target_count", "TEXT NOT NULL DEFAULT 'one'"); // TargetCount: one, exactly, upto, all
addColumn("actions", "target_n", "INTEGER NOT NULL DEFAULT 1"); // N for exactly / up to N
addColumn("actions", "kind", "TEXT NOT NULL DEFAULT 'action'"); // ActionKindOf: an action, or a reaction (planned as the round's reaction; only on themselves)
addColumn("actions", "effects", "TEXT NOT NULL DEFAULT '[]'"); // the first version's catalog effects (now conditions: see the migration below)
addColumn("actions", "conditions", "TEXT NOT NULL DEFAULT '[]'"); // JSON [{ id, on }]: catalog conditions it puts on its user / target
addColumn("map_tokens", "allegiance", "TEXT"); // Allegiance (party, hostile, neutral); null = by kind (characters party, creatures hostile) // ActionTargets: who it can be used on; '' = worked out from what it does
addColumn("items", "slots", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of EquipSlot
addColumn("items", "range_ft", "REAL NOT NULL DEFAULT 5"); // weapons: how far they reach (5 = melee)
addColumn("items", "hands", "INTEGER NOT NULL DEFAULT 0"); // held in 0 (not held), 1 or 2 hands
addColumn("items", "effects", "TEXT NOT NULL DEFAULT '[]'"); // JSON effect ids: on whoever has it equipped (fire resistance, +1 defense)
addColumn("creatures", "effects", "TEXT NOT NULL DEFAULT '[]'"); // JSON effect ids: always on the creature (immune to poison)
addColumn("characters", "hp", "INTEGER"); // current health; null until first rolled from the health formula
addColumn("characters", "hp_max", "INTEGER"); // maximum health, rolled once from the formula
addColumn("characters", "hp_temp", "INTEGER"); // temporary health, lost before current
addColumn("map_tokens", "hp_max", "INTEGER");
addColumn("map_tokens", "target", "INTEGER"); // the token it has selected as its target (kept from round to round)
addColumn("map_tokens", "hp_temp", "INTEGER");
addColumn("map_tokens", "equipment", "TEXT"); // a creature token's own equipment once refitted (JSON); null = its template's
addColumn("characters", "conditions", "TEXT NOT NULL DEFAULT '[]'"); // JSON array of condition names
db.exec("CREATE TABLE IF NOT EXISTS game_vars (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); // script variables, JSON values
// The running encounter on a map level; turn_order is JSON [{ token_id, initiative }], highest first.
db.exec(`CREATE TABLE IF NOT EXISTS encounters (
  level_id INTEGER PRIMARY KEY REFERENCES map_levels(id),
  round INTEGER NOT NULL,
  turn INTEGER NOT NULL,
  turn_order TEXT NOT NULL
)`);

addColumn("map_structures", "locked", "INTEGER NOT NULL DEFAULT 0"); // doors: 1 = locked (only the GM or a successful pick lock opens it)
addColumn("map_structures", "lock_dc", "INTEGER NOT NULL DEFAULT 15"); // doors: what a pick lock roll must reach
addColumn("encounters", "replay", "TEXT"); // JSON Replay of the last resolved round (lib/resolveRound.ts)
addColumn("encounters", "last_log", "TEXT NOT NULL DEFAULT '[]'"); // JSON lines: what happened in the last resolved round
addColumn("encounters", "waiting", "TEXT NOT NULL DEFAULT '[]'"); // JSON token ids still to roll initiative (players)
addColumn("encounters", "pending", "TEXT");
addColumn("encounters", "stories", "TEXT NOT NULL DEFAULT '[]'"); // JSON RoundStory[]: every resolved round's events (players' accounts of earlier rounds) // JSON PendingRound: a round being resolved, waiting on the GM's call on a contested move
addColumn("map_tokens", "moved", "REAL NOT NULL DEFAULT 0"); // feet moved this turn (counts against the creature's speed)
addColumn("map_levels", "hide_walls", "INTEGER NOT NULL DEFAULT 0"); // 1 = the GM has hidden wall lines (they still act as walls)
// Where the party starts the campaign: an area (x, y top-left, w × h cells) on one map level.
db.exec(`CREATE TABLE IF NOT EXISTS party_start (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  level_id INTEGER NOT NULL REFERENCES map_levels(id),
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL
)`);

// One-time migration: the old per-profession "ranks" tree becomes linked professions.
const hasRanks = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ranks'").get();
if (hasRanks) {
  db.transaction(() => {
    type OldRank = { id: number; profession_id: number; parent_id: number | null; name: string; description: string };
    const ranks = db.prepare<[], OldRank>("SELECT * FROM ranks ORDER BY id").all();
    const newId = new Map<number, number>();
    for (const r of ranks) {
      const id = Number(db.prepare("INSERT INTO professions (name, description) VALUES (?, ?)").run(r.name, r.description).lastInsertRowid);
      newId.set(r.id, id);
      const from = r.parent_id === null ? r.profession_id : newId.get(r.parent_id)!;
      db.prepare("INSERT INTO profession_advancements (from_id, to_id) VALUES (?, ?)").run(from, id);
    }
    db.exec("DROP TABLE ranks");
  })();
}

// One-time migration: profession_actions became the shared actions table.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'profession_actions'").get()) {
  db.exec(`
    INSERT INTO actions (id, profession_id, name, description, roll, attack, damage, damage_type, radius, split)
      SELECT id, profession_id, name, description, roll, attack, damage, damage_type, radius, split FROM profession_actions;
    DROP TABLE profession_actions;
  `);
}

// One-time migration: per-location map settings became the location's first level.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'location_hidden_layers'").get()) {
  db.transaction(() => {
    const hasBackground = db.prepare<[], { name: string }>("PRAGMA table_info(locations)").all().some((c) => c.name === "background");
    const locations = db.prepare<[], { id: number; background: string | null }>(
      `SELECT id, ${hasBackground ? "background" : "NULL AS background"} FROM locations`
    ).all();
    for (const l of locations) {
      const levelId = Number(
        db.prepare("INSERT INTO map_levels (location_id, name, background) VALUES (?, 'Ground', ?)").run(l.id, l.background).lastInsertRowid
      );
      db.prepare("INSERT INTO level_hidden_layers (level_id, layer) SELECT ?, layer FROM location_hidden_layers WHERE location_id = ?").run(levelId, l.id);
    }
    db.exec("DROP TABLE location_hidden_layers");
  })();
}

// File images that existed before the asset library into it (idempotent: skips URLs already present).
db.exec(`
  INSERT INTO assets (name, type, usage, url)
    SELECT name, 'image', 'item', image FROM items WHERE image IS NOT NULL
    UNION ALL SELECT name, 'image', 'creature', image FROM creatures WHERE image IS NOT NULL
    UNION ALL SELECT name, 'image', 'creature', image FROM characters WHERE image IS NOT NULL
    UNION ALL SELECT name || ' background', 'image', 'background', json_extract(background, '$.image') FROM map_levels
      WHERE json_extract(background, '$.image') IS NOT NULL
    UNION ALL SELECT name || ' map', 'image', 'map', json_extract(map_image, '$.image') FROM map_levels
      WHERE json_extract(map_image, '$.image') IS NOT NULL;
  DELETE FROM assets WHERE id NOT IN (SELECT MIN(id) FROM assets GROUP BY url);
`);

// ---------- Later tables (in the order they were added) ----------

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
  ["ends_on_damage", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when hurt
  ["ends_on_attack", "INTEGER NOT NULL DEFAULT 0"], // 1: ends when they attack
  ["ends_on_trigger", "INTEGER NOT NULL DEFAULT 0"], // 1: ends once its trigger fires
  ["concentration", "INTEGER NOT NULL DEFAULT 0"], // 1: needs whoever put it on to keep concentrating
  ["reapply", "TEXT NOT NULL DEFAULT 'refresh'"], // put on again: refresh | stack | ignore
  ["stack_limit", "INTEGER NOT NULL DEFAULT 0"], // stacking: at most this many (0 = no limit)
];

// Professions are progressions of ranks: each rank (a `professions` row) belongs to a profession (`profession_groups`),
// and a character has one rank (`characters.rank_id`), holding every rank before it too.
db.exec("CREATE TABLE IF NOT EXISTS profession_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '')");

addColumn("professions", "group_id", "INTEGER");

 // its profession (profession_groups)
addColumn("characters", "rank_id", "INTEGER");

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

addColumn("token_walks", "fps", "REAL NOT NULL DEFAULT 5");

 // how fast it went (feet per second): played back in real time
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

addColumn("game_sessions", "ended_at", "TEXT");

 // real time it ended; null while it's running
addColumn("game_sessions", "start_state", "TEXT");

 // JSON snapshot of game state when it started (lib/sessionLog.ts)
addColumn("game_sessions", "summary", "TEXT");

 // JSON summary written when it ended
addColumn("game_sessions", "began_at", "TEXT");

 // when the GM began play; until then the session is in its lobby
db.exec("UPDATE game_sessions SET began_at = started_at WHERE began_at IS NULL AND ended_at IS NOT NULL");

 // sessions from before lobbies
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

// ---------- Hazards (lib/hazards.ts; claude/hazards-design.md) ----------

// A place on the map that does something to whoever is in it: drawn by the GM, left by an action (a fire wall) or an
// improvisation; gone once game time passes `ends`. Was `lasting_areas` (renamed 2026-11-27, backlog X).
const tableExists = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
if (tableExists("lasting_areas") && !tableExists("hazards")) db.exec("ALTER TABLE lasting_areas RENAME TO hazards");
db.exec(`CREATE TABLE IF NOT EXISTS hazards (
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

addColumn("token_afflictions", "saved", "INTEGER NOT NULL DEFAULT 0");

 // successful saves so far
addColumn("token_afflictions", "aura", "INTEGER");

 // given by this token's aura (while within it)
addColumn("token_afflictions", "area", "INTEGER");

 // given by this lasting area (while in it)

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
addColumn("map_triggers", "visibility", "TEXT NOT NULL DEFAULT 'gm'"); // gm (never shown) | hidden (until found) | shown
addColumn("map_triggers", "find_dc", "INTEGER NOT NULL DEFAULT 14"); // hidden: a Search beating this within 10 ft finds it
addColumn("map_triggers", "found", "INTEGER NOT NULL DEFAULT 0");

// One-time data migrations already run (lib/db/migrations.ts), by name.
db.exec("CREATE TABLE IF NOT EXISTS migrations_done (name TEXT PRIMARY KEY)");
