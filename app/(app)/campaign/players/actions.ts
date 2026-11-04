"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireGm } from "@/lib/auth";
import { createUser } from "@/lib/db";
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
  revalidatePath("/users");
}
