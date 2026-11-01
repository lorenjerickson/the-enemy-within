export const ITEM_TYPES = ["consumable", "armor", "weapon", "ingredient", "tool", "utility"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const RARITIES = ["unique", "legendary", "epic", "fine", "common", "ramshackle"] as const;
export type Rarity = (typeof RARITIES)[number];
