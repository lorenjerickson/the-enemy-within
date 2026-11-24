import db, { getOpenGameSession, gmPlayedPlayers, isRemovedFrom, type User, USER_COLUMNS } from "@/lib/db";

/**
 * Who the GM is acting as in the running session (the "act as" cookie): a token ("t12") or a player ("p3"). A token
 * of a player's character means that player; any other token (a creature) is the GM's own to play.
 */
export type ActAs = { token: number } | { player: number };

export const parseActAs = (v: string | undefined): ActAs | null => {
  const m = /^([tp])(\d+)$/.exec(v ?? "");
  return !m ? null : m[1] === "t" ? { token: Number(m[2]) } : { player: Number(m[2]) };
};
export const formatActAs = (a: ActAs): string => ("token" in a ? `t${a.token}` : `p${a.player}`);

/**
 * Who the app is for while the GM acts as someone: an absent player they play (playedBy), a present player they only
 * watch (playedBy + watching: everything that player could do is refused), or the GM themselves playing a creature
 * token (actingToken). Anything that doesn't fit (no session under way, a player left out, a token gone): the GM.
 */
export function resolveActor(gm: User, act: ActAs | null): User {
  const session = getOpenGameSession();
  if (!act || !session?.began_at) return gm;
  let playerId: number | null;
  if ("token" in act) {
    const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(act.token);
    if (!t) return gm;
    playerId = t.character_id === null ? null : db.prepare<[number], { player_id: number | null }>("SELECT player_id FROM characters WHERE id = ?").get(t.character_id)?.player_id ?? null;
    if (playerId === null) return { ...gm, actingToken: act.token }; // a creature (or a character nobody plays): the GM plays it
  } else playerId = act.player;
  const player = db.prepare<[number], User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND role = 'player'`).get(playerId);
  if (!player || isRemovedFrom(session.id, player.id)) return gm;
  return gmPlayedPlayers(session.id).includes(player.id) ? { ...player, playedBy: gm.id } : { ...player, playedBy: gm.id, watching: true };
}
