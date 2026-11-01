import { listItems } from "@/lib/db";

/** Items that can go in at least one slot, trimmed for the client form. */
export const equippableItems = () =>
  listItems()
    .filter((i) => i.slots.length > 0)
    .map(({ id, name, slots }) => ({ id, name, slots }));
