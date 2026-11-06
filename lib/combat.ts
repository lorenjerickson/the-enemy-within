import { formatModifier, modifier } from "@/lib/attributes";
import { getCharacter, getCreature, getItem, listActions, listTokens, setTokenHp, db, type Creature } from "@/lib/db";
import type { GearAction } from "@/lib/roundPlan";
import { rollDice } from "@/lib/dice";

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

/** Fighters for every token on a level, with current health (rolled from its formula if never set). */
export function fightersOn(levelId: number): Map<number, Fighter> {
  const out = new Map<number, Fighter>();
  for (const t of listTokens(levelId)) {
    if (t.character_id) {
      const c = getCharacter(t.character_id);
      const hp = db.prepare<[number], { hp: number | null }>("SELECT hp FROM characters WHERE id = ?").get(t.character_id)?.hp;
      if (c) out.set(t.id, fighterOf(c, hp ?? rollDice(c.health || "0")));
    } else if (t.creature_id) {
      const c = getCreature(t.creature_id);
      if (c) out.set(t.id, fighterOf(c, t.hp ?? rollDice(c.health || "0")));
    }
  }
  return out;
}

/** Saves a token's health after a round (a character's is its own; a creature token keeps its own). */
export function saveHp(tokenId: number, hp: number): void {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (t?.character_id) db.prepare("UPDATE characters SET hp = ? WHERE id = ?").run(Math.round(hp), t.character_id);
  else setTokenHp(tokenId, Math.round(hp));
}

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
  }));
}
