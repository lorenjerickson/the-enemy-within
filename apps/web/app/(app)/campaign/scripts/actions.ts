"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { checkScript } from "@/lib/script";
import { deleteLibraryScript, saveLibraryScript } from "@/lib/scriptLibrary";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

/** Saves a library script (checked to parse first). */
export async function submitLibraryScript(id: number | null, formData: FormData) {
  await requireGm();
  const source = text(formData, "source");
  const scriptError = checkScript(source);
  if (scriptError) throw new Error(`Script: ${scriptError}`);
  const r = saveLibraryScript(id, { name: text(formData, "name"), description: text(formData, "description"), source });
  if ("error" in r) throw new Error(r.error);
  revalidatePath("/campaign/scripts");
  redirect("/campaign/scripts");
}

export async function removeLibraryScript(id: number) {
  await requireGm();
  deleteLibraryScript(Number(id));
  revalidatePath("/campaign/scripts");
  redirect("/campaign/scripts");
}
