"use server";

import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { tryGameScript, type ScriptResult } from "@/lib/game";

export async function runScript(source: string): Promise<ScriptResult> {
  await requireGm();
  const result = tryGameScript(source);
  revalidatePath("/campaign/characters");
  return result;
}
