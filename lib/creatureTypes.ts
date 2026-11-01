export const CREATURE_TYPES = ["humanoid", "beast", "aquatic", "elemental"] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const MOVEMENT_TYPES = ["walking", "running", "swimming", "climbing", "crawling", "jumping"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
/** Maximum range per movement type, in metres. */
export type Movement = Record<MovementType, number>;
