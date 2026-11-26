// The database, by area (lib/db/*): everything re-exported here while callers move to the area modules (backlog U).

import { CREATURE_TYPES, type CreatureType } from "@/lib/creatureTypes";

import { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity } from "@/lib/itemTypes";
import { DATA_DIR, addColumn, db, transaction } from "@/lib/db/connection";
export { DATA_DIR, addColumn, db, transaction };
export default db;
export { CREATURE_TYPES, type CreatureType };
export { EQUIP_SLOTS, ITEM_TYPES, RARITIES, type EquipSlot, type ItemType, type Rarity };
export * from "@/lib/db/calendar";
export * from "@/lib/db/users";
export * from "@/lib/db/sessions";
export * from "@/lib/db/catalog";

export * from "@/lib/db/maps";
export * from "@/lib/db/encounters";
export * from "@/lib/db/tokens";
export * from "@/lib/db/media";
export * from "@/lib/db/mapThings";
export * from "@/lib/db/effects";

export * from "@/lib/db/areas";
export * from "@/lib/db/traps";
export * from "@/lib/db/story";
export * from "@/lib/db/rolls";
export * from "@/lib/db/rounds";
import { runMigrations } from "@/lib/db/migrations";
runMigrations();
