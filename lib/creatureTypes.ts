export const CREATURE_TYPES = ["humanoid", "beast", "aquatic", "elemental"] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];
