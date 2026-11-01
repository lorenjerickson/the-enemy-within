"use server";

import { redirect } from "next/navigation";
import { requireGm } from "@/lib/auth";
import { listLocations, saveLocation } from "@/lib/db";

export async function submitLocation(id: number | null, formData: FormData) {
  await requireGm();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const parent_id = Number(formData.get("parent_id")) || null;
  if (parent_id !== null && !listLocations().some((l) => l.id === parent_id)) throw new Error("Unknown parent location");
  if (parent_id !== null && parent_id === id) throw new Error("A location cannot be inside itself");
  saveLocation(id, { parent_id, name: text("name"), description: text("description") });
  redirect("/campaign/locations");
}
