import { formatModifier, modifier, type Attribute } from "@/lib/attributes";
import { getCharacter, getCreature, getItem, listActions, listTokens, db, type Creature } from "@/lib/db";
import { saveTokenHealth, takeDamage, tokenHealth } from "@/lib/health";
import type { GearAction } from "@/lib/roundPlan";
import { rollDice } from "@/lib/dice";
import type { EffectKind } from "@/lib/effects";

/**
 * Default combat rules (a placeholder until Loren specifies the system's own; change freely):
 * to hit = d20 + might modifier + main-hand weapon's attack dice, against defense = 10 + agility modifier + armour's
 * defense dice; damage = weapon damage dice (unarmed 1d4) + might modifier, at least 1. Melee reach is 1 square.
 */
export interface Fighter {
  hp: number;
  attack: (use?: GearAction) => { total: number; text: string };
  defense: () => { total: number; text: string };
  damage: (use?: GearAction) => { total: number; text: string };
  save: (attr: Attribute) => { total: number; text: string }; // d20 + that attribute's modifier
}

const roll = (f: string | null | undefined) => (f && f.trim() ? rollDice(f.replace(/^\+/, "")) : 0);

function fighterOf(who: Pick<Creature, "attributes" | "equipment">, hp: number): Fighter {
  const items = Object.values(who.equipment ?? {}).flatMap((id) => (id ? [getItem(id)].filter(Boolean) : [])) as NonNullable<ReturnType<typeof getItem>>[];
  const weapon = who.equipment?.["main hand"] ? getItem(who.equipment["main hand"]!) : undefined;
  const might = modifier(who.attributes.might ?? 10), agility = modifier(who.attributes.agility ?? 10);
  return {
    hp,
    attack: (use) => {
      // A gear action (Aimed shot…) uses its own to-hit modifier and advantage / disadvantage.
      const a = rollDice("1d20"), b = rollDice("1d20");
      const d = use?.roll === "advantage" ? Math.max(a, b) : use?.roll === "disadvantage" ? Math.min(a, b) : a;
      const mod = use ? use.attack : weapon?.attack, w = roll(mod);
      const how = use?.roll && use.roll !== "normal" ? ` (${use.roll}: ${a}, ${b})` : "";
      return { total: d + might + w, text: `d20 ${d}${how} ${formatModifier(might)}${mod ? ` ${formatModifier(w)} ${use?.name ?? weapon?.name}` : ""}` };
    },
    save: (attr) => {
      const d = rollDice("1d20"), mod = modifier(who.attributes[attr] ?? 10);
      return { total: d + mod, text: `d20 ${d} ${formatModifier(mod)}` };
    },
    defense: () => {
      const armour = items.reduce((s, i) => s + roll(i.defense), 0);
      return { total: 10 + agility + armour, text: `10 ${formatModifier(agility)}${armour ? ` +${armour} armour` : ""}` };
    },
    damage: (use) => {
      const dice = use?.damage || weapon?.damage || "1d4";
      const d = roll(dice);
      return { total: Math.max(1, d + might), text: `${use?.damage ? `${dice} (${use.name})` : weapon?.damage ? `${dice} (${weapon.name})` : "1d4 unarmed"} ${d} ${formatModifier(might)}` };
    },
  };
}

/** Fighters for every token on a level; their hp is current plus temporary health (temporary goes first). */
export function fightersOn(levelId: number): Map<number, Fighter> {
  const out = new Map<number, Fighter>();
  for (const t of listTokens(levelId)) {
    const c = t.character_id ? getCharacter(t.character_id) : t.creature_id ? getCreature(t.creature_id) : undefined;
    const h = c && tokenHealth(t.id);
    if (c && h) out.set(t.id, fighterOf(c, h.current + h.temporary));
  }
  return out;
}

/** Saves a token's health after a round: the drop from current + temporary comes off temporary first. */
export function saveHp(tokenId: number, hp: number): void {
  const h = tokenHealth(tokenId);
  if (h) saveTokenHealth(tokenId, takeDamage(h, h.current + h.temporary - Math.round(hp)));
}

/** How long an action's effect lasts, in game minutes (a round is 6 s; rests count as 1 and 8 hours); 0 = instant. */
function durationMinutes(amount: number, unit: string): number {
  const per: Record<string, number> = { round: 0.1, turn: 0.1, minute: 1, hour: 60, day: 1440, "short rest": 60, "long rest": 480 };
  return (per[unit] ?? 0) * Math.max(1, amount);
}

/** How a lasting area looks, from its damage type. */
const lookOf = (type: string): EffectKind =>
  type === "fire" ? "fire" : type === "lightning" ? "lightning" : type === "cold" ? "snow" : type === "thunder" ? "wind" : "fog";

/**
 * Actions a token can take from its gear: those of its equipped items (and, for a creature, its own actions,
 * e.g. a rat's Bite). Each carries what resolving needs: time, range (squares), to-hit, damage, roll mode.
 */
export function gearActions(tokenId: number): (GearAction & { source: string })[] {
  const t = db.prepare<[number], { character_id: number | null; creature_id: number | null }>("SELECT character_id, creature_id FROM map_tokens WHERE id = ?").get(tokenId);
  const who = t?.character_id ? getCharacter(t.character_id) : t?.creature_id ? getCreature(t.creature_id) : undefined;
  if (!t || !who) return [];
  const owned = [
    ...(t.creature_id ? listActions({ creature_id: t.creature_id }).map((a) => ({ a, source: who.name })) : []),
    ...Object.values(who.equipment ?? {}).flatMap((id) => {
      const item = id ? getItem(id) : undefined;
      return item ? listActions({ item_id: item.id }).map((a) => ({ a, source: item.name })) : [];
    }),
  ];
  return owned.map(({ a, source }) => ({
    id: a.id, name: a.name, source, seconds: a.seconds, range: Math.max(1, Math.round(a.range_ft / 5)), attack: a.attack, damage: a.damage, roll: a.roll,
    ...(a.area_shape && a.area_ft > 0
      ? { area: { shape: a.area_shape, ft: a.area_ft, dc: a.save_dc, save: a.save_attr, half: !!a.save_half, minutes: durationMinutes(a.duration_amount, a.duration_unit), look: lookOf(a.damage_type) } }
      : {}),
  }));
}
