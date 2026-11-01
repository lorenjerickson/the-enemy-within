export const ROLL_MODES = ["normal", "advantage", "disadvantage"] as const;
export type RollMode = (typeof ROLL_MODES)[number];

/** D&D 5e damage types. */
export const DAMAGE_TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
