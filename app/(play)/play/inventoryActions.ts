"use server";

import { revalidatePath } from "next/cache";
import { loggedInUser, requireUser } from "@/lib/auth";
import { listItems, listPlayerCharacters } from "@/lib/db";
import { changeInventory, inEncounter, type InventoryOp } from "@/lib/inventory";

/**
 * Changes what a character carries (stow, equip, move between containers). A player may change their own character's,
 * outside encounters (in one, swapping gear is the Refit action); the GM may change anyone's, any time, and also add
 * items from the catalogue or take them out.
 */
export async function changeCarried(characterId: number, op: InventoryOp): Promise<{ error?: string }> {
  const user = await requireUser();
  const gm = (await loggedInUser())?.role === "gm";
  const id = Number(characterId);
  if (!gm) {
    if (!listPlayerCharacters(user.id).some((c) => c.id === id)) return { error: "That isn't your character" };
    if (op.op === "add" || op.op === "remove") return { error: "Only the GM can do that" };
    if (inEncounter(id)) return { error: "In an encounter, swap gear with Refit (a bonus action)" };
  }
  const error = changeInventory(id, op);
  revalidatePath("/play");
  revalidatePath(`/campaign/characters/${id}`);
  return error ? { error } : {};
}

/** The item catalogue, for the GM adding something to a character's container. */
export async function catalogue(): Promise<{ id: number; name: string }[]> {
  if ((await loggedInUser())?.role !== "gm") return [];
  return listItems().map((i) => ({ id: i.id, name: i.name }));
}
