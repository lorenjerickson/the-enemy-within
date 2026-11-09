import { characterContainers, characterPlayers, db, getGameTime, getItem, listAfflictions, listTokenStatuses, tokenLabels } from "@/lib/db";
import { describeCondition } from "@/lib/conditions";
import { tokenWho } from "@/lib/combat";
import { tokenHealth } from "@/lib/health";
import { describeStatus } from "@/lib/status";
import type { EquipSlot } from "@/lib/itemTypes";
import { allegianceOf, type Allegiance } from "@/lib/sides";

/** What a character sheet shows for a token: art, how they're doing, what they wear and carry, and what's on them. */
export interface Sheet {
  tokenId: number;
  name: string;
  kind: "character" | "creature";
  player: string | null;
  allegiance: Allegiance; // whose side they're on
  image: string | null; // their artwork
  token: string | null; // their map token, if there's no artwork
  health: { current: number; maximum: number; temporary: number } | null;
  down: boolean;
  effects: { source: string; text: string; left: string; affliction?: number }[]; // active statuses and effects, with time left (affliction: a catalog effect's id on them, for the GM to remove)
  equipment: { slot: EquipSlot; name: string; id: number; container: boolean }[];
  containers: { id: number; slot: EquipSlot; name: string; capacity: number; stacks: { id: number; name: string; qty: number; slots: EquipSlot[] }[] }[];
  characterId: number | null; // for changing what they carry (characters only)
  slots: EquipSlot[]; // their slots (to equip into)
}

const timeLeft = (minutes: number) => (minutes < 1 ? `${Math.max(1, Math.round(minutes * 10))} round${Math.round(minutes * 10) === 1 ? "" : "s"}` : minutes < 60 ? `${Math.round(minutes)} min` : `${Math.round(minutes / 60)} h`);

/** The sheet for a token on the map (null if it's gone or isn't anyone). */
export function sheetFor(tokenId: number): Sheet | null {
  const t = db.prepare<[number], { id: number; level_id: number; character_id: number | null; creature_id: number | null; allegiance: string | null }>("SELECT id, level_id, character_id, creature_id, allegiance FROM map_tokens WHERE id = ?").get(tokenId);
  const who = t && tokenWho(t.id);
  if (!t || !who) return null;
  const h = tokenHealth(t.id);
  const now = getGameTime();
  return {
    tokenId: t.id,
    name: tokenLabels(t.level_id).get(t.id) ?? who.name,
    kind: t.character_id ? "character" : "creature",
    player: t.character_id ? characterPlayers().get(t.character_id) ?? null : null,
    allegiance: allegianceOf(t),
    image: who.image ?? null,
    token: who.token_overhead ?? null,
    health: h && { current: h.current, maximum: h.maximum, temporary: h.temporary },
    down: !!h && h.current + h.temporary <= 0,
    effects: [
      ...(listAfflictions(t.level_id).get(t.id) ?? []).map((a) => ({ source: a.condition.name, text: describeCondition(a.condition, false), left: `${a.left} round${a.left === 1 ? "" : "s"}`, affliction: a.id })),
      ...(listTokenStatuses(t.level_id).get(t.id) ?? []).filter((s) => s.boosts.length || s.grants.length).map((s) => ({ source: s.source, text: describeStatus(s), left: timeLeft(s.ends - now) })),
    ],
    equipment: (Object.entries(who.equipment ?? {}) as [EquipSlot, number | null][]).flatMap(([slot, id]) => {
      const item = id ? getItem(id) : undefined;
      return item ? [{ slot, name: item.name, id: item.id, container: !!item.capacity }] : [];
    }),
    containers: t.character_id
      ? characterContainers(t.character_id).map((c) => ({ id: c.container.id, slot: c.slot, name: c.container.name, capacity: c.container.capacity ?? 0, stacks: c.stacks.map((s) => ({ id: s.id, name: s.item.name, qty: s.qty, slots: s.item.slots })) }))
      : [],
    characterId: t.character_id,
    slots: Object.keys(who.equipment ?? {}) as EquipSlot[],
  };
}
