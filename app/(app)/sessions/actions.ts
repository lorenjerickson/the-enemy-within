"use server";

import { revalidatePath } from "next/cache";
import { passTimeForEffects } from "../../(play)/play/workOutRound";
import { redirect } from "next/navigation";
import { requireGm, setActingAs } from "@/lib/auth";
import { cleanAnswers, type ScriptAnswers } from "@/lib/scriptPrompt";
import { fireTriggers, tryGameScript, type ScriptResult } from "@/lib/game";
import { beginGameSession, getOpenGameSession, setSessionMember, deleteTrigger, getGmLevelId, getGameTime, setGameTime } from "@/lib/db";
import { endSession as end, startSession as start } from "@/lib/sessionLog";

/** Runs a console script; `answers` are the GM's choices so far for its select() prompts. */
export async function runScript(source: string, answers: ScriptAnswers = []): Promise<ScriptResult> {
  await requireGm();
  const result = tryGameScript(source, getGmLevelId(), cleanAnswers(answers)); // the console works on the map the GM has loaded (normally the party's)
  revalidatePath("/play");
  revalidatePath("/campaign/characters");
  revalidatePath("/sessions", "layout");
  return result;
}

/** Moves game time forward by this many minutes. */
export async function advanceTime(minutes: number) {
  await requireGm();
  const step = Math.max(0, Number(minutes) || 0);
  setGameTime(getGameTime() + step);
  passTimeForEffects(step); // effects (Poisoned…) tick a round per 6 s out of an encounter
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
  redirect("/play");
}

/** Ends a session; its summary is written from what changed during it. */
export async function endSession(id: number) {
  await requireGm();
  end(Number(id));
  redirect("/sessions");
}

/** The GM adds an absent player to the session to play for them ("gm"), keeps someone out ("removed"), or undoes it. */
export async function setMember(sessionId: number, userId: number, status: "gm" | "removed" | null) {
  await requireGm();
  setSessionMember(Number(sessionId), Number(userId), status === "gm" || status === "removed" ? status : null);
  if (status !== "gm") await setActingAs(null); // no longer theirs to play
  revalidatePath("/sessions");
  revalidatePath("/play");
}

/** The GM plays as an absent player they added (everything as them, until they switch back). */
export async function playAs(playerId: number | null) {
  await requireGm();
  await setActingAs(playerId ? Number(playerId) : null);
  redirect(getOpenGameSession()?.began_at ? "/play" : "/lobby");
}
