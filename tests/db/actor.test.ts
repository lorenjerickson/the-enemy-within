import { test } from "node:test";
import assert from "node:assert/strict";
import { character, creature, level } from "./seed";
import { addCreatureToken, beginGameSession, createUser, db, placeCharacterToken, setSessionMember, startGameSession, type User } from "@/lib/db";
import { formatActAs, parseActAs, resolveActor } from "@/lib/actor";

const user = (username: string, role: "player" | "gm") => {
  createUser({ name: username, username, contact: "", role } as never, "pw");
  return db.prepare<[string], User>("SELECT * FROM users WHERE username = ?").get(username)!;
};
const gm = user("actor-gm", "gm"), absent = user("actor-absent", "player"), here = user("actor-here", "player"), out = user("actor-out", "player");
const owned = (name: string, p: User) => { const id = character(name); db.prepare("UPDATE characters SET player_id = ? WHERE id = ?").run(p.id, id); return id; };

test("act-as cookie values round-trip", () => {
  assert.deepEqual(parseActAs(formatActAs({ token: 12 })), { token: 12 });
  assert.deepEqual(parseActAs(formatActAs({ player: 3 })), { player: 3 });
  assert.equal(parseActAs("x9"), null);
  assert.equal(parseActAs(undefined), null);
});

test("the GM acting as a token: an absent player's plays them, a present player's watches, a creature's is the GM's own", () => {
  const lv = level();
  const rat = addCreatureToken(lv, creature("Rat"), 0, 0);
  const a = placeCharacterToken(lv, owned("Rex", absent), 1, 0), h = placeCharacterToken(lv, owned("Betty", here), 2, 0), o = placeCharacterToken(lv, owned("Tully", out), 3, 0);
  assert.equal(resolveActor(gm, { token: rat }), gm, "no session under way: the GM");
  const s = startGameSession("{}");
  beginGameSession(s);
  setSessionMember(s, absent.id, "gm");
  setSessionMember(s, out.id, "removed");
  assert.deepEqual(resolveActor(gm, { token: rat }), { ...gm, actingToken: rat });
  const played = resolveActor(gm, { token: a });
  assert.equal(played.id, absent.id);
  assert.equal(played.playedBy, gm.id);
  assert.equal(played.watching, undefined);
  const watched = resolveActor(gm, { token: h });
  assert.equal(watched.id, here.id);
  assert.equal(watched.watching, true);
  assert.equal(resolveActor(gm, { token: o }), gm, "left out of the session: nobody to act as");
  assert.equal(resolveActor(gm, { player: absent.id }).id, absent.id, "by player (the lobby's Play as)");
  assert.equal(resolveActor(gm, { token: 999999 }), gm, "a token that's gone");
});
