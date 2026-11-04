"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireGm } from "@/lib/auth";
import { createUser, deletePlayer, updatePlayer } from "@/lib/db";
import { sendMail } from "@/lib/mail";

/** Invites a player: creates their account with a temporary password and emails them how to log in. */
export async function invitePlayer(formData: FormData) {
  await requireGm();
  const field = (k: string) => String(formData.get(k) ?? "").trim();
  const name = field("name");
  const email = field("contact");
  const password = field("password");
  // Players log in with their name as username.
  createUser({ name, username: name, contact: email, role: "player" }, password);

  const h = await headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  await sendMail(
    email,
    "You've been invited to The Enemy Within",
    `Hi ${name},\n\nYou've been added to the game.\n\nLog in at: ${base}/login\nUsername: ${name}\nTemporary password: ${password}\n`
  );
  revalidatePath("/campaign/players");
}

export async function savePlayer(id: number, formData: FormData) {
  await requireGm();
  updatePlayer(id, String(formData.get("name") ?? "").trim(), String(formData.get("contact") ?? "").trim());
  redirect("/campaign/players");
}

/** Removes a player's account; characters they played are kept, with no player. */
export async function removePlayer(id: number) {
  await requireGm();
  deletePlayer(Number(id));
  redirect("/campaign/players");
}
