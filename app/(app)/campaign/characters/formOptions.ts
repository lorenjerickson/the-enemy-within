import { getProfession, listAdvancements, listItems, listProfessionGroups, startingRanks } from "@/lib/db";
import type { ProfessionOption } from "./RankInput";

/** Items that can go in at least one slot, trimmed for the client form. */
export const equippableItems = () =>
  listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots, defense, hands }) => ({ id, name, slots, defense, hands }));

/** The rank picked on a character form (or none), checked. */
export function chosenRank(formData: FormData): number | null {
  const id = Number(formData.get("rank_id")) || null;
  if (id !== null && !getProfession(id)?.group_id) throw new Error(`Unknown rank ${id}`);
  return id;
}

/** Professions with their ranks in order (each rank after the one it advances from, `depth` steps in), for the picker. */
export const professionOptions = (): ProfessionOption[] =>
  listProfessionGroups().map((g) => {
    const ranks: ProfessionOption["ranks"] = [];
    const walk = (r: { id: number; name: string }, depth: number) => {
      if (ranks.some((x) => x.id === r.id)) return;
      ranks.push({ id: r.id, name: r.name, depth });
      listAdvancements(r.id).forEach((n) => walk(n, depth + 1));
    };
    startingRanks(g.id).forEach((r) => walk(r, 0));
    return { id: g.id, name: g.name, ranks };
  }).filter((g) => g.ranks.length);
