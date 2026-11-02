"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { runGameScript } from "@/lib/game";
import { ScriptError } from "@/lib/script";

export type ScriptResult = { ok: true; value: string } | { ok: false; error: string };

export async function runScript(source: string): Promise<ScriptResult> {
  await requireGm();
  try {
    const value = runGameScript(source);
    revalidatePath("/campaign/characters");
    return { ok: true, value: JSON.stringify(value, null, 2) };
  } catch (e) {
    if (e instanceof ScriptError) return { ok: false, error: e.message };
    throw e;
  }
}
