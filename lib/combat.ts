import { formatModifier, modifier, type Attribute } from "@/lib/attributes";
import { addToContainer, characterContainers, listCharacterProfessionIds, getCharacter, getCreature, getItem, listActions, listItems, listTokens, takeCarried, listTokenStatuses, listAfflictions, getCondition, saveCharacter, db, type Creature, type Equipment } from "@/lib/db";
import type { EquipSlot } from "@/lib/itemTypes";
import { allegianceOf, type Allegiance } from "@/lib/sides";
import { boostsOn, combineModes, critRange, d20Tweaks, settled, type ActionStatuses, type Status } from "@/lib/status";
/** An attack roll: its total, how it was rolled, and the natural d20 (crit: a critical hit; fumble: a natural 1, a miss). */
export type AttackRoll = { total: number; text: string; natural?: number; crit?: boolean; fumble?: boolean };
import type { Boost, RollGrant, RollMode } from "@/lib/actions";
import type { ModifierTarget } from "@/lib/modifiers";
import { saveTokenHealth, takeDamage, tokenHealth } from "@/lib/health";
import type { GearAction, Refit } from "@/lib/roundPlan";
import { rollDice } from "@/lib/dice";
import type { EffectKind } from "@/lib/effects";
import { rollChanges, sensesFrom, type Senses, type Trigger, type Condition, type Extra, type Resist, type Restrictions } from "@/lib/conditions";
import { effectiveMaxHp, extrasOn, professionStatuses, resistancesOf, restrictionsOn, standingEffects, standingStatuses } from "@/lib/creatureChanges";
import type { AuraModifier } from "@/lib/auras";
import { areaFires } from "@/lib/aoe";

/**
 * Default combat rules (a placeholder until Loren specifies the system's own; change freely):
 * to hit = d20 + might modifier + main-hand weapon's attack dice, against defense = 10 + agility modifier + armour's
 * defense dice; damage = weapon damage dice (unarmed 1d4) + might modifier, at least 1. Melee reach is 1 square.
 */
export interface Fighter {
  hp: number;
  statuses: Status[]; // what actions left on them (statuses added during a round count straight away)
  attack: (use?: GearAction, against?: { statuses?: Status[] }, more?: RollMode[]) => AttackRoll; // more: advantage / disadvantage from elsewhere (not being seen)
  defense: () => { total: number; text: string };
  damage: (use?: GearAction, crit?: boolean) => { total: number; text: string }; // crit: the damage dice twice
  save: (attr: Attribute) => { total: number; text: string }; // d20 + that attribute's modifier
  wear: (equipment: Equipment) => void; // a refit mid-round: attacks, damage and defense use the new gear from then on
  maxHp?: number; // full health (for how bad a wound sounds)
  allegiance?: Allegiance; // whose side they're on (for actions aimed at friendlies or enemies)
  resist?: Record<string, Resist[]>; // how they take each kind of damage (resistant / vulnerable / immune), by type
  extras?: { dealing: Extra[]; taking: Extra[] }; // extra damage on their hits, and on hits against them
  limits?: Restrictions; // what conditions stop them doing (and saves they fail)
  auras?: AuraModifier[]; // auras they give off of their own (or from what they wear)
  triggers?: { mod: Trigger; name: string }[]; // triggers of their own (or from what they wear)
  senses?: Senses; // their own senses (and their gear's)
}

const roll = (f: string | null | undefined) => (f && f.trim() ? rollDice(f.replace(/^\+/, "")) : 0);
/**
 * A d20 with advantage / disadvantage, a reroll (at or below: once, keep the new one) and a minimum: the value counted,
 * how it was rolled for the log, and the natural roll (before any minimum; for critical hits and misses).
 */
function d20(mode: RollMode, t: { reroll: number; min: number } = { reroll: 0, min: 0 }): [number, string, number] {
  const a = rollDice("1d20"), b = rollDice("1d20");
  let kept = mode === "normal" ? a : mode === "advantage" ? Math.max(a, b) : Math.min(a, b);
  let text = mode === "normal" ? `d20 ${a}` : `d20 ${kept} (${mode}: ${a}, ${b})`;
  if (t.reroll && kept <= t.reroll) {
    const c = mode === "normal" ? b : rollDice("1d20"); // a plain roll's second die is the reroll
    text += ` rerolled → ${c}`;
    kept = c;
  }
  const natural = kept;
  if (t.min && kept < t.min) {
    text += ` (counts as ${t.min})`;
    kept = t.min;
  }
  return [kept, text, natural];
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
  // Attribute modifiers, with statuses' attribute boosts, settings and multipliers (read when rolled, so new statuses count).
  const mod = (a: Attribute) => modifier(settled((who.attributes[a] ?? 10) + boosted(f.statuses, `attribute:${a}`), f.statuses, `attribute:${a}`).value);
  const f: Fighter = {
    hp,
    statuses: [...statuses],
    wear,
    attack: (use, against, more = []) => {
      // A gear action (Aimed shot…) uses its own to-hit modifier; advantage / disadvantage from it, from statuses on the
      // attacker (their attack rolls) and on the target (attack rolls against them) — one of each cancels out.
      const mode = combineModes(use?.roll ?? "normal", f.statuses, "attack", [...(against ? [combineModes("normal", against.statuses ?? [], "attacked")] : []), ...more]);
      const [d, text, natural] = d20(mode, d20Tweaks(f.statuses, ["attack"]));
      const might = mod("might"), w = roll(use ? use.attack : weapon?.attack), extra = boosted(f.statuses, "attack");
      // A natural 20 (or within a wider critical range) always hits, a critical; a natural 1 always misses.
      return { total: d + might + w + extra, text: `${text} ${formatModifier(might)}${w ? ` ${formatModifier(w)} ${use?.name ?? weapon?.name}` : ""}${plus(extra, "boost")}`, natural, crit: natural >= critRange(f.statuses), fumble: natural === 1 };
    },
    save: (attr) => {
      const [d, text] = d20(combineModes("normal", f.statuses, `save:${attr}`), d20Tweaks(f.statuses, [`save:${attr}`]));
      const m = mod(attr), extra = boosted(f.statuses, "save") + boosted(f.statuses, `save:${attr}`); // Bless +1d4, rolled each time
      return { total: d + m + extra, text: `${text} ${formatModifier(m)}${plus(extra, "boost")}` };
    },
    defense: () => {
      const agility = mod("agility"), armour = items.reduce((s, i) => s + roll(i.defense), 0), extra = boosted(f.statuses, "defense");
      const s = settled(10 + agility + armour + extra, f.statuses, "defense", mod); // Mage Armor: 13 + Agility if better
      return { total: s.value, text: `10 ${formatModifier(agility)}${armour ? ` +${armour} armour` : ""}${plus(extra, "boost")}${s.note}` };
    },
    damage: (use, crit) => {
      const dice = use?.damage || weapon?.damage || "1d4";
      const d = roll(dice) + (crit ? roll(dice) : 0), might = mod("might"), extra = boosted(f.statuses, "damage");
      const s = settled(Math.max(1, d + might + extra), f.statuses, "damage");
      return { total: s.value, text: `${use?.damage ? `${dice} (${use.name})` : weapon?.damage ? `${dice} (${weapon.name})` : "1d4 unarmed"}${crit ? " ×2 dice (critical)" : ""} ${d} ${formatModifier(might)}${plus(extra, "boost")}${s.note}` };
    },
  };
  return f;
}

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
    const f: Fighter = { ...fighterOf(c, Math.min(h.current, maxHp) + h.temporary, [...(statuses.get(t.id) ?? []), ...fromEffects, ...standingStatuses(t.id), ...professionStatuses(t.character_id)]), maxHp, allegiance: allegianceOf(t), resist: resistancesOf(t.id, levelId), extras: extrasOn(t.id, levelId), limits: restrictionsOn(t.id, levelId), auras: standingEffects(t.id).flatMap((e) => e.modifiers).filter((m): m is AuraModifier => m.kind === "aura"), triggers: standingEffects(t.id).flatMap((e) => e.modifiers.flatMap((mod) => (mod.kind === "trigger" ? [{ mod, name: e.name }] : []))), senses: sensesFrom(standingEffects(t.id).flatMap((e) => e.modifiers)) };
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

/** The statuses an action leaves (on whoever uses it, and on its target), lasting its duration (instant: 1 round). */
function statusesOf(a: { name: string; boosts: Boost[]; roll_grants: RollGrant[]; duration_amount: number; duration_unit: string; conditions?: { id: number; on: "self" | "target" }[] }): { statuses?: ActionStatuses } {
  const on = (who: "self" | "target"): Status | undefined => {
    // (Actions' own boosts and roll effects were folded into catalog conditions; any left over still count.)
    const boosts = a.boosts.filter((b) => (b.on ?? "self") === who), grants = a.roll_grants.filter((g) => (g.on ?? "self") === who);
    const conditions = (a.conditions ?? []).filter((c) => c.on === who).flatMap((c) => getCondition(c.id) ?? []); // as they are now in the catalog
    return boosts.length || grants.length || conditions.length ? { source: a.name, boosts, grants, ...(conditions.length ? { conditions } : {}) } : undefined;
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

/** Extra time to dig an item out of a pack (anything carried in a container not worn at the waist) before using it. */
export const FROM_PACK_SECONDS = 3;

/**
 * Actions a token can take from its gear: those of every equipped item, whatever it is (a weapon's Cleave, a tool's
 * Sedate, a shield's Block), of items it carries in its worn containers (on a belt at hand; from a pack taking
 * FROM_PACK_SECONDS longer), of a character's professions, and of a creature itself (a rat's Bite). Each carries what
 * resolving needs: time, range (squares), to-hit, damage, roll mode.
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
  // Carried in their containers (not also equipped): a belt's are at hand; a pack's take longer to get out.
  const worn = new Set(Object.values(equipment ?? who.equipment ?? {}).filter(Boolean));
  const carried = t.character_id
    ? characterContainers(t.character_id).flatMap((c) => {
        const extra = c.slot === "waist" ? 0 : FROM_PACK_SECONDS;
        return c.stacks
          .filter((s, i) => !worn.has(s.item.id) && c.stacks.findIndex((x) => x.item.id === s.item.id) === i)
          .flatMap((s) => listActions({ item_id: s.item.id }).map((a) => ({ a: { ...a, seconds: a.seconds + extra }, source: `${s.item.name}, ${extra ? `from ${c.container.name}` : `on ${c.container.name}`}`, itemRange: s.item.range_ft })));
      })
    : [];
  owned.push(...carried.filter((x) => !owned.some((o) => o.a.id === x.a.id)));
  // An item's action with no range of its own (0) reaches as far as the item does.
  return owned.map(({ a, source, itemRange }) => ({
    id: a.id, name: a.name, description: a.description, damageType: a.damage_type || undefined, source, seconds: a.seconds, range: Math.max(1, Math.round((a.range_ft || itemRange) / 5)), attack: a.attack, damage: a.damage, roll: a.roll,
    ...(a.area_shape && a.area_ft > 0
      ? { area: { shape: a.area_shape, ft: a.area_ft, dc: a.save_dc, save: a.save_attr, half: !!a.save_half, minutes: a.area_lasts ? durationMinutes(a.duration_amount, a.duration_unit) || 0.1 : 0, look: lookOf(a.damage_type), fires: areaFires(a.area_fires) } }
      : {}),
    ...statusesOf(a),
    ...((): { targets: "self" | "others" | "anyone"; self?: true } => {
      // Who it can be used on: as the GM set it, else others if it does damage or affects a target, else themselves.
      const auto = !a.damage && !a.boosts.some((b) => b.on === "target") && !a.roll_grants.some((g) => g.on === "target") && !a.conditions.some((c) => c.on === "target") ? "self" : "others";
      const targets = a.area_shape ? "others" : a.targets || auto;
      return targets === "self" ? { targets, self: true } : { targets };
    })(),
    targeting: { who: a.target_who, count: a.target_count, n: a.target_n },
  }));
}

const professionName = (id: number) => db.prepare<[number], { name: string }>("SELECT name FROM professions WHERE id = ?").get(id)?.name ?? "Profession";
