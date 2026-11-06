import { listItems, listProfessionGraph } from "@/lib/db";

/** Items that can go in at least one slot, trimmed for the client form. */
export const equippableItems = () =>
  listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots, defense, hands }) => ({ id, name, slots, defense, hands }));

/** The professions ticked on a character form, checked: each needs one of its prerequisites ticked too. */
export function chosenProfessions(formData: FormData): number[] {
  const chosen = new Set(formData.getAll("profession").map(Number));
  const graph = new Map(listProfessionGraph().map((p) => [p.id, p]));
  for (const pid of chosen) {
    const p = graph.get(pid);
    if (!p) throw new Error(`Unknown profession ${pid}`);
    if (p.prerequisites.length > 0 && !p.prerequisites.some((pre) => chosen.has(pre))) {
      throw new Error(`${p.name} needs one of its prerequisites`);
    }
  }
  return [...chosen];
}

/** Profession graph trimmed for the client picker. */
export const professionNodes = () => listProfessionGraph().map(({ id, name, prerequisites }) => ({ id, name, prerequisites }));
