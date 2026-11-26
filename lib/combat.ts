import { addToContainer, characterContainers, listCharacterProfessionIds, getCharacter, getCreature, getItem, listActions, listItems, listTokens, takeCarried, takeFromStack, listTokenStatuses, listAfflictions, getCondition, saveCharacter, db, type Creature, type Equipment } from "@/lib/db";
import type { EquipSlot } from "@/lib/itemTypes";
import { allegianceOf } from "@/lib/sides";
import { type Status } from "@/lib/status";

import { saveTokenHealth, takeDamage, tokenHealth } from "@/lib/health";
import type { GearAction, PlanStep, Put, Refit } from "@/lib/roundPlan";

import { rollChanges, sensesFrom, type Condition } from "@/lib/conditions";
import { strainStatus } from "@/lib/creatureChanges";
import { effectiveMaxHp, extrasOn, professionStatuses, resistancesOf, restrictionsOn, standingEffects, standingStatuses } from "@/lib/creatureChanges";
import type { AuraModifier } from "@/lib/auras";
import { gearOf, lookOf } from "@/lib/actionCard";
import { fighterOf as fighterWith, type Fighter } from "@/lib/fighter";
export type { AttackRoll, Fighter } from "@/lib/fighter";
/** A fighter whose gear is read from the catalog. */
const fighterOf = (who: Pick<Creature, "attributes" | "equipment">, hp: number, statuses: Status[] = []) => fighterWith(who, hp, statuses, getItem);
export { lookOf };

/** Fighters for every token on a level; their hp is current plus temporary health (temporary goes first). */
export function fightersOn(levelId: number): Map<number, Fighter> {
  const out = new Map<number, Fighter>();
  const statuses = listTokenStatuses(levelId), afflictions = listAfflictions(levelId);
  for (const t of listTokens(levelId)) {
    const c = tokenWho(t.id);
    const h = c && tokenHealth(t.id);
    // Conditions on them (Poisoned…) count as statuses for their rolls while they last.
    const fromEffects = (afflictions.get(t.id) ?? []).map((a) => conditionStatus(a.condition));
    // Professions' modifiers are always on (attack, damage, defense, attributes).
    // So are what they have on: standing effects of their creature and their equipment, and how they take damage.
    if (!c || !h) continue;
    const maxHp = effectiveMaxHp(t.id, h.maximum); // professions' and conditions' changes to it
    const f: Fighter = { ...fighterOf(c, Math.min(h.current, maxHp) + h.temporary, [...(statuses.get(t.id) ?? []), ...fromEffects, ...standingStatuses(t.id), ...professionStatuses(t.character_id), ...[strainStatus(t.id)].filter((s): s is Status => !!s)]), maxHp, allegiance: allegianceOf(t), resist: resistancesOf(t.id, levelId), extras: extrasOn(t.id, levelId), limits: restrictionsOn(t.id, levelId), auras: standingEffects(t.id).flatMap((e) => e.modifiers).filter((m): m is AuraModifier => m.kind === "aura"), triggers: standingEffects(t.id).flatMap((e) => e.modifiers.flatMap((mod) => (mod.kind === "trigger" ? [{ mod, name: e.name }] : []))), senses: sensesFrom(standingEffects(t.id).flatMap((e) => e.modifiers)), senseMods: standingEffects(t.id).flatMap((e) => e.modifiers).filter((m) => m.kind === "sense" || m.kind === "cap") };
    // Saves they fail outright (Stunned: Might and Agility), checked when rolled (a condition put on mid-round counts too).
    const roll = f.save;
    f.save = (attr) => (f.limits?.autofail.includes(attr) ? { total: -99, text: "fails automatically" } : roll(attr));
    out.set(t.id, f);
  }
  return out;
}

/** What a condition's effects do to rolls while it lasts, as a status. */
export const conditionStatus = (c: Condition): Status => ({ source: c.name, ...rollChanges(c) });

/** Saves a token's health after a round: the drop from current + temporary comes off temporary first. */
export function saveHp(tokenId: number, hp: number): void {
  const h = tokenHealth(tokenId);
  if (h) saveTokenHealth(tokenId, takeDamage(h, h.current + h.temporary - Math.round(hp)));
}

/** How far a token's plain Attack reaches, in squares: its main-hand weapon's range (1 = within reach). */
export function attackRange(tokenId: number, equipment?: Equipment): number {
  const main = (equipment ?? tokenWho(tokenId)?.equipment)?.["main hand"];
  const weapon = main ? getItem(main) : undefined;
  return Math.max(1, Math.round((weapon?.range_ft ?? 5) / 5));
}

/** Who a token is (its character or creature), wearing its own equipment: a creature token's refits stay with it. */
export function tokenWho(tokenId: number) {
  const t = db.prepare<[number], { character_id: number | null; creature_id: number | null; equipment: string | null }>("SELECT character_id, creature_id, equipment FROM map_tokens WHERE id = ?").get(tokenId);
  if (t?.character_id) return getCharacter(t.character_id);
  const c = t?.creature_id ? getCreature(t.creature_id) : undefined;
  return c && t?.equipment ? { ...c, equipment: JSON.parse(t.equipment) as Equipment } : c;
}

const HANDS: EquipSlot[] = ["main hand", "off hand"];

/**
 * What a token could refit into each of its slots: what a character carries in their worn containers that fits and
 * isn't worn already; the GM's creatures (no containers) can pick anything from the item list.
 */
export function refitOptions(tokenId: number, equipment: Equipment) {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return [];
  const carried = t.character_id ? characterContainers(t.character_id).flatMap((c) => c.stacks.map((s) => s.item)) : listItems();
  const worn = new Set(Object.values(equipment).filter(Boolean));
  return (Object.keys(equipment) as EquipSlot[]).filter((slot) => slot !== "container").flatMap((slot) => {
    const current = equipment[slot] ? getItem(equipment[slot]!) : undefined;
    const other = HANDS.includes(slot) ? HANDS.find((h) => h !== slot)! : undefined;
    const otherItem = other && equipment[other] ? getItem(equipment[other]!) : undefined;
    if (otherItem?.hands === 2) return []; // held in both hands: refit that one instead
    const items = carried.filter((i, n) => carried.findIndex((j) => j.id === i.id) === n && i.slots.includes(slot) && !worn.has(i.id));
    return items.length ? [{ slot, current: current ? { id: current.id, name: current.name } : null, items: items.map((i) => ({ id: i.id, name: i.name, hands: i.hands })) }] : [];
  });
}

/** What Refit could put away (stow): something equipped, into a worn container with room; or something in a pack, onto the belt. */
export type PutOptions = {
  away: { slot: EquipSlot; item: { id: number; name: string }; into: { id: number; name: string; belt: boolean }[] }[];
  belt: { id: number; name: string } | null;
  fromPacks: { item: { id: number; name: string }; from: { id: number; name: string }; room: boolean }[];
};

/**
 * What Refit could put away, as the plan so far leaves things (its earlier puts take room, and take things out of
 * packs). Only characters have containers.
 */
export function putOptions(tokenId: number, equipment: Equipment, plan: PlanStep[]): PutOptions {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t?.character_id) return { away: [], belt: null, fromPacks: [] };
  const wornIds = new Set(Object.values(equipment).filter(Boolean));
  const containers = characterContainers(t.character_id).filter((c) => wornIds.has(c.container.id)); // still worn by then
  const puts = plan.flatMap((s) => (s.kind === "action" && s.put ? [s.put] : []));
  // Room for one more of an item: a free slot (each put so far takes one), or a stack of it with room.
  const room = (c: (typeof containers)[number], itemId: number, maxStack: number) => {
    const into = puts.filter((p) => p.into.id === c.container.id);
    return c.stacks.length + into.length < (c.container.capacity ?? 0) || c.stacks.some((s) => s.item.id === itemId && s.qty + into.filter((p) => p.item.id === itemId).length < Math.max(1, maxStack));
  };
  const away = (Object.entries(equipment) as [EquipSlot, number | null][]).flatMap(([slot, id]) => {
    const item = id ? getItem(id) : undefined;
    if (!item || slot === "container" || item.capacity) return []; // a container stays worn (empty it first, out of a round)
    const into = containers.filter((c) => c.container.id !== item.id && room(c, item.id, item.max_stack ?? 1)).map((c) => ({ id: c.container.id, name: c.container.name, belt: c.slot === "waist" }));
    return [{ slot, item: { id: item.id, name: item.name }, into }];
  });
  const beltC = containers.find((c) => c.slot === "waist");
  const fromPacks = beltC
    ? containers.filter((c) => c.slot !== "waist").flatMap((c) => {
        const seen = new Set<number>();
        return c.stacks.flatMap((s) => {
          if (seen.has(s.item.id)) return [];
          seen.add(s.item.id);
          const have = c.stacks.filter((x) => x.item.id === s.item.id).reduce((n, x) => n + x.qty, 0);
          const moved = puts.filter((p) => p.from?.id === c.container.id && p.item.id === s.item.id).length;
          return have - moved > 0 ? [{ item: { id: s.item.id, name: s.item.name }, from: { id: c.container.id, name: c.container.name }, room: room(beltC, s.item.id, s.item.max_stack ?? 1) }] : [];
        });
      })
    : [];
  return { away, belt: beltC ? { id: beltC.container.id, name: beltC.container.name } : null, fromPacks };
}

/**
 * Keeps a refit after the round: in a character's equipment (the new item comes out of their container, and what it
 * replaced goes back into it), or on a creature token (not its template).
 */
export function saveRefit(tokenId: number, equipment: Equipment, swap?: Refit, before?: Equipment, put?: Put): void {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return;
  // Put away: out of a pack (one of its stack) or a slot (emptied below), into the container.
  if (t.character_id && put) {
    if (put.from) {
      const s = characterContainers(t.character_id).find((c) => c.container.id === put.from!.id)?.stacks.find((x) => x.item.id === put.item.id);
      if (s) takeFromStack(s.id);
    }
    addToContainer(t.character_id, put.into.id, put.item.id, 1);
  }
  if (t.character_id && swap) {
    const from = takeCarried(t.character_id, swap.item.id) ?? characterContainers(t.character_id)[0]?.container.id;
    const out = [swap.from?.id, swap.clears ? before?.[swap.clears] : null].filter((x): x is number => !!x);
    for (const id of out) if (from) addToContainer(t.character_id, from, id, 1);
  }
  if (t.character_id) {
    const c = getCharacter(t.character_id);
    if (c) { const { id: _id, creature_id, template_name: _t, ...rest } = c; saveCharacter(c.id, creature_id, { ...rest, equipment }); }
  } else db.prepare<[string, number]>("UPDATE map_tokens SET equipment = ? WHERE id = ?").run(JSON.stringify(equipment), tokenId);
}

/**
 * An item's action was used: a consumable is used up, one from where it was (a belt's or pack's stack; in a hand, the
 * hand is emptied). Anything else is kept. Returns whether one was used up.
 */
export function useUpItem(tokenId: number, item: NonNullable<GearAction["item"]>): boolean {
  if (getItem(item.id)?.type !== "consumable") return false;
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return false;
  if (item.where === "belt" || item.where === "pack") {
    if (!t.character_id) return false;
    const c = characterContainers(t.character_id).find((x) => x.container.id === item.container) ?? characterContainers(t.character_id).find((x) => x.stacks.some((s) => s.item.id === item.id));
    const s = c?.stacks.find((x) => x.item.id === item.id);
    if (!s) return false;
    takeFromStack(s.id);
    return true;
  }
  const equipment = { ...(tokenWho(tokenId)?.equipment ?? {}) };
  const slot = (Object.keys(equipment) as EquipSlot[]).find((k) => equipment[k] === item.id);
  if (!slot) return false;
  equipment[slot] = null;
  saveRefit(tokenId, equipment);
  return true;
}

/**
 * Actions a token can take from its gear: those of every equipped item, whatever it is (a weapon's Cleave, a tool's
 * Sedate, a shield's Block), of items it carries on a belt (at hand), of a character's professions, and of a creature
 * itself (a rat's Bite). Items in a pack count only with `packs` (out of encounters: in a round, Refit brings them out
 * first). An item's action says which item and where it is (Use; consumables are used up). Each carries what resolving
 * needs: time, range (squares), to-hit, damage, roll mode.
 */
export function gearActions(tokenId: number, equipment?: Equipment, opts: { packs?: boolean; onBelt?: { id: number; name: string; container: number; containerName: string }[] } = {}): (GearAction & { source: string })[] {
  const t = db.prepare<[number], { character_id: number | null; creature_id: number | null }>("SELECT character_id, creature_id FROM map_tokens WHERE id = ?").get(tokenId);
  const who = tokenWho(tokenId);
  if (!t || !who) return [];
  type Owned = { a: ReturnType<typeof listActions>[number]; source: string; itemRange: number; item?: GearAction["item"] };
  const owned: Owned[] = [
    ...(t.creature_id ? listActions({ creature_id: t.creature_id }).map((a) => ({ a, source: who.name, itemRange: 5 })) : []),
    // A character's professions grant actions too (Fortune Teller: Mesmerize).
    ...(t.character_id
      ? listCharacterProfessionIds(t.character_id).flatMap((pid) => listActions({ profession_id: pid }).map((a) => ({ a, source: professionName(pid), itemRange: 5 })))
      : []),
    ...Object.entries(equipment ?? who.equipment ?? {}).flatMap(([slot, id]) => {
      const item = id ? getItem(id) : undefined;
      const where = slot === "main hand" || slot === "off hand" ? ("hand" as const) : ("worn" as const);
      return item ? listActions({ item_id: item.id }).map((a) => ({ a, source: item.name, itemRange: item.range_ft, item: { id: item.id, where } })) : [];
    }),
  ];
  // Carried in their containers (not also equipped): a belt's are at hand. A pack's only out of encounters (packs):
  // in a round, Refit brings something out first.
  const worn = new Set(Object.values(equipment ?? who.equipment ?? {}).filter(Boolean));
  const carried = t.character_id
    ? characterContainers(t.character_id).filter((c) => c.slot === "waist" || opts.packs).flatMap((c) => {
        return c.stacks
          .filter((s, i) => !worn.has(s.item.id) && c.stacks.findIndex((x) => x.item.id === s.item.id) === i)
          .flatMap((s) => listActions({ item_id: s.item.id }).map((a) => ({ a, source: `${s.item.name}, ${c.slot === "waist" ? "on" : "from"} ${c.container.name}`, itemRange: s.item.range_ft, item: { id: s.item.id, where: c.slot === "waist" ? ("belt" as const) : ("pack" as const), container: c.container.id } })));
      })
    : [];
  owned.push(...carried.filter((x) => !owned.some((o) => o.a.id === x.a.id)));
  // Put on the belt earlier in the plan (Refit): at hand from then on.
  for (const b of opts.onBelt ?? []) {
    const item = getItem(b.id);
    if (!item) continue;
    for (const a of listActions({ item_id: item.id })) if (!owned.some((o) => o.a.id === a.id)) owned.push({ a, source: `${item.name}, on ${b.containerName}`, itemRange: item.range_ft, item: { id: item.id, where: "belt", container: b.container } });
  }
  // An item's action with no range of its own (0) reaches as far as the item does.
  return owned.map(({ a, source, itemRange, item }) => ({ ...(item ? { item } : {}), ...gearOf(a, (id) => getCondition(id), itemRange), source }));
}

const professionName = (id: number) => db.prepare<[number], { name: string }>("SELECT name FROM professions WHERE id = ?").get(id)?.name ?? "Profession";
