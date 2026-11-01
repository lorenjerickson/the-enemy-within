import { listItems, listProfessionGraph } from "@/lib/db";

/** Items that can go in at least one slot, trimmed for the client form. */
export const equippableItems = () =>
  listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots, defense }) => ({ id, name, slots, defense }));

/** Profession graph trimmed for the client picker. */
export const professionNodes = () => listProfessionGraph().map(({ id, name, prerequisites }) => ({ id, name, prerequisites }));
