import { formatModifier, modifier, type Attribute } from "@/lib/attributes";
import { addToContainer, characterContainers, listCharacterProfessionIds, getCharacter, getCreature, getItem, listActions, listItems, listTokens, takeCarried, listTokenStatuses, saveCharacter, db, type Creature, type Equipment } from "@/lib/db";
import type { EquipSlot } from "@/lib/itemTypes";
import { allegianceOf, type Allegiance } from "@/lib/sides";
import { boostsOn, combineModes, type ActionStatuses, type Status } from "@/lib/status";
import type { Boost, RollGrant, RollMode } from "@/lib/actions";
import type { ModifierTarget } from "@/lib/modifiers";
import { saveTokenHealth, takeDamage, tokenHealth } from "@/lib/health";
import type { GearAction, Refit } from "@/lib/roundPlan";
import { rollDice } from "@/lib/dice";
import type { EffectKind } from "@/lib/effects";

/**
 * Default combat rules (a placeholder until Loren specifies the system's own; change freely):
 * to hit = d20 + might modifier + main-hand weapon's attack dice, against defense = 10 + agility modifier + armour's
 * defense dice; damage = weapon damage dice (unarmed 1d4) + might modifier, at least 1. Melee reach is 1 square.
 */
export interface Fighter {
  hp: number;
  statuses: Status[]; // what actions left on them (statuses added during a round count straight away)
  attack: (use?: GearAction, against?: { statuses?: Status[] }) => { total: number; text: string };
  defense: () => { total: number; text: string };
  damage: (use?: GearAction) => { total: number; text: string };
  save: (attr: Attribute) => { total: number; text: string }; // d20 + that attribute's modifier
  wear: (equipment: Equipment) => void; // a refit mid-round: attacks, damage and defense use the new gear from then on
  maxHp?: number; // full health (for how bad a wound sounds)
  allegiance?: Allegiance; // whose side they're on (for actions aimed at friendlies or enemies)
}

const roll = (f: string | null | undefined) => (f && f.trim() ? rollDice(f.replace(/^\+/, "")) : 0);
/** A d20 with advantage / disadvantage: the roll kept, and how it was rolled for the log. */
function d20(mode: RollMode): [number, string] {
  const a = rollDice("1d20"), b = rollDice("1d20");
  if (mode === "normal") return [a, `d20 ${a}`];
  return [mode === "advantage" ? Math.max(a, b) : Math.min(a, b), `d20 ${mode === "advantage" ? Math.max(a, b) : Math.min(a, b)} (${mode}: ${a}, ${b})`];
}
/** Statuses' boosts on one thing, rolled (they may be dice); 0 when none. */
const boosted = (statuses: Status[], target: ModifierTarget) => boostsOn(statuses, target).reduce((sum, v) => sum + roll(v), 0);
const plus = (n: number, what: string) => (n ? ` ${formatModifier(n)} ${what}` : "");

function fighterOf(who: Pick<Creature, "attributes" | "equipment">, hp: number, statuses: Status[] = []): Fighter {
  let items: NonNullable<ReturnType<typeof getItem>>[] = [], weapon: ReturnType<typeof getItem>;
  const wear = (equipment: Equipment) => {
    items = Object.values(equipment ?? {}).flatMap((id) => (id ? [getItem(id)].filter(Boolean) : [])) as typeof items;
    weapon = equipment?.["main hand"] ? getItem(equipment["main hand"]!) : undefined;
  };
  wear(who.equipment);
  // Attribute modifiers, with statuses' attribute boosts (read when rolled, so new statuses count).
  const mod = (a: Attribute) => modifier((who.attributes[a] ?? 10) + boosted(f.statuses, `attribute:${a}`));
  const f: Fighter = {
    hp,
    statuses: [...statuses],
    wear,
    attack: (use, against) => {
      // A gear action (Aimed shot…) uses its own to-hit modifier; advantage / disadvantage from it, from statuses on the
      // attacker (their attack rolls) and on the target (attack rolls against them) — one of each cancels out.
      const mode = combineModes(use?.roll ?? "normal", f.statuses, "attack", against ? [combineModes("normal", against.statuses ?? [], "attacked")] : []);
      const [d, text] = d20(mode);
      const might = mod("might"), w = roll(use ? use.attack : weapon?.attack), extra = boosted(f.statuses, "attack");
      return { total: d + might + w + extra, text: `${text} ${formatModifier(might)}${w ? ` ${formatModifier(w)} ${use?.name ?? weapon?.name}` : ""}${plus(extra, "boost")}` };
    },
    save: (attr) => {
      const [d, text] = d20(combineModes("normal", f.statuses, `save:${attr}`));
      const m = mod(attr);
      return { total: d + m, text: `${text} ${formatModifier(m)}` };
    },
    defense: () => {
      const agility = mod("agility"), armour = items.reduce((s, i) => s + roll(i.defense), 0), extra = boosted(f.statuses, "defense");
      return { total: 10 + agility + armour + extra, text: `10 ${formatModifier(agility)}${armour ? ` +${armour} armour` : ""}${plus(extra, "boost")}` };
    },
    damage: (use) => {
      const dice = use?.damage || weapon?.damage || "1d4";
      const d = roll(dice), might = mod("might"), extra = boosted(f.statuses, "damage");
      return { total: Math.max(1, d + might + extra), text: `${use?.damage ? `${dice} (${use.name})` : weapon?.damage ? `${dice} (${weapon.name})` : "1d4 unarmed"} ${d} ${formatModifier(might)}${plus(extra, "boost")}` };
    },
  };
  return f;
}

/** Fighters for every token on a level; their hp is current plus temporary health (temporary goes first). */
export function fightersOn(levelId: number): Map<number, Fighter> {
  const out = new Map<number, Fighter>();
  const statuses = listTokenStatuses(levelId);
  for (const t of listTokens(levelId)) {
    const c = tokenWho(t.id);
    const h = c && tokenHealth(t.id);
    if (c && h) out.set(t.id, { ...fighterOf(c, h.current + h.temporary, statuses.get(t.id)), maxHp: h.maximum, allegiance: allegianceOf(t) });
  }
  return out;
}

/** Saves a token's health after a round: the drop from current + temporary comes off temporary first. */
export function saveHp(tokenId: number, hp: number): void {
  const h = tokenHealth(tokenId);
  if (h) saveTokenHealth(tokenId, takeDamage(h, h.current + h.temporary - Math.round(hp)));
}

/** The statuses an action leaves (on whoever uses it, and on its target), lasting its duration (instant: 1 round). */
function statusesOf(a: { name: string; boosts: Boost[]; roll_grants: RollGrant[]; duration_amount: number; duration_unit: string }): { statuses?: ActionStatuses } {
  const on = (who: "self" | "target"): Status | undefined => {
    const boosts = a.boosts.filter((b) => (b.on ?? "self") === who), grants = a.roll_grants.filter((g) => (g.on ?? "self") === who);
    return boosts.length || grants.length ? { source: a.name, boosts, grants } : undefined;
  };
  const self = on("self"), target = on("target");
  if (!self && !target) return {};
  return { statuses: { ...(self ? { self } : {}), ...(target ? { target } : {}), minutes: durationMinutes(a.duration_amount, a.duration_unit) || 0.1 } };
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

/**
 * Keeps a refit after the round: in a character's equipment (the new item comes out of their container, and what it
 * replaced goes back into it), or on a creature token (not its template).
 */
export function saveRefit(tokenId: number, equipment: Equipment, swap?: Refit, before?: Equipment): void {
  const t = db.prepare<[number], { character_id: number | null }>("SELECT character_id FROM map_tokens WHERE id = ?").get(tokenId);
  if (!t) return;
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
export function gearActions(tokenId: number, equipment?: Equipment): (GearAction & { source: string })[] {
  const t = db.prepare<[number], { character_id: number | null; creature_id: number | null }>("SELECT character_id, creature_id FROM map_tokens WHERE id = ?").get(tokenId);
  const who = tokenWho(tokenId);
  if (!t || !who) return [];
  const owned = [
    ...(t.creature_id ? listActions({ creature_id: t.creature_id }).map((a) => ({ a, source: who.name, itemRange: 5 })) : []),
    // A character's professions grant actions too (Fortune Teller: Mesmerize).
    ...(t.character_id
      ? listCharacterProfessionIds(t.character_id).flatMap((pid) => listActions({ profession_id: pid }).map((a) => ({ a, source: professionName(pid), itemRange: 5 })))
      : []),
    ...Object.values(equipment ?? who.equipment ?? {}).flatMap((id) => {
      const item = id ? getItem(id) : undefined;
      return item ? listActions({ item_id: item.id }).map((a) => ({ a, source: item.name, itemRange: item.range_ft })) : [];
    }),
  ];
  // An item's action with no range of its own (0) reaches as far as the item does.
  return owned.map(({ a, source, itemRange }) => ({
    id: a.id, name: a.name, source, seconds: a.seconds, range: Math.max(1, Math.round((a.range_ft || itemRange) / 5)), attack: a.attack, damage: a.damage, roll: a.roll,
    ...(a.area_shape && a.area_ft > 0
      ? { area: { shape: a.area_shape, ft: a.area_ft, dc: a.save_dc, save: a.save_attr, half: !!a.save_half, minutes: a.area_lasts ? durationMinutes(a.duration_amount, a.duration_unit) || 0.1 : 0, look: lookOf(a.damage_type) } }
      : {}),
    ...statusesOf(a),
    ...((): { targets: "self" | "others" | "anyone"; self?: true } => {
      // Who it can be used on: as the GM set it, else others if it does damage or affects a target, else themselves.
      const auto = !a.damage && !a.boosts.some((b) => b.on === "target") && !a.roll_grants.some((g) => g.on === "target") ? "self" : "others";
      const targets = a.area_shape ? "others" : a.targets || auto;
      return targets === "self" ? { targets, self: true } : { targets };
    })(),
    targeting: { who: a.target_who, count: a.target_count, n: a.target_n },
  }));
}

const professionName = (id: number) => db.prepare<[number], { name: string }>("SELECT name FROM professions WHERE id = ?").get(id)?.name ?? "Profession";
