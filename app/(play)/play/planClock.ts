import { openImprovisation } from "@/lib/improvise";
import { db, downTokens, getCharacterPlayer, getEncounter, getOpenGameSession, getPendingRound, gmPlayedPlayers, listTokens, logSessionEvent, readyTokens, saveRoundPlan, tokenLabels } from "@/lib/db";

/** How long the last player has to finish planning once everyone else is ready. */
export const PLAN_SECONDS = 30;

// When the countdown started on a level, and for whom (so every screen counts down from the same moment).
db.exec(`CREATE TABLE IF NOT EXISTS plan_clock (
  level_id INTEGER PRIMARY KEY,
  token_id INTEGER NOT NULL,
  started INTEGER NOT NULL
)`);

/**
 * The planning countdown on a level, if it's running: when round planning is waiting on just one token in the turn
 * order and it's a player's character (not one of the GM's, nor a player the GM is playing), that player has
 * PLAN_SECONDS to be ready. Out of time, they go without a plan this round (emptied and marked ready). Worked out
 * whenever anyone looks (every page refresh, and when a screen's countdown reaches 0).
 */
export function planClock(levelId: number): { tokenId: number; endsAt: number } | null {
  const clear = () => { db.prepare("DELETE FROM plan_clock WHERE level_id = ?").run(levelId); return null; };
  const enc = getEncounter(levelId);
  if (!enc || getPendingRound(levelId)) return clear();
  const down = downTokens(levelId), ready = readyTokens(levelId), tokens = listTokens(levelId);
  const unready = enc.order.map((o) => o.token_id).filter((id) => !down.has(id) && tokens.some((t) => t.id === id) && !ready.has(id));
  if (unready.length !== 1) return clear();
  const id = unready[0], t = tokens.find((x) => x.id === id)!;
  const player = t.character_id ? getCharacterPlayer(t.character_id) : null, session = getOpenGameSession();
  if (!player || (session && gmPlayedPlayers(session.id).includes(player))) return clear(); // the GM's (or played by the GM): no clock
  if (openImprovisation(id)) return clear(); // settling an improvisation with the GM: the clock waits (it starts over after)
  let row = db.prepare<[number], { token_id: number; started: number }>("SELECT token_id, started FROM plan_clock WHERE level_id = ?").get(levelId);
  if (!row || row.token_id !== id) {
    row = { token_id: id, started: Date.now() };
    db.prepare("INSERT OR REPLACE INTO plan_clock (level_id, token_id, started) VALUES (?, ?, ?)").run(levelId, id, row.started);
  }
  const endsAt = row.started + PLAN_SECONDS * 1000;
  if (Date.now() < endsAt) return { tokenId: id, endsAt };
  saveRoundPlan(levelId, id, [], true); // out of time: no plan this round
  logSessionEvent(`${tokenLabels(levelId).get(id) ?? "Someone"} ran out of time: no plan this round.`);
  return clear();
}
