import { db } from "@/lib/db/connection";
import { getGameTime } from "@/lib/db/calendar";

export interface GameSession {
  id: number;
  number: number; // 1 for the first session
  started_at: string;
  game_time: number;
  began_at: string | null; // null while it's in its lobby
  ended_at: string | null; // null while it's running
  start_state: string | null;
  summary: string | null;
}

/** Sessions, most recent first. */
export function listGameSessions(): GameSession[] {
  return db
    .prepare<[], GameSession>(
      "SELECT id, started_at, game_time, began_at, ended_at, start_state, summary, ROW_NUMBER() OVER (ORDER BY id) AS number FROM game_sessions ORDER BY id DESC"
    )
    .all();
}

/** The session being played, if one is running. */
export function getOpenGameSession(): GameSession | undefined {
  return listGameSessions().find((s) => !s.ended_at);
}

/** The GM begins play: the lobby closes. */
export function beginGameSession(id: number): void {
  db.prepare<[string, number]>("UPDATE game_sessions SET began_at = COALESCE(began_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
}

/** A player's page checking in: they're present. */
export function markPresent(sessionId: number, userId: number): void {
  db.prepare<[number, number, number]>(
    "INSERT INTO session_presence (session_id, user_id, last_seen) VALUES (?, ?, ?) ON CONFLICT (session_id, user_id) DO UPDATE SET last_seen = excluded.last_seen"
  ).run(sessionId, userId, Date.now());
}

/** How long after a player's last check-in they still count as present. */
export const PRESENCE_MS = 15_000;

/** The players present in a session now (their pages checked in recently), not counting anyone the GM removed. */
export function listPresentPlayers(sessionId: number): number[] {
  const removed = new Set(sessionMembers(sessionId).filter((m) => m.status === "removed").map((m) => m.user_id));
  return db
    .prepare<[number, number], { user_id: number }>("SELECT user_id FROM session_presence WHERE session_id = ? AND last_seen > ?")
    .all(sessionId, Date.now() - PRESENCE_MS)
    .map((r) => r.user_id)
    .filter((id) => !removed.has(id));
}

export function sessionMembers(sessionId: number): { user_id: number; status: "gm" | "removed" }[] {
  return db.prepare<[number], { user_id: number; status: "gm" | "removed" }>("SELECT user_id, status FROM session_members WHERE session_id = ?").all(sessionId);
}

/** The GM adds a player to the session to play for them ("gm"), keeps one out ("removed"), or undoes either (null). */
export function setSessionMember(sessionId: number, userId: number, status: "gm" | "removed" | null): void {
  if (status === null) db.prepare<[number, number]>("DELETE FROM session_members WHERE session_id = ? AND user_id = ?").run(sessionId, userId);
  else db.prepare("INSERT INTO session_members (session_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT (session_id, user_id) DO UPDATE SET status = excluded.status").run(sessionId, userId, status);
}

/** Players the GM plays in this session (added while absent). */
export function gmPlayedPlayers(sessionId: number): number[] {
  return sessionMembers(sessionId).filter((m) => m.status === "gm").map((m) => m.user_id);
}

/** Whether the GM took this player out of the session. */
export const isRemovedFrom = (sessionId: number, userId: number) => sessionMembers(sessionId).some((m) => m.user_id === userId && m.status === "removed");

export function endGameSession(id: number, summary: string): void {
  db.prepare<[string, string, number]>("UPDATE game_sessions SET ended_at = ?, summary = ? WHERE id = ?").run(new Date().toISOString(), summary, id);
}

/** Notes something that happened in the running session, if there is one. */
export function logSessionEvent(text: string): void {
  const open = db.prepare<[], { id: number }>("SELECT id FROM game_sessions WHERE ended_at IS NULL ORDER BY id DESC").get();
  if (open) db.prepare<[number, number, string]>("INSERT INTO session_events (session_id, game_time, text) VALUES (?, ?, ?)").run(open.id, getGameTime(), text);
}

export function listSessionEvents(sessionId: number): { game_time: number; text: string }[] {
  return db.prepare<[number], { game_time: number; text: string }>("SELECT game_time, text FROM session_events WHERE session_id = ? ORDER BY id").all(sessionId);
}

export function getGameSession(id: number): GameSession | undefined {
  return listGameSessions().find((s) => s.id === id);
}

/** Starts a session now, at the current game time, with a snapshot of the game state. Returns its id. */
export function startGameSession(startState: string): number {
  return Number(
    db.prepare<[string, number, string]>("INSERT INTO game_sessions (started_at, game_time, start_state) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), getGameTime(), startState).lastInsertRowid
  );
}
