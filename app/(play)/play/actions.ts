"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getDoor, getOpenGameSession, getPlayerToken, logSessionEvent, setDoorLocked } from "@/lib/db";
import { skillModifiers, type Attributes } from "@/lib/attributes";
import { REACH, distanceToDoor } from "./reach";

export type PickLockResult = { ok: true; roll: number; modifier: number; dc: number; success: boolean } | { ok: false; error: string };

/** A player tries to pick a locked door next to their character: d20 + sleight of hand against the lock's DC. */
export async function pickLock(doorId: number): Promise<PickLockResult> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { ok: false, error: "Only during a session" };
  const me = getPlayerToken(user.id);
  const door = getDoor(Number(doorId));
  if (!me || !door || door.level_id !== me.level_id) return { ok: false, error: "That door isn't here" };
  if (!door.locked) return { ok: false, error: "It isn't locked" };
  if (distanceToDoor({ x: me.col + 0.5, y: me.row + 0.5 }, door) > REACH) return { ok: false, error: "You're too far away" };
  const modifier = skillModifiers(JSON.parse(me.attributes) as Attributes).find((s) => s.skill === "sleight of hand")?.modifier ?? 0;
  const roll = 1 + Math.floor(Math.random() * 20);
  const success = roll + modifier >= door.lock_dc;
  if (success) setDoorLocked(door.id, false);
  const name = door.name ?? `Door ${door.id}`;
  logSessionEvent(`${me.name} ${success ? "picked the lock on" : "failed to pick the lock on"} ${name} (${roll}${modifier >= 0 ? "+" : ""}${modifier} vs DC ${door.lock_dc})`);
  revalidatePath("/play");
  return { ok: true, roll, modifier, dc: door.lock_dc, success };
}
