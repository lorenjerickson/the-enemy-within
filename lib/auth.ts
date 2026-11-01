import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import db, { type User, verifyPassword } from "@/lib/db";

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
      `SELECT u.id, u.name, u.username, u.contact, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
}

/** Call at the top of every protected page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
