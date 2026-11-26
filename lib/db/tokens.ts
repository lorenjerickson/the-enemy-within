import { db } from "@/lib/db/connection";
import { getEncounter, saveEncounter, setEncounterWaiting, getEncounterWaiting } from "@/lib/db/encounters";
import type { CreatureType } from "@/lib/creatureTypes";
import type { Attributes } from "@/lib/attributes";
import { getPartyStart, getGmLevelId } from "@/lib/db/maps";
import type { PartyStart } from "@/lib/db/maps";
import { getOpenGameSession } from "@/lib/db/sessions";
import type { Status } from "@/lib/status";
import { getGameTime } from "@/lib/db/calendar";

/** A token on a level: who it is (creature or character), how it looks, and its cell. */
export interface MapToken {
  id: number;
  creature_id: number | null;
  character_id: number | null;
  name: string;
  image: string | null;
  col: number;
  row: number;
  hp: number | null; // creature tokens only; characters use their own
  token_overhead: string | null; // the creature's / character's token art
  token_side: string | null;
  height: number; // metres
  allegiance: string | null; // party / hostile / neutral as the GM set it (null: by kind; see lib/sides.ts)
  player_name?: string | null; // a character's player (shown on hover)
}

export function listTokens(levelId: number): MapToken[] {
  return db
    .prepare<[number], MapToken>(
      `SELECT t.id, t.creature_id, t.character_id, COALESCE(ch.name, cr.name) AS name, COALESCE(ch.image, cr.image) AS image, t.col, t.row, t.hp,
         CASE WHEN t.character_id IS NULL THEN cr.token_overhead ELSE ch.token_overhead END AS token_overhead,
         CASE WHEN t.character_id IS NULL THEN cr.token_side ELSE ch.token_side END AS token_side,
         CASE WHEN t.character_id IS NULL THEN cr.height ELSE ch.height END AS height, t.allegiance,
         (SELECT u.name FROM users u WHERE u.id = ch.player_id) AS player_name
       FROM map_tokens t
       LEFT JOIN creatures cr ON cr.id = t.creature_id
       LEFT JOIN characters ch ON ch.id = t.character_id
       WHERE t.level_id = ? ORDER BY t.id`
    )
    .all(levelId);
}

/** Places a creature token; its health is rolled the first time it's needed (or saved with saveTokenHealth). */
export function addCreatureToken(levelId: number, creatureId: number, col: number, row: number): number {
  return Number(
    db.prepare<[number, number, number, number]>("INSERT INTO map_tokens (level_id, creature_id, col, row) VALUES (?, ?, ?, ?)").run(levelId, creatureId, col, row).lastInsertRowid
  );
}

export function getTokenLevel(id: number): number | undefined {
  return db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(id)?.level_id;
}

/**
 * Places a character on a level. A character can have tokens in several locations at once, but one per level:
 * placing it again on the same level moves that token.
 */
export function placeCharacterToken(levelId: number, characterId: number, col: number, row: number): number {
  return db.transaction(() => {
    db.prepare<[number, number]>("DELETE FROM map_tokens WHERE character_id = ? AND level_id = ?").run(characterId, levelId);
    const id = Number(
      db.prepare<[number, number, number, number]>("INSERT INTO map_tokens (level_id, character_id, col, row) VALUES (?, ?, ?, ?)").run(
        levelId, characterId, col, row
      ).lastInsertRowid
    );
    recordSighting(id);
    return id;
  })();
}

/** The location a map level belongs to, with the level's name. */
export function getLevelPlace(levelId: number): { location_id: number; location: string; level: string } | undefined {
  return db
    .prepare<[number], { location_id: number; location: string; level: string }>(
      "SELECT l.id AS location_id, l.name AS location, m.name AS level FROM map_levels m JOIN locations l ON l.id = m.location_id WHERE m.id = ?"
    )
    .get(levelId);
}

export function deleteToken(id: number): void {
  db.prepare<[number]>("DELETE FROM map_tokens WHERE id = ?").run(id);
}

/** The token a token has selected as its target (its last one planned, or one its player clicked), if any. */
export function getTokenTarget(id: number): number | null {
  return db.prepare<[number], { target: number | null }>("SELECT target FROM map_tokens WHERE id = ?").get(id)?.target ?? null;
}

export function setTokenTarget(id: number, target: number | null): void {
  db.prepare<[number | null, number]>("UPDATE map_tokens SET target = ? WHERE id = ?").run(target, id);
}

/** Everyone's selected target on a level let go (after each round: targets don't carry over). */
export function clearTokenTargets(levelId: number): void {
  db.prepare<[number]>("UPDATE map_tokens SET target = NULL WHERE level_id = ?").run(levelId);
}

export function moveToken(id: number, col: number, row: number): void {
  db.prepare<[number, number, number]>("UPDATE map_tokens SET col = ?, row = ? WHERE id = ?").run(col, row, id);
  recordSighting(id);
}

// Standing orders out of encounters: a player's character follows, pursues or evades another token, moving whenever
// that one moves. Cleared when an encounter starts on the level, they move on their own, or they stop it.
export type StandingMode = "follow" | "pursue" | "evade";

export function setStandingOrder(tokenId: number, targetId: number, mode: StandingMode): void {
  db.prepare("INSERT OR REPLACE INTO token_follows (token_id, target_id, mode) VALUES (?, ?, ?)").run(tokenId, targetId, mode);
}

export function clearStandingOrder(tokenId: number): void {
  db.prepare("DELETE FROM token_follows WHERE token_id = ?").run(tokenId);
}

/** Clears every standing order on a level (an encounter starts there). */
export function clearStandingOrdersOn(levelId: number): void {
  db.prepare("DELETE FROM token_follows WHERE token_id IN (SELECT id FROM map_tokens WHERE level_id = ?)").run(levelId);
}

/** A token's standing order, if the one it's about is still on the same level. */
export function getStandingOrder(tokenId: number): { targetId: number; mode: StandingMode } | undefined {
  const r = db
    .prepare<[number], { target_id: number; mode: StandingMode }>(
      "SELECT f.target_id, f.mode FROM token_follows f JOIN map_tokens a ON a.id = f.token_id JOIN map_tokens b ON b.id = f.target_id AND b.level_id = a.level_id WHERE f.token_id = ?"
    )
    .get(tokenId);
  return r && { targetId: r.target_id, mode: r.mode };
}

/** Who has a standing order about this token (on its level). */
export function listStandingOrdersOn(targetId: number): { tokenId: number; mode: StandingMode }[] {
  return db
    .prepare<[number], { token_id: number; mode: StandingMode }>(
      "SELECT f.token_id, f.mode FROM token_follows f JOIN map_tokens a ON a.id = f.token_id JOIN map_tokens b ON b.id = f.target_id AND b.level_id = a.level_id WHERE f.target_id = ?"
    )
    .all(targetId)
    .map((r) => ({ tokenId: r.token_id, mode: r.mode }));
}

 // or seconds from the start at each point (walking alongside someone: their pace varies)

/** Records a walk (route: token corners, start first) at `fps` feet per second, by `userId` (0: nobody's own screen played it). */
export function addTokenWalk(levelId: number, tokenId: number, route: { x: number; y: number }[], userId: number, fps = 5, times?: number[]): void {
  db.prepare("DELETE FROM token_walks WHERE at < ?").run(Date.now() - 60_000);
  db.prepare("INSERT INTO token_walks (level_id, token_id, route, user_id, at, fps, times) VALUES (?, ?, ?, ?, ?, ?, ?)").run(levelId, tokenId, JSON.stringify(route), userId, Date.now(), fps, times ? JSON.stringify(times) : null);
}

export function listTokenWalks(levelId: number, afterId: number): { id: number; token_id: number; route: { x: number; y: number }[]; user_id: number; fps: number; times: number[] | null }[] {
  return db
    .prepare<[number, number, number], { id: number; token_id: number; route: string; user_id: number; fps: number; times: string | null }>("SELECT id, token_id, route, user_id, fps, times FROM token_walks WHERE level_id = ? AND id > ? AND at > ? ORDER BY id")
    .all(levelId, afterId, Date.now() - 5_000)
    .map((r) => ({ ...r, route: JSON.parse(r.route), times: r.times ? JSON.parse(r.times) : null }));
}

 // ms since epoch: in a round, when the replay shows them reaching it

export function setLinkPrompt(tokenId: number, linkId: number, back: { col: number; row: number }, showAt = 0): void {
  db.prepare("INSERT OR REPLACE INTO link_prompts (token_id, link_id, back_col, back_row, show_at) VALUES (?, ?, ?, ?, ?)").run(tokenId, linkId, back.col, back.row, showAt);
}

/** The level link prompt waiting for a token, with the name of the level it leads to. */
export function getLinkPrompt(tokenId: number): { id: number; to: string; back: { x: number; y: number }; showAt: number } | undefined {
  const r = db
    .prepare<[number], { link_id: number; back_col: number; back_row: number; show_at: number; to: string | null }>(
      "SELECT p.link_id, p.back_col, p.back_row, p.show_at, l.name AS \"to\" FROM link_prompts p JOIN map_structures s ON s.id = p.link_id LEFT JOIN map_levels l ON l.id = s.target_level_id WHERE p.token_id = ?"
    )
    .get(tokenId);
  return r && { id: r.link_id, to: r.to ?? "another level", back: { x: r.back_col, y: r.back_row }, showAt: r.show_at };
}

export function clearLinkPrompt(tokenId: number): void {
  db.prepare("DELETE FROM link_prompts WHERE token_id = ?").run(tokenId);
}

/**
 * Moves a token to another level (taking a level link). It leaves the encounter on the level it was on (turn order,
 * round plan, waiting list); on the new level it arrives outside any encounter there (the GM adds it).
 */
export function moveTokenToLevel(id: number, levelId: number, col: number, row: number): void {
  db.transaction(() => {
    const from = db.prepare<[number], { level_id: number }>("SELECT level_id FROM map_tokens WHERE id = ?").get(id)?.level_id;
    db.prepare<[number, number, number, number]>("UPDATE map_tokens SET level_id = ?, col = ?, row = ? WHERE id = ?").run(levelId, col, row, id);
    recordSighting(id);
    if (from === undefined) return;
    db.prepare("DELETE FROM round_plans WHERE level_id = ? AND token_id = ?").run(from, id);
    const enc = getEncounter(from);
    if (!enc) return;
    const at = enc.order.findIndex((o) => o.token_id === id);
    if (at >= 0) {
      const order = enc.order.filter((o) => o.token_id !== id);
      saveEncounter(from, { ...enc, order, turn: Math.max(0, Math.min(enc.turn - (at < enc.turn ? 1 : 0), order.length - 1)) });
    }
    setEncounterWaiting(from, getEncounterWaiting(from).filter((t) => t !== id));
  })();
}

function recordSighting(tokenId: number): void {
  db.prepare<[number]>(
    "INSERT OR IGNORE INTO sightings SELECT character_id, level_id, col + 0.5, row + 0.5 FROM map_tokens WHERE id = ? AND character_id IS NOT NULL"
  ).run(tokenId);
}

/** A spot a character's token passed through (each second of a round's movement): it saw from there too. */
export function recordSightingAt(tokenId: number, col: number, row: number): void {
  db.prepare<[number, number, number]>(
    "INSERT OR IGNORE INTO sightings SELECT character_id, level_id, ? + 0.5, ? + 0.5 FROM map_tokens WHERE id = ? AND character_id IS NOT NULL"
  ).run(col, row, tokenId);
}

/** Where one character has stood on this level (its fog of war viewpoints, for the GM planning as it). */
export function listCharacterSightings(characterId: number, levelId: number): { x: number; y: number }[] {
  return db.prepare<[number, number], { x: number; y: number }>("SELECT x, y FROM sightings WHERE character_id = ? AND level_id = ?").all(characterId, levelId);
}

/** Where a player's characters have stood on this level (fog of war viewpoints). */
export function listSightings(playerId: number, levelId: number): { x: number; y: number }[] {
  return db
    .prepare<[number, number], { x: number; y: number }>(
      "SELECT DISTINCT s.x, s.y FROM sightings s JOIN characters c ON c.id = s.character_id WHERE c.player_id = ? AND s.level_id = ?"
    )
    .all(playerId, levelId);
}

/** A player's character token on the map they're seeing (see getPlayerTokenLevelId). */
export function getPlayerToken(playerId: number): { token_id: number; character_id: number; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number } | undefined {
  return db
    .prepare<[number, number], { token_id: number; character_id: number; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number }>(
      "SELECT t.id AS token_id, c.id AS character_id, c.name, c.attributes, c.movement, t.moved, t.level_id, t.col, t.row FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? AND t.level_id = ? ORDER BY t.id DESC LIMIT 1"
    )
    .get(playerId, getPlayerTokenLevelId(playerId) ?? -1); // the token on the map they're seeing
}

/** Anyone on the map as an actor (a character or a creature), in the shape a player's token comes in (character_id null: a creature). */
export type ActorToken = { token_id: number; character_id: number | null; name: string; attributes: string; movement: string; moved: number; level_id: number; col: number; row: number };

export function getTokenActor(tokenId: number): ActorToken | undefined {
  return db
    .prepare<[number], ActorToken>(
      `SELECT t.id AS token_id, t.character_id, COALESCE(c.name, cr.name, 'someone') AS name, COALESCE(c.attributes, cr.attributes, '{}') AS attributes,
              COALESCE(c.movement, cr.movement, '{}') AS movement, t.moved, t.level_id, t.col, t.row
       FROM map_tokens t LEFT JOIN characters c ON c.id = t.character_id LEFT JOIN creatures cr ON cr.id = t.creature_id WHERE t.id = ?`
    )
    .get(tokenId);
}

// ---------- Game state changed by scripts ----------

export interface CharacterState {
  id: number;
  name: string;
  type: CreatureType;
  attributes: Attributes;
  health: string; // formula
  hp: number | null;
  conditions: string[];
  in_party: 0 | 1;
}

export function listCharacterStates(): CharacterState[] {
  return db
    .prepare<[], Omit<CharacterState, "attributes" | "conditions"> & { attributes: string; conditions: string }>(
      "SELECT id, name, type, attributes, health, hp, conditions, in_party FROM characters ORDER BY name"
    )
    .all()
    .map((r) => ({ ...r, attributes: JSON.parse(r.attributes), conditions: JSON.parse(r.conditions) }));
}

/** Saves what a script may change on a character (health is saved separately, with saveCharacterHealth). */
export function saveCharacterState(s: Pick<CharacterState, "id" | "attributes" | "conditions">): void {
  db.prepare<[string, string, number]>("UPDATE characters SET attributes = ?, conditions = ? WHERE id = ?").run(JSON.stringify(s.attributes), JSON.stringify(s.conditions), s.id);
}

export function isInParty(characterId: number): boolean {
  return !!db.prepare<[number], { in_party: number }>("SELECT in_party FROM characters WHERE id = ?").get(characterId)?.in_party;
}

export function setInParty(characterId: number, inParty: boolean): void {
  db.prepare<[number, number]>("UPDATE characters SET in_party = ? WHERE id = ?").run(inParty ? 1 : 0, characterId);
}

/** The player who plays a character, if any. */
export function getCharacterPlayer(characterId: number): number | null {
  return db.prepare<[number], { player_id: number | null }>("SELECT player_id FROM characters WHERE id = ?").get(characterId)?.player_id ?? null;
}

export function setCharacterPlayer(characterId: number, playerId: number | null): void {
  db.prepare<[number | null, number]>("UPDATE characters SET player_id = ? WHERE id = ?").run(playerId, characterId);
}

/** The party's characters (ticked "In the party"), by name. */
export function listPartyMembers(): { id: number; name: string; player_id: number | null }[] {
  return db.prepare<[], { id: number; name: string; player_id: number | null }>("SELECT id, name, player_id FROM characters WHERE in_party = 1 ORDER BY name").all();
}

/** The characters a player plays. */
export function listPlayerCharacters(playerId: number): { id: number; name: string }[] {
  return db.prepare<[number], { id: number; name: string }>("SELECT id, name FROM characters WHERE player_id = ? ORDER BY name").all(playerId);
}

// ---------- Party placement ----------

export interface UnplacedCharacter {
  id: number;
  name: string;
  image: string | null;
  player: string;
}

/**
 * Once the first session has begun: the party's start area, and the players' characters with no token on any map yet.
 * Undefined when there's nothing to place (no first session running, no start area, or everyone is placed).
 */
export function getPartyPlacement(): { start: PartyStart; unplaced: UnplacedCharacter[] } | undefined {
  const session = getOpenGameSession();
  if (!session || session.number !== 1 || !session.began_at) return undefined;
  const start = getPartyStart();
  if (!start) return undefined;
  const unplaced = db
    .prepare<[], UnplacedCharacter>(
      `SELECT c.id, c.name, c.image, u.name AS player FROM characters c JOIN users u ON u.id = c.player_id
       WHERE NOT EXISTS (SELECT 1 FROM map_tokens t WHERE t.character_id = c.id) ORDER BY u.name, c.name`
    )
    .all();
  return unplaced.length ? { start, unplaced } : undefined;
}

/** The map level a player's character token is on, if the GM has placed it. */
/**
 * The map a player sees: the GM's active location if their character has a token there, otherwise the level of
 * their most recently placed token. (A character can have tokens in several locations at once.)
 */
export function getPlayerTokenLevelId(playerId: number): number | undefined {
  const levels = db
    .prepare<[number], { level_id: number }>(
      "SELECT t.level_id FROM map_tokens t JOIN characters c ON c.id = t.character_id WHERE c.player_id = ? GROUP BY t.level_id ORDER BY MAX(t.id) DESC"
    )
    .all(playerId)
    .map((r) => r.level_id);
  const active = getGmLevelId();
  return active !== undefined && levels.includes(active) ? active : levels[0];
}

export function addTokenStatus(levelId: number, tokenId: number, status: Status, ends: number): void {
  db.prepare("DELETE FROM token_statuses WHERE ends <= ?").run(getGameTime());
  db.prepare("INSERT INTO token_statuses (level_id, token_id, ends, status) VALUES (?, ?, ?, ?)").run(levelId, tokenId, ends, JSON.stringify(status));
}

/** Statuses in effect on a level's tokens, by token id. */
export function listTokenStatuses(levelId: number): Map<number, (Status & { id: number; ends: number })[]> {
  const rows = db
    .prepare<[number, number], { id: number; token_id: number; ends: number; status: string }>("SELECT id, token_id, ends, status FROM token_statuses WHERE level_id = ? AND ends > ? ORDER BY id")
    .all(levelId, getGameTime());
  const out = new Map<number, (Status & { id: number; ends: number })[]>();
  for (const r of rows) out.set(r.token_id, [...(out.get(r.token_id) ?? []), { id: r.id, ends: r.ends, ...JSON.parse(r.status) }]);
  return out;
}

export function removeTokenStatus(id: number): void {
  db.prepare("DELETE FROM token_statuses WHERE id = ?").run(id);
}

export function setHidden(tokenId: number, stealth: number): void {
  db.prepare("INSERT OR REPLACE INTO token_hidden (token_id, stealth) VALUES (?, ?)").run(tokenId, Math.round(stealth));
}

export function clearHidden(tokenId: number): void {
  db.prepare("DELETE FROM token_hidden WHERE token_id = ?").run(tokenId);
}

/** Hidden tokens on a level, with their Stealth totals. */
export function listHidden(levelId: number): Map<number, number> {
  return new Map(
    db.prepare<[number], { token_id: number; stealth: number }>("SELECT h.token_id, h.stealth FROM token_hidden h JOIN map_tokens t ON t.id = h.token_id WHERE t.level_id = ?").all(levelId).map((r) => [r.token_id, r.stealth])
  );
}

export function setAssist(tokenId: number, byToken: number, byName: string): void {
  db.prepare("INSERT OR REPLACE INTO assists (token_id, by_token, by_name) VALUES (?, ?, ?)").run(tokenId, byToken, byName);
}

export function listAssists(levelId: number): { tokenId: number; byToken: number; byName: string }[] {
  return db
    .prepare<[number], { token_id: number; by_token: number; by_name: string }>("SELECT a.token_id, a.by_token, a.by_name FROM assists a JOIN map_tokens t ON t.id = a.token_id WHERE t.level_id = ?")
    .all(levelId)
    .map((r) => ({ tokenId: r.token_id, byToken: r.by_token, byName: r.by_name }));
}

export function clearAssist(tokenId: number): void {
  db.prepare("DELETE FROM assists WHERE token_id = ?").run(tokenId);
}

/** A token spends movement: it moves to (col, row) and `feet` is added to what it has moved this turn. */
export function walkToken(id: number, col: number, row: number, feet: number): void {
  db.prepare<[number, number]>("UPDATE map_tokens SET moved = moved + ? WHERE id = ?").run(feet, id);
  moveToken(id, col, row);
}

/** A token as a mover in an encounter: where it is and its creature's or character's movement (JSON). */
export function getTokenMover(tokenId: number): { token_id: number; level_id: number; col: number; row: number; movement: string } | undefined {
  return db
    .prepare<[number], { token_id: number; level_id: number; col: number; row: number; movement: string }>(
      `SELECT t.id AS token_id, t.level_id, t.col, t.row, COALESCE(ch.movement, cr.movement, '{}') AS movement
       FROM map_tokens t LEFT JOIN characters ch ON ch.id = t.character_id LEFT JOIN creatures cr ON cr.id = t.creature_id WHERE t.id = ?`
    )
    .get(tokenId);
}

/** Token names on a level, with several of the same name numbered (Human 1, Human 2) so they can be told apart. */
export function tokenLabels(levelId: number): Map<number, string> {
  const tokens = listTokens(levelId);
  const count = new Map<string, number>(), seen = new Map<string, number>();
  for (const t of tokens) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  return new Map(
    tokens.map((t) => {
      const n = (seen.get(t.name) ?? 0) + 1;
      seen.set(t.name, n);
      return [t.id, count.get(t.name)! > 1 ? `${t.name} ${n}` : t.name];
    })
  );
}

/** Every player's character and where its tokens are (a row per token: location and level), or nowhere yet. */
export function listPlayerPlaces(): { character: string; player: string; player_id: number; level_id: number | null; location: string | null; level: string | null }[] {
  return db
    .prepare<[], { character: string; player: string; player_id: number; level_id: number | null; location: string | null; level: string | null }>(
      `SELECT c.name AS character, u.name AS player, u.id AS player_id, t.level_id, l.name AS location, m.name AS level
       FROM characters c JOIN users u ON u.id = c.player_id
       LEFT JOIN map_tokens t ON t.character_id = c.id LEFT JOIN map_levels m ON m.id = t.level_id LEFT JOIN locations l ON l.id = m.location_id
       ORDER BY u.name, c.name`
    )
    .all();
}

/**
 * Deletes a character and everything that's only about it: its tokens (and their round plans), professions,
 * journal, fog memory, pending rolls and objective assignments. Discoveries it owned lose their owner.
 */
export function deleteCharacter(id: number): void {
  db.transaction(() => {
    const tokens = db.prepare<[number], { id: number }>("SELECT id FROM map_tokens WHERE character_id = ?").all(id).map((t) => t.id);
    for (const t of tokens) db.prepare("DELETE FROM round_plans WHERE token_id = ?").run(t);
    db.prepare("DELETE FROM map_tokens WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM character_professions WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM container_items WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM sightings WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM roll_requests WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM journal_entries WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM objective_characters WHERE character_id = ?").run(id);
    db.prepare("UPDATE discoveries SET character_id = NULL WHERE character_id = ?").run(id);
    db.prepare("DELETE FROM characters WHERE id = ?").run(id);
  })();
}

/** Player names by character id (characters nobody plays are left out). */
export function characterPlayers(): Map<number, string> {
  return new Map(
    db.prepare<[], { id: number; name: string }>("SELECT c.id, u.name FROM characters c JOIN users u ON u.id = c.player_id").all().map((r) => [r.id, r.name])
  );
}

/** Tokens on a level that are down (health 0 or less): they sit out planning until revived (health above 0). */
export function downTokens(levelId: number): Set<number> {
  return new Set(
    db.prepare<[number], { id: number }>(
      `SELECT t.id FROM map_tokens t LEFT JOIN characters c ON c.id = t.character_id
       WHERE t.level_id = ? AND COALESCE(CASE WHEN t.character_id IS NULL THEN t.hp ELSE c.hp END, 1) <= 0`
    ).all(levelId).map((r) => r.id)
  );
}

/** The GM sets a token's side (null: back to its kind's default). */
export function setTokenAllegiance(tokenId: number, allegiance: string | null): void {
  db.prepare("UPDATE map_tokens SET allegiance = ? WHERE id = ?").run(allegiance, tokenId);
}
