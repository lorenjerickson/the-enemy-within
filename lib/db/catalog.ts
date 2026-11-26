import type { ItemType, Rarity, EquipSlot } from "@/lib/itemTypes";
import { db } from "@/lib/db/connection";
import { MOVEMENT_TYPES } from "@/lib/creatureTypes";
import type { CreatureType, Movement } from "@/lib/creatureTypes";
import type { Attributes, Attribute } from "@/lib/attributes";
import type { ModifierTarget } from "@/lib/modifiers";
import type { RollMode, DamageType, Boost, RollGrant, DurationUnit } from "@/lib/actions";
import type { AreaShape } from "@/lib/aoe";
import type { TargetWho, TargetCount } from "@/lib/sides";
import { asSpeed } from "@/lib/speed";

export interface Item {
  id: number;
  name: string;
  description: string;
  image: string | null;
  type: ItemType;
  weight: number; // kg
  value: number;
  rarity: Rarity;
  durability: number; // 1-100
  defense: string | null; // dice formula, armor only
  damage: string | null; // dice formula, weapons only
  attack: string | null; // to-hit modifier (dice or flat), weapons only
  max_stack: number | null; // consumables only; 1 = not stackable
  capacity: number | null; // containers only; number of item slots (a stack fills one slot)
  slots: EquipSlot[]; // slots this item can be equipped in; empty = not equippable
  range_ft: number; // weapons: effective range (5 = melee reach)
  hands: 0 | 1 | 2; // held in one hand, both hands, or not held
}

const ITEM_COLUMNS = "id, name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots, range_ft, hands";

type ItemRow = Omit<Item, "slots"> & { slots: string };

const parseItem = (row: ItemRow): Item => ({ ...row, slots: JSON.parse(row.slots) });

export function listItems(): Item[] {
  return db.prepare<[], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY name`).all().map(parseItem);
}

export function getItem(id: number): Item | undefined {
  const row = db.prepare<[number], ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).get(id);
  return row && parseItem(row);
}

/** Inserts when id is null, otherwise updates. */
export function saveItem(id: number | null, item: Omit<Item, "id">): void {
  const params = { ...item, slots: JSON.stringify(item.slots) };
  if (id === null) {
    db.prepare<Omit<ItemRow, "id">>(
      `INSERT INTO items (name, description, image, type, weight, value, rarity, durability, defense, damage, attack, max_stack, capacity, slots, range_ft, hands)
       VALUES (@name, @description, @image, @type, @weight, @value, @rarity, @durability, @defense, @damage, @attack, @max_stack, @capacity, @slots, @range_ft, @hands)`
    ).run(params);
  } else {
    db.prepare<ItemRow>(
      `UPDATE items SET name = @name, description = @description, image = @image, type = @type, weight = @weight,
         value = @value, rarity = @rarity, durability = @durability, defense = @defense, damage = @damage,
         attack = @attack, max_stack = @max_stack, capacity = @capacity, slots = @slots, range_ft = @range_ft, hands = @hands
       WHERE id = @id`
    ).run({ ...params, id });
  }
}

export interface Creature {
  id: number;
  name: string;
  description: string;
  image: string | null; // portrait: an artistic rendering, not a token
  token_overhead: string | null; // map token seen from above
  token_side: string | null; // map token seen side-on (portrait maps)
  height: number; // metres; sizes side-on tokens
  type: CreatureType;
  attributes: Attributes;
  equipment: Equipment;
  health: string; // dice formula rolled for initial health
  movement: Movement;
}

/** Enabled equipment slots; each holds an item id, or null when empty. */
export type Equipment = Partial<Record<EquipSlot, number | null>>;

type CreatureRow = Omit<Creature, "attributes" | "equipment" | "movement"> & {
  attributes: string;
  equipment: string;
  movement: string;
};

const CREATURE_COLUMNS = "id, name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement";

const parseCreature = (row: CreatureRow): Creature => ({
  ...row,
  attributes: JSON.parse(row.attributes),
  equipment: JSON.parse(row.equipment),
  movement: movementOf(JSON.parse(row.movement)),
});

/** Stored movement as speeds (an old plain number: feet per round). */
const movementOf = (raw: Record<string, unknown>): Movement => Object.fromEntries(MOVEMENT_TYPES.map((m) => [m, asSpeed(raw?.[m] ?? 0)])) as Movement;

export function listCreatures(): Creature[] {
  return db.prepare<[], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures ORDER BY name`).all().map(parseCreature);
}

export function getCreature(id: number): Creature | undefined {
  const row = db.prepare<[number], CreatureRow>(`SELECT ${CREATURE_COLUMNS} FROM creatures WHERE id = ?`).get(id);
  return row && parseCreature(row);
}

const toParams = (c: Omit<Creature, "id">) => ({
  ...c,
  attributes: JSON.stringify(c.attributes),
  equipment: JSON.stringify(c.equipment),
  movement: JSON.stringify(c.movement),
});

/** Inserts when id is null, otherwise updates. */
export function saveCreature(id: number | null, c: Omit<Creature, "id">): void {
  const params = toParams(c);
  if (id === null) {
    db.prepare<Omit<CreatureRow, "id">>(
      `INSERT INTO creatures (name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement)
       VALUES (@name, @description, @image, @token_overhead, @token_side, @height, @type, @attributes, @equipment, @health, @movement)`
    ).run(params);
  } else {
    db.prepare<CreatureRow>(
      `UPDATE creatures SET name = @name, description = @description, image = @image, token_overhead = @token_overhead,
         token_side = @token_side, height = @height, type = @type,
         attributes = @attributes, equipment = @equipment, health = @health, movement = @movement WHERE id = @id`
    ).run({ ...params, id });
  }
}

/** A single-instance creature, copied from a creature template. */
export type Character = Creature & { creature_id: number | null; template_name: string | null };

const CHARACTER_SELECT = `SELECT c.id, c.creature_id, t.name AS template_name, c.name, c.description, c.image,
  c.token_overhead, c.token_side, c.height, c.type,
  c.attributes, c.equipment, c.health, c.movement FROM characters c LEFT JOIN creatures t ON t.id = c.creature_id`;

type CharacterRow = CreatureRow & { creature_id: number | null; template_name: string | null };

export function listCharacters(): Character[] {
  return db.prepare<[], CharacterRow>(`${CHARACTER_SELECT} ORDER BY c.name`).all().map((r) => ({ ...r, ...parseCreature(r) }));
}

export function getCharacter(id: number): Character | undefined {
  const row = db.prepare<[number], CharacterRow>(`${CHARACTER_SELECT} WHERE c.id = ?`).get(id);
  return row && { ...row, ...parseCreature(row) };
}

/** Inserts (based on creatureId) when id is null, otherwise updates. Returns the id. */
export function saveCharacter(id: number | null, creatureId: number | null, c: Omit<Creature, "id">): number {
  const params = toParams(c);
  if (id === null) {
    return Number(
      db.prepare<Omit<CreatureRow, "id"> & { creature_id: number | null }>(
        `INSERT INTO characters (creature_id, name, description, image, token_overhead, token_side, height, type, attributes, equipment, health, movement)
         VALUES (@creature_id, @name, @description, @image, @token_overhead, @token_side, @height, @type, @attributes, @equipment, @health, @movement)`
      ).run({ ...params, creature_id: creatureId }).lastInsertRowid
    );
  } else {
    db.prepare<CreatureRow>(
      `UPDATE characters SET name = @name, description = @description, image = @image, token_overhead = @token_overhead,
         token_side = @token_side, height = @height, type = @type,
         attributes = @attributes, equipment = @equipment, health = @health, movement = @movement WHERE id = @id`
    ).run({ ...params, id });
    return id;
  }
}

/** A character's rank (a row of `professions`), or null. */
export function getCharacterRank(characterId: number): number | null {
  return db.prepare<[number], { rank_id: number | null }>("SELECT rank_id FROM characters WHERE id = ?").get(characterId)?.rank_id ?? null;
}

/**
 * The ranks a character holds: their rank and every rank before it in its profession (progression is cumulative:
 * a Private Eye keeps what Beat Cop and Detective gave them), first rank first.
 */
export function listCharacterProfessionIds(characterId: number): number[] {
  const rank = getCharacterRank(characterId);
  return rank === null ? [] : rankChain(rank);
}

export function setCharacterRank(characterId: number, rankId: number | null): void {
  db.prepare<[number | null, number]>("UPDATE characters SET rank_id = ? WHERE id = ?").run(rankId, characterId);
}

/** A rank and the ranks before it (following the first rank that advances to each), first rank first. */
export function rankChain(rankId: number): number[] {
  const chain: number[] = [];
  for (let at: number | undefined = rankId; at !== undefined && !chain.includes(at); ) {
    chain.unshift(at);
    at = db.prepare<[number], { from_id: number }>("SELECT from_id FROM profession_advancements WHERE to_id = ? ORDER BY from_id LIMIT 1").get(at)?.from_id;
  }
  return chain;
}

/**
 * A profession (Law Enforcement, Military): a progression of ranks. Its ranks are the rows of `professions` (Beat
 * Cop → Detective → Private Eye); `Profession` below is one rank.
 */
export interface ProfessionGroup {
  id: number;
  name: string;
  description: string;
}

export function listProfessionGroups(): ProfessionGroup[] {
  return db.prepare<[], ProfessionGroup>("SELECT id, name, description FROM profession_groups ORDER BY name").all();
}

export function getProfessionGroup(id: number): ProfessionGroup | undefined {
  return db.prepare<[number], ProfessionGroup>("SELECT id, name, description FROM profession_groups WHERE id = ?").get(id);
}

/** Inserts when id is null, otherwise updates. Returns the id. */
export function saveProfessionGroup(id: number | null, g: Omit<ProfessionGroup, "id">): number {
  if (id === null) return Number(db.prepare<Omit<ProfessionGroup, "id">>("INSERT INTO profession_groups (name, description) VALUES (@name, @description)").run(g).lastInsertRowid);
  db.prepare<ProfessionGroup>("UPDATE profession_groups SET name = @name, description = @description WHERE id = @id").run({ ...g, id });
  return id;
}

/** A rank within a profession. */
export interface Profession {
  id: number;
  name: string;
  description: string;
  group_id: number | null; // its profession (ProfessionGroup)
}

export function listProfessions(): Profession[] {
  return db.prepare<[], Profession>("SELECT id, name, description, group_id FROM professions ORDER BY name").all();
}

/** A profession's ranks. */
export function listRanks(groupId: number): Profession[] {
  return db.prepare<[number], Profession>("SELECT id, name, description, group_id FROM professions WHERE group_id = ? ORDER BY name").all(groupId);
}

/** A profession's first ranks: those no other rank advances to (usually one: the starting rank). */
export function startingRanks(groupId: number): Profession[] {
  return listRanks(groupId).filter((r) => !db.prepare<[number], { n: number }>("SELECT 1 AS n FROM profession_advancements WHERE to_id = ?").get(r.id));
}

export function getProfession(id: number): Profession | undefined {
  return db.prepare<[number], Profession>("SELECT id, name, description, group_id FROM professions WHERE id = ?").get(id);
}

/** Inserts when id is null, otherwise updates (its profession stays). Returns the id. */
export function saveProfession(id: number | null, p: Omit<Profession, "id">): number {
  if (id === null) {
    return Number(db.prepare<Omit<Profession, "id">>("INSERT INTO professions (name, description, group_id) VALUES (@name, @description, @group_id)").run(p).lastInsertRowid);
  }
  db.prepare<Omit<Profession, "group_id">>("UPDATE professions SET name = @name, description = @description WHERE id = @id").run({ name: p.name, description: p.description, id });
  return id;
}

/** Professions this one advances to (its next-level advancements). */
export function listAdvancements(professionId: number): Profession[] {
  return db
    .prepare<[number], Profession>(
      `SELECT p.id, p.name, p.description, p.group_id FROM profession_advancements a
       JOIN professions p ON p.id = a.to_id WHERE a.from_id = ? ORDER BY p.name`
    )
    .all(professionId);
}

/** Professions that advance to this one. */
export function listPrerequisites(professionId: number): Profession[] {
  return db
    .prepare<[number], Profession>(
      `SELECT p.id, p.name, p.description, p.group_id FROM profession_advancements a
       JOIN professions p ON p.id = a.from_id WHERE a.to_id = ? ORDER BY p.name`
    )
    .all(professionId);
}

/** The ranks a rank leads to, at any depth (not itself). */
export function laterRanks(rankId: number): number[] {
  const out: number[] = [], todo = [rankId];
  while (todo.length) {
    const at = todo.pop()!;
    for (const { to_id } of db.prepare<[number], { to_id: number }>("SELECT to_id FROM profession_advancements WHERE from_id = ?").all(at))
      if (to_id !== rankId && !out.includes(to_id)) { out.push(to_id); todo.push(to_id); }
  }
  return out;
}

/** Characters at a rank. */
export const charactersAtRank = (rankId: number) => db.prepare<[number], { id: number; name: string }>("SELECT id, name FROM characters WHERE rank_id = ? ORDER BY name").all(rankId);

/**
 * Moves a rank (and the ranks it leads to) to come after `parentId`, or to be a starting rank of profession
 * `groupId`. Moved to another profession, the ranks it leads to go with it (and lose links from ranks left behind).
 */
export function moveRank(rankId: number, parentId: number | null, groupId: number): void {
  db.transaction(() => {
    const moving = [rankId, ...laterRanks(rankId)];
    if (parentId !== null && moving.includes(parentId)) throw new Error("A rank can't come after itself or a rank it leads to");
    db.prepare("DELETE FROM profession_advancements WHERE to_id = ?").run(rankId);
    if (getProfession(rankId)?.group_id !== groupId) {
      const marks = moving.map(() => "?").join(", ");
      db.prepare(`DELETE FROM profession_advancements WHERE to_id IN (${marks}) AND from_id NOT IN (${marks})`).run(...moving, ...moving);
      db.prepare(`UPDATE professions SET group_id = ? WHERE id IN (${marks})`).run(groupId, ...moving);
    }
    if (parentId !== null) linkAdvancement(parentId, rankId);
  })();
}

/**
 * Removes a rank: the ranks it led to come after the rank before it instead (or become starting ranks), characters
 * at it drop back to the rank before it (or have no profession), and what it gave (modifiers, items, actions) goes.
 */
export function deleteRank(rankId: number): void {
  db.transaction(() => {
    const chain = rankChain(rankId), parent = chain.length > 1 ? chain[chain.length - 2] : null;
    const next = db.prepare<[number], { to_id: number }>("SELECT to_id FROM profession_advancements WHERE from_id = ?").all(rankId).map((r) => r.to_id);
    db.prepare("DELETE FROM profession_advancements WHERE from_id = ? OR to_id = ?").run(rankId, rankId);
    if (parent !== null) for (const n of next) linkAdvancement(parent, n);
    db.prepare("UPDATE characters SET rank_id = ? WHERE rank_id = ?").run(parent, rankId);
    db.prepare("DELETE FROM profession_modifiers WHERE profession_id = ?").run(rankId);
    db.prepare("DELETE FROM profession_items WHERE profession_id = ?").run(rankId);
    db.prepare("DELETE FROM actions WHERE profession_id = ?").run(rankId);
    db.prepare("DELETE FROM character_professions WHERE profession_id = ?").run(rankId); // the old ticked professions (before ranks)
    db.prepare("DELETE FROM professions WHERE id = ?").run(rankId);
  })();
}

/** Removes a profession with no ranks left. */
export function deleteProfessionGroup(groupId: number): void {
  if (listRanks(groupId).length) throw new Error("Remove its ranks first");
  db.prepare("DELETE FROM profession_groups WHERE id = ?").run(groupId);
}

export function linkAdvancement(fromId: number, toId: number): void {
  if (fromId === toId) return;
  db.prepare<[number, number]>("INSERT OR IGNORE INTO profession_advancements (from_id, to_id) VALUES (?, ?)").run(fromId, toId);
}

export function unlinkAdvancement(fromId: number, toId: number): void {
  db.prepare<[number, number]>("DELETE FROM profession_advancements WHERE from_id = ? AND to_id = ?").run(fromId, toId);
}

export interface ProfessionModifier {
  id: number;
  profession_id: number;
  target: ModifierTarget;
  value: string;
}

export function listProfessionModifiers(professionId: number): ProfessionModifier[] {
  return db
    .prepare<[number], ProfessionModifier>("SELECT id, profession_id, target, value FROM profession_modifiers WHERE profession_id = ? ORDER BY id")
    .all(professionId);
}

export function addProfessionModifier(m: Omit<ProfessionModifier, "id">): void {
  db.prepare<Omit<ProfessionModifier, "id">>(
    "INSERT INTO profession_modifiers (profession_id, target, value) VALUES (@profession_id, @target, @value)"
  ).run(m);
}

export function removeProfessionModifier(id: number): void {
  db.prepare<[number]>("DELETE FROM profession_modifiers WHERE id = ?").run(id);
}

/** Items handed to whoever takes this profession. */
export function listProfessionItems(professionId: number): Item[] {
  return db
    .prepare<[number], ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM items WHERE id IN (SELECT item_id FROM profession_items WHERE profession_id = ?) ORDER BY name`
    )
    .all(professionId)
    .map(parseItem);
}

export function grantItem(professionId: number, itemId: number): void {
  db.prepare<[number, number]>("INSERT OR IGNORE INTO profession_items (profession_id, item_id) VALUES (?, ?)").run(professionId, itemId);
}

export function revokeItem(professionId: number, itemId: number): void {
  db.prepare<[number, number]>("DELETE FROM profession_items WHERE profession_id = ? AND item_id = ?").run(professionId, itemId);
}

export type ActionOwnerColumn = "profession_id" | "item_id" | "creature_id";

/** Who grants an action: exactly one of { profession_id }, { item_id } or { creature_id }. */
export type ActionOwner = { [K in ActionOwnerColumn]: Record<K, number> }[ActionOwnerColumn];

export const ownerOf = (owner: ActionOwner) => Object.entries(owner)[0] as [ActionOwnerColumn, number];

/** A declared intent granted by a profession, item or creature, with its own roll bonuses/penalties. */
export interface Action extends Record<ActionOwnerColumn, number | null> {
  id: number;
  name: string;
  description: string;
  roll: RollMode;
  attack: string | null;
  damage: string | null;
  damage_type: DamageType | "";
  radius: number;
  split: 0 | 1;
  boosts: Boost[];
  roll_grants: RollGrant[];
  duration_amount: number;
  duration_unit: DurationUnit;
  seconds: number; // time it takes in a combat round
  range_ft: number; // how far away its target may be (5 = within reach)
  area_shape: AreaShape | ""; // an area attack (everyone caught rolls a save); '' = single target
  area_ft: number;
  save_dc: number;
  save_attr: Attribute;
  save_half: 0 | 1;
  area_lasts: 0 | 1; // the area stays on the map for the action's duration
  area_at?: "" | "self"; // a circle: aimed at a spot within range (''), or where its user stands
  area_fires: string; // when a lasting area catches someone: "enter", "start", "end", comma-separated
  target_who: TargetWho; // only friendlies / enemies ("" = anyone)
  target_count: TargetCount; // one, exactly N, up to N, or all
  target_n: number;
  targets: ActionTargets; // who it can be used on ('' = worked out: damage or effects on a target → others, else self)
  conditions: { id: number; on: "self" | "target" }[]; // catalog effects it puts on its user / its target (on a hit, or a failed save); the column kept its old name
  kind?: "action" | "bonus" | "reaction" | "free"; // a reaction is planned as the round's reaction and only affects its user: it readies conditions whose triggers do the reacting
}

/** Who an action can be used on: only its user, anyone but its user, or either; '' = worked out from what it does. */
export type ActionTargets = "" | "self" | "others" | "anyone";

export const ACTION_TARGETS = ["", "self", "others", "anyone"] as const;

type ActionFields = Omit<Action, "id" | ActionOwnerColumn>;

type ActionRow = Omit<Action, "boosts" | "roll_grants" | "conditions"> & { boosts: string; roll_grants: string; conditions: string };

const ACTION_COLUMNS =
  "id, profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split, boosts, roll_grants, duration_amount, duration_unit, seconds, range_ft, area_shape, area_ft, save_dc, save_attr, save_half, area_lasts, area_at, area_fires, targets, target_who, target_count, target_n, conditions, kind";

export function listActions(owner: ActionOwner): Action[] {
  const [column, id] = ownerOf(owner);
  return db
    .prepare<[number], ActionRow>(`SELECT ${ACTION_COLUMNS} FROM actions WHERE ${column} = ? ORDER BY name`)
    .all(id)
    .map((r) => ({ ...r, boosts: JSON.parse(r.boosts), roll_grants: JSON.parse(r.roll_grants), conditions: JSON.parse(r.conditions) }));
}

/** Inserts when id is null, otherwise updates. */
export function saveAction(id: number | null, owner: ActionOwner, a: ActionFields): void {
  const params = { ...a, kind: a.kind ?? "action", area_at: a.area_at ?? "", area_fires: a.area_fires ?? "end", boosts: JSON.stringify(a.boosts), roll_grants: JSON.stringify(a.roll_grants), conditions: JSON.stringify(a.conditions) };
  if (id === null) {
    db.prepare<Omit<ActionRow, "id">>(
      `INSERT INTO actions (profession_id, item_id, creature_id, name, description, roll, attack, damage, damage_type, radius, split,
         boosts, roll_grants, duration_amount, duration_unit, seconds, range_ft, area_shape, area_ft, save_dc, save_attr, save_half, area_lasts, area_at, area_fires, targets, target_who, target_count, target_n, conditions, kind)
       VALUES (@profession_id, @item_id, @creature_id, @name, @description, @roll, @attack, @damage, @damage_type, @radius, @split,
         @boosts, @roll_grants, @duration_amount, @duration_unit, @seconds, @range_ft, @area_shape, @area_ft, @save_dc, @save_attr, @save_half, @area_lasts, @area_at, @area_fires, @targets, @target_who, @target_count, @target_n, @conditions, @kind)`
    ).run({ profession_id: null, item_id: null, creature_id: null, ...owner, ...params });
  } else {
    db.prepare<Omit<ActionRow, ActionOwnerColumn>>(
      `UPDATE actions SET name = @name, description = @description, roll = @roll, attack = @attack,
         damage = @damage, damage_type = @damage_type, radius = @radius, split = @split,
         boosts = @boosts, roll_grants = @roll_grants, duration_amount = @duration_amount, duration_unit = @duration_unit,
         seconds = @seconds, range_ft = @range_ft, area_shape = @area_shape, area_ft = @area_ft, save_dc = @save_dc,
         save_attr = @save_attr, save_half = @save_half, area_lasts = @area_lasts, area_at = @area_at, area_fires = @area_fires, targets = @targets, target_who = @target_who, target_count = @target_count, target_n = @target_n, conditions = @conditions, kind = @kind WHERE id = @id`
    ).run({ ...params, id });
  }
}

export function removeAction(id: number): void {
  db.prepare<[number]>("DELETE FROM actions WHERE id = ?").run(id);
}

export interface ContainerStack {
  id: number;
  item: Item;
  qty: number;
}

/** Equipped containers and their contents: one entry per container worn (a container item with a capacity). */
export function characterContainers(characterId: number): { slot: EquipSlot; container: Item; stacks: ContainerStack[] }[] {
  const c = getCharacter(characterId);
  if (!c) return [];
  const rows = db.prepare<[number], { id: number; container_id: number; item_id: number; qty: number }>("SELECT id, container_id, item_id, qty FROM container_items WHERE character_id = ? ORDER BY id").all(characterId);
  return (Object.entries(c.equipment ?? {}) as [EquipSlot, number | null][]).flatMap(([slot, id]) => {
    const container = id ? getItem(id) : undefined;
    if (!container || !container.capacity) return [];
    const stacks = rows.filter((r) => r.container_id === container.id).flatMap((r) => {
      const item = getItem(r.item_id);
      return item ? [{ id: r.id, item, qty: r.qty }] : [];
    });
    return [{ slot, container, stacks }];
  });
}

/** Puts items in a container: onto a stack of the same item with room first, then into free slots. Returns how many didn't fit. */
export function addToContainer(characterId: number, containerId: number, itemId: number, qty: number): number {
  const container = getItem(containerId), item = getItem(itemId);
  if (!container?.capacity || !item || item.id === containerId) return qty;
  const max = Math.max(1, item.max_stack ?? 1);
  return db.transaction(() => {
    let left = qty;
    const stacks = db.prepare<[number, number], { id: number; item_id: number; qty: number }>("SELECT id, item_id, qty FROM container_items WHERE character_id = ? AND container_id = ?").all(characterId, containerId);
    for (const s of stacks) {
      if (s.item_id !== itemId || s.qty >= max || left <= 0) continue;
      const put = Math.min(left, max - s.qty);
      db.prepare("UPDATE container_items SET qty = qty + ? WHERE id = ?").run(put, s.id);
      left -= put;
    }
    let free = container.capacity! - stacks.length;
    while (left > 0 && free > 0) {
      const put = Math.min(left, max);
      db.prepare("INSERT INTO container_items (character_id, container_id, item_id, qty) VALUES (?, ?, ?, ?)").run(characterId, containerId, itemId, put);
      left -= put;
      free--;
    }
    return left;
  })();
}

/** Takes up to `qty` off a stack (the stack goes when it's empty). */
export function takeFromStack(stackId: number, qty = 1): void {
  db.transaction(() => {
    db.prepare("UPDATE container_items SET qty = qty - ? WHERE id = ?").run(qty, stackId);
    db.prepare("DELETE FROM container_items WHERE id = ? AND qty <= 0").run(stackId);
  })();
}

/** Takes one of an item out of whichever of their worn containers has it; the container it came from, or null. */
export function takeCarried(characterId: number, itemId: number): number | null {
  for (const c of characterContainers(characterId)) {
    const s = c.stacks.find((x) => x.item.id === itemId);
    if (s) {
      takeFromStack(s.id);
      return c.container.id;
    }
  }
  return null;
}
