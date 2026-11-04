"use server";

import { requireUser } from "@/lib/auth";
import { getOpenGameSession, markPresent } from "@/lib/db";

/** A player's lobby page checking in, so they show as present. */
export async function checkIn() {
  const user = await requireUser();
  const session = getOpenGameSession();
  if (session && user.role === "player") markPresent(session.id, user.id);
}

/** The open session a player could join, if any (for the join prompt). */
export async function waitingSession(): Promise<{ id: number; number: number; began: boolean } | null> {
  const user = await requireUser();
  const session = getOpenGameSession();
  if (!session || user.role !== "player") return null;
  return { id: session.id, number: session.number, began: !!session.began_at };
}
