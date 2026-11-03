"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { tryGameScript, type ScriptResult } from "@/lib/game";
import { getGameTime, setGameTime } from "@/lib/db";

export async function runScript(source: string): Promise<ScriptResult> {
  await requireGm();
  const result = tryGameScript(source);
  revalidatePath("/campaign/characters");
  revalidatePath("/session");
  return result;
}

/** Moves game time forward by this many minutes. */
export async function advanceTime(minutes: number) {
  await requireGm();
  setGameTime(getGameTime() + Math.max(0, Number(minutes) || 0));
  revalidatePath("/session");
}
