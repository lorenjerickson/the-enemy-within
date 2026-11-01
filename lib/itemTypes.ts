export const ITEM_TYPES = ["consumable", "armor", "weapon", "ingredient", "tool", "utility", "container"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const RARITIES = ["unique", "legendary", "epic", "fine", "common", "ramshackle"] as const;
export type Rarity = (typeof RARITIES)[number];

/** Dice formula like "1d4", "2d6+1" or "d8-1". */
export const DICE_PATTERN = "\\d*d\\d+([+\\-]\\d+)?";
export const isDiceFormula = (s: string) => new RegExp(`^${DICE_PATTERN}$`).test(s);

/** Signed modifier: a dice formula or flat number, e.g. "1d4", "-1d4", "+2", "-2". */
export const MODIFIER_PATTERN = `[+\\-]?(${DICE_PATTERN}|\\d+)`;
export const isModifierFormula = (s: string) => new RegExp(`^${MODIFIER_PATTERN}$`).test(s);

export const EQUIP_SLOTS = [
  "head", "neck", "shoulders", "back", "chest", "arms", "hands", "off hand",
  "main hand", "legs", "feet", "waist", "finger", "container",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
