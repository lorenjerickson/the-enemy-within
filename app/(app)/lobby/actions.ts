"use server";

import { requireUser } from "@/lib/auth";
import { getOpenGameSession, markPresent } from "@/lib/db";

/** A player's lobby page checking in, so they show as present. */
export async function checkIn() {
  const user = await requireUser();
  const session = getOpenGameSession();
  if (session && user.role === "player") markPresent(session.id, user.id);
}
