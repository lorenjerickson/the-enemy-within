import { getCreature, listCreatures } from "@/lib/db";

/** The creature every player character is based on: the one named Human. */
export function findHuman() {
  const c = listCreatures().find((x) => x.name.trim().toLowerCase() === "human");
  return c && getCreature(c.id);
}
