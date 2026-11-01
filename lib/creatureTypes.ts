export const CREATURE_TYPES = ["humanoid", "beast", "aquatic", "elemental"] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const MOVEMENT_TYPES = ["walking", "running", "swimming", "climbing", "crawling", "jumping", "flying"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
/** Maximum range per movement type, in metres. 0 = cannot move that way (e.g. most creatures cannot fly). */
export type Movement = Record<MovementType, number>;
