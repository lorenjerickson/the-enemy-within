export const ITEM_TYPES = ["consumable", "armor", "weapon", "ingredient", "tool", "utility"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
