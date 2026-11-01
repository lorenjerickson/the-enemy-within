import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import db, { type User, USER_COLUMNS, verifyPassword } from "@/lib/db";

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

export async function currentUser(): Promise<User | undefined> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return undefined;
  return db
    .prepare<[string], User>(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE id = (SELECT user_id FROM sessions WHERE token = ?)`
    )
    .get(token);
}

/** Call at the top of every protected page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");
  return user;
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) db.prepare<[string]>("DELETE FROM sessions WHERE token = ?").run(token);
  jar.delete(COOKIE);
}

export async function requireGm(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "gm") redirect("/");
  return user;
}
