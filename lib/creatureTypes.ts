import type { Speed } from "@/lib/speed";

export const CREATURE_TYPES = ["humanoid", "beast", "aquatic", "elemental"] as const;
export type CreatureType = (typeof CREATURE_TYPES)[number];

export const MOVEMENT_TYPES = ["walking", "running", "swimming", "climbing", "crawling", "jumping", "flying"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
/** Speed per movement type, as distance over time in its own units (lib/speed.ts). 0 = can't move that way (most can't fly). */
export type Movement = Record<MovementType, Speed>;
