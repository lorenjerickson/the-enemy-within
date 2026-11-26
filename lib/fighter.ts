// Pure: the combat rules a creature rolls by (to-hit, defense, saves, damage), given its attributes, gear and statuses.
// The database side (who is on the map, with what) is lib/combat.ts.
import { formatModifier, modifier, type Attribute } from "@/lib/attributes";
import type { Creature, Equipment, Item } from "@/lib/db/catalog"; // types only
import type { Allegiance } from "@/lib/sides";
import { boostsOn, combineModes, critRange, d20Tweaks, settled, type Status } from "@/lib/status";
import type { RollMode } from "@/lib/actions";
import type { ModifierTarget } from "@/lib/modifiers";
import type { GearAction } from "@/lib/roundPlan";
import { rollDice } from "@/lib/dice";
import type { Modifier, Senses, Trigger, Extra, Resist, Restrictions } from "@/lib/conditions";
import type { AuraModifier } from "@/lib/auras";

/** An attack roll: its total, how it was rolled, and the natural d20 (crit: a critical hit; fumble: a natural 1, a miss). */
export type AttackRoll = { total: number; text: string; natural?: number; crit?: boolean; fumble?: boolean };

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
  senseMods?: Modifier[]; // the modifiers behind them
  attrMod?: (a: Attribute) => number; // an attribute's modifier now (with boosts and settings)
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

/** A fighter (the rules above), its gear looked up with `itemOf` (the catalog, or a test's items). */
export function fighterOf(who: Pick<Creature, "attributes" | "equipment">, hp: number, statuses: Status[] = [], itemOf: (id: number) => Item | undefined): Fighter {
  let items: Item[] = [], weapon: Item | undefined;
  const wear = (equipment: Equipment) => {
    items = Object.values(equipment ?? {}).flatMap((id) => (id ? [itemOf(id)].filter((x): x is Item => !!x) : []));
    weapon = equipment?.["main hand"] ? itemOf(equipment["main hand"]!) : undefined;
  };
  wear(who.equipment);
  // Attribute modifiers, with statuses' attribute boosts, settings and multipliers (read when rolled, so new statuses count).
  const mod = (a: Attribute) => modifier(settled((who.attributes[a] ?? 10) + boosted(f.statuses, `attribute:${a}`), f.statuses, `attribute:${a}`).value);
  const f: Fighter = {
    hp,
    attrMod: (a) => mod(a),
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
    save: (attr, more: RollMode[] = []) => {
      const [d, text] = d20(combineModes("normal", f.statuses, `save:${attr}`, more), d20Tweaks(f.statuses, [`save:${attr}`]));
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

