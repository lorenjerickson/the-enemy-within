import { addColumn, db } from "./db";

/**
 * The story: discoveries (what the party can learn) and objectives (what it's asked to do).
 * The GM knows whether a discovery is a truth, a rumor or a belief; the party never does.
 */
export const DISCOVERY_KINDS = ["truth", "rumor", "belief"] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export const RELATIONS = ["contradicts", "reinforces"] as const;
export type Relation = (typeof RELATIONS)[number];

export const OBJECTIVE_STATUSES = ["open", "succeeded", "failed"] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

db.exec(`
  CREATE TABLE IF NOT EXISTS discoveries (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'truth',        -- DiscoveryKind, GM only
    location_id INTEGER REFERENCES locations(id),   -- owner: a location, a character or an item (or none)
    character_id INTEGER REFERENCES characters(id),
    item_id INTEGER REFERENCES items(id),
    objective_id INTEGER REFERENCES objectives(id), -- the objective this discovery assigns
    found INTEGER NOT NULL DEFAULT 0,             -- 1 = the party has learned it
    reveal TEXT NOT NULL DEFAULT '',              -- how it's found, e.g. "searching the desk"
    reveal_skill TEXT,                            -- optional check to find it, e.g. "investigation"
    reveal_dc INTEGER                             -- that check's difficulty
  );
  -- Contradicts / reinforces, stored once per pair (from_id < to_id) and shown on both.
  CREATE TABLE IF NOT EXISTS discovery_links (
    from_id INTEGER NOT NULL REFERENCES discoveries(id),
    to_id INTEGER NOT NULL REFERENCES discoveries(id),
    relation TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE TABLE IF NOT EXISTS objectives (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    success TEXT NOT NULL DEFAULT '',
    success_within_days REAL,                  -- deadline, e.g. "within 3 days" (checked once there's a game calendar)
    success_check TEXT NOT NULL DEFAULT '',    -- optional game-state expression that's true when it has succeeded
    failure TEXT NOT NULL DEFAULT '',
    failure_check TEXT NOT NULL DEFAULT '',    -- optional game-state expression that's true when it has failed
    reward TEXT NOT NULL DEFAULT '',
    reward_discovery_id INTEGER REFERENCES discoveries(id), -- found when the objective succeeds
    reward_script TEXT NOT NULL DEFAULT '',    -- game script run when it succeeds
    penalty TEXT NOT NULL DEFAULT '',
    penalty_after_days REAL,                   -- e.g. "two weeks later"
    penalty_script TEXT NOT NULL DEFAULT '',   -- game script run when it fails
    status TEXT NOT NULL DEFAULT 'open',
    revealed INTEGER NOT NULL DEFAULT 0,       -- the party knows about it
    details_revealed INTEGER NOT NULL DEFAULT 0 -- the party sees its conditions, reward and penalty
  );
  -- Who an objective is for; none = the whole party.
  CREATE TABLE IF NOT EXISTS objective_characters (
    objective_id INTEGER NOT NULL REFERENCES objectives(id),
    character_id INTEGER NOT NULL REFERENCES characters(id),
    PRIMARY KEY (objective_id, character_id)
  );
`);

addColumn("discoveries", "on_found", "TEXT NOT NULL DEFAULT ''"); // game script run once when the party finds it

export interface Discovery {
  id: number;
  title: string;
  text: string;
  kind: DiscoveryKind;
  location_id: number | null;
  character_id: number | null;
  item_id: number | null;
  objective_id: number | null;
  found: 0 | 1;
  reveal: string; // how it's found
  reveal_skill: string | null; // optional skill check to find it…
  reveal_dc: number | null; // …and its difficulty
  on_found: string; // game script run when the party finds it, e.g. starting a timer
  owner_name: string | null; // the location's, character's or item's name
}

const DISCOVERY_SELECT = `SELECT d.id, d.title, d.text, d.kind, d.location_id, d.character_id, d.item_id, d.objective_id, d.found,
  d.reveal, d.reveal_skill, d.reveal_dc, d.on_found, COALESCE(l.name, c.name, i.name) AS owner_name
  FROM discoveries d LEFT JOIN locations l ON l.id = d.location_id LEFT JOIN characters c ON c.id = d.character_id
  LEFT JOIN items i ON i.id = d.item_id`;

export function listDiscoveries(): Discovery[] {
  return db.prepare<[], Discovery>(`${DISCOVERY_SELECT} ORDER BY d.title`).all();
}

export function getDiscovery(id: number): Discovery | undefined {
  return db.prepare<[number], Discovery>(`${DISCOVERY_SELECT} WHERE d.id = ?`).get(id);
}

/** Inserts when id is null, otherwise updates. Returns the id. */
export function saveDiscovery(id: number | null, d: Omit<Discovery, "id" | "owner_name">): number {
  if (id === null) {
    return Number(
      db.prepare<Omit<Discovery, "id" | "owner_name">>(
        `INSERT INTO discoveries (title, text, kind, location_id, character_id, item_id, objective_id, found, reveal, reveal_skill, reveal_dc, on_found)
         VALUES (@title, @text, @kind, @location_id, @character_id, @item_id, @objective_id, @found, @reveal, @reveal_skill, @reveal_dc, @on_found)`
      ).run(d).lastInsertRowid
    );
  }
  db.prepare<Omit<Discovery, "owner_name">>(
    `UPDATE discoveries SET title = @title, text = @text, kind = @kind, location_id = @location_id, character_id = @character_id,
       item_id = @item_id, objective_id = @objective_id, found = @found, reveal = @reveal, reveal_skill = @reveal_skill,
       reveal_dc = @reveal_dc, on_found = @on_found WHERE id = @id`
  ).run({ ...d, id });
  return id;
}

/**
 * The party learns a discovery; an objective it assigns becomes known to the party too.
 * (Use revealDiscovery in lib/storyRules.ts, which also runs its "when found" script.)
 */
export function findDiscovery(id: number): void {
  db.prepare<[number]>("UPDATE discoveries SET found = 1 WHERE id = ?").run(id);
  db.prepare<[number]>("UPDATE objectives SET revealed = 1 WHERE id = (SELECT objective_id FROM discoveries WHERE id = ?)").run(id);
}

export function deleteDiscovery(id: number): void {
  db.transaction(() => {
    db.prepare<[number, number]>("DELETE FROM discovery_links WHERE from_id = ? OR to_id = ?").run(id, id);
    db.prepare<[number]>("UPDATE objectives SET reward_discovery_id = NULL WHERE reward_discovery_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM discoveries WHERE id = ?").run(id);
  })();
}

/** A discovery's links to others: the other discovery and how they relate. */
export function listLinks(id: number): { other_id: number; relation: Relation }[] {
  return db
    .prepare<[number, number, number], { other_id: number; relation: Relation }>(
      "SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other_id, relation FROM discovery_links WHERE from_id = ? OR to_id = ?"
    )
    .all(id, id, id);
}

/** Replaces a discovery's links (relation per other discovery; missing = no link). */
export function setLinks(id: number, links: { other_id: number; relation: Relation }[]): void {
  db.transaction(() => {
    db.prepare<[number, number]>("DELETE FROM discovery_links WHERE from_id = ? OR to_id = ?").run(id, id);
    const insert = db.prepare<[number, number, string]>("INSERT INTO discovery_links (from_id, to_id, relation) VALUES (?, ?, ?)");
    for (const l of links) if (l.other_id !== id) insert.run(Math.min(id, l.other_id), Math.max(id, l.other_id), l.relation);
  })();
}

export interface Objective {
  id: number;
  title: string;
  description: string;
  success: string;
  success_within_days: number | null;
  success_check: string;
  failure: string;
  failure_check: string;
  reward: string;
  reward_discovery_id: number | null;
  reward_script: string;
  penalty: string;
  penalty_after_days: number | null;
  penalty_script: string;
  status: ObjectiveStatus;
  revealed: 0 | 1;
  details_revealed: 0 | 1;
}

const OBJECTIVE_COLUMNS = `id, title, description, success, success_within_days, success_check, failure, failure_check, reward, reward_discovery_id, reward_script,
  penalty, penalty_after_days, penalty_script, status, revealed, details_revealed`;

export function listObjectives(): Objective[] {
  return db.prepare<[], Objective>(`SELECT ${OBJECTIVE_COLUMNS} FROM objectives ORDER BY title`).all();
}

export function getObjective(id: number): Objective | undefined {
  return db.prepare<[number], Objective>(`SELECT ${OBJECTIVE_COLUMNS} FROM objectives WHERE id = ?`).get(id);
}

/** Inserts when id is null, otherwise updates (status is changed with setObjectiveStatus). Returns the id. */
export function saveObjective(id: number | null, o: Omit<Objective, "id" | "status">): number {
  if (id === null) {
    return Number(
      db.prepare<Omit<Objective, "id" | "status">>(
        `INSERT INTO objectives (title, description, success, success_within_days, success_check, failure, failure_check, reward,
           reward_discovery_id, reward_script, penalty, penalty_after_days, penalty_script, revealed, details_revealed)
         VALUES (@title, @description, @success, @success_within_days, @success_check, @failure, @failure_check, @reward, @reward_discovery_id, @reward_script,
           @penalty, @penalty_after_days, @penalty_script, @revealed, @details_revealed)`
      ).run(o).lastInsertRowid
    );
  }
  db.prepare<Omit<Objective, "status">>(
    `UPDATE objectives SET title = @title, description = @description, success = @success, success_within_days = @success_within_days,
       success_check = @success_check, failure = @failure, failure_check = @failure_check, reward = @reward, reward_discovery_id = @reward_discovery_id, reward_script = @reward_script,
       penalty = @penalty, penalty_after_days = @penalty_after_days, penalty_script = @penalty_script,
       revealed = @revealed, details_revealed = @details_revealed WHERE id = @id`
  ).run({ ...o, id });
  return id;
}

export function setObjectiveStatus(id: number, status: ObjectiveStatus): void {
  db.prepare<[string, number]>("UPDATE objectives SET status = ? WHERE id = ?").run(status, id);
}

export function setObjectiveRevealed(id: number, revealed: boolean): void {
  db.prepare<[number, number]>("UPDATE objectives SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, id);
}

export function deleteObjective(id: number): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM objective_characters WHERE objective_id = ?").run(id);
    db.prepare<[number]>("UPDATE discoveries SET objective_id = NULL WHERE objective_id = ?").run(id);
    db.prepare<[number]>("DELETE FROM objectives WHERE id = ?").run(id);
  })();
}

/** The characters an objective is for; empty = the whole party. */
export function listObjectiveCharacters(id: number): number[] {
  return db.prepare<[number], { character_id: number }>("SELECT character_id FROM objective_characters WHERE objective_id = ?").all(id).map((r) => r.character_id);
}

export function setObjectiveCharacters(id: number, characterIds: number[]): void {
  db.transaction(() => {
    db.prepare<[number]>("DELETE FROM objective_characters WHERE objective_id = ?").run(id);
    const insert = db.prepare<[number, number]>("INSERT INTO objective_characters (objective_id, character_id) VALUES (?, ?)");
    for (const c of characterIds) insert.run(id, c);
  })();
}
