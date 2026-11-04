"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { fireTriggers, tryGameScript, type ScriptResult } from "@/lib/game";
import { beginGameSession, deleteTrigger, getGameTime, setGameTime } from "@/lib/db";
import { endSession as end, startSession as start } from "@/lib/sessionLog";

export async function runScript(source: string): Promise<ScriptResult> {
  await requireGm();
  const result = tryGameScript(source);
  revalidatePath("/campaign/characters");
  revalidatePath("/sessions", "layout");
  return result;
}

/** Moves game time forward by this many minutes. */
export async function advanceTime(minutes: number) {
  await requireGm();
  setGameTime(getGameTime() + Math.max(0, Number(minutes) || 0));
  fireTriggers(); // e.g. ON timer.expired
  revalidatePath("/", "layout");
}

/** Cancels a waiting trigger, or clears one from the list. */
export async function removeTrigger(id: number) {
  await requireGm();
  deleteTrigger(Number(id));
  revalidatePath("/sessions", "layout");
}

/** Starts a new session (ending the running one) and opens it. */
export async function startSession() {
  await requireGm();
  const id = start();
  redirect(`/sessions/${id}`);
}

/** The GM begins play: the lobby closes. */
export async function beginSession(id: number) {
  await requireGm();
  beginGameSession(Number(id));
  revalidatePath(`/sessions/${id}`);
}

/** Ends a session; its summary is written from what changed during it. */
export async function endSession(id: number) {
  await requireGm();
  end(Number(id));
  redirect("/sessions");
}
