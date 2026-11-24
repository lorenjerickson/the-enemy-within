import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import db, { type User, USER_COLUMNS, verifyPassword } from "@/lib/db";
import { formatActAs, parseActAs, resolveActor, type ActAs } from "@/lib/actor";

const COOKIE = "session";

export async function login(username: string, password: string): Promise<boolean> {
  const row = db
    .prepare<[string], { id: number; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE username = ?"
    )
    .get(username);
  if (!row || !verifyPassword(password, row.password_hash)) return false;

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare<[string, number]>("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, row.id);
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
  return true;
}

/** Who is logged in, whatever they're doing (the GM, even while playing a player). */
export async function loggedInUser(): Promise<User | undefined> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return undefined;
  return db
    .prepare<[string], User>(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE id = (SELECT user_id FROM sessions WHERE token = ?)`
    )
    .get(token);
}

const ACT_AS = "act_as";

/**
 * Who the app is for right now: the logged-in user; or, while the GM acts as someone in the running session, that
 * absent player (playedBy), a present player they're watching (playedBy + watching), or the GM playing a creature
 * token (actingToken). See resolveActor.
 */
export async function currentUser(): Promise<User | undefined> {
  const user = await loggedInUser();
  if (user?.role !== "gm") return user;
  return resolveActor(user, parseActAs((await cookies()).get(ACT_AS)?.value));
}

/** The GM acts as a token (a creature, or a player's character), a player, or (null) goes back to being the GM. */
export async function setActingAs(who: ActAs | null): Promise<void> {
  const jar = await cookies();
  if (who) jar.set(ACT_AS, formatActAs(who), { httpOnly: true, sameSite: "lax", path: "/" });
  else jar.delete(ACT_AS);
}

/** Call at the top of every protected page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Their own first login asks for a new password; the GM playing them isn't asked (it's not theirs to set).
  if (user.must_change_password && !user.playedBy) redirect("/change-password");
  return user;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare<[string]>("DELETE FROM sessions WHERE token = ?").run(token);
  jar.delete(COOKIE);
}

/** The GM (also while they're playing an absent player). */
export async function requireGm(): Promise<User> {
  const user = await loggedInUser();
  if (!user) redirect("/login");
  if (user.role !== "gm") redirect("/");
  return user;
}
