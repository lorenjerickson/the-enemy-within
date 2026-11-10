/**
 * The effect sentence grammar (draft): an effect's rules written as a player's handbook would, in the second person
 * ("you" = whoever has the effect), built blank by blank, each choice deciding the blanks that follow. A rule with no
 * "When …" / "At the start of …" opening holds while the condition lasts ("You can't take reactions."); one with an
 * opening happens then. How long anything lasts is the condition's, never a rule's. One tree drives the editor,
 * validation, the text and the modifiers the engine reads; what the engine can't do yet is noted, not dropped.
 * Audit against the current effect form: docs/effect-grammar-audit.md.
 */
import { DAMAGE_TYPES, type RollKind } from "@/lib/actions";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import type { Modifier } from "@/lib/conditions";
import { MODIFIER_TARGET_GROUPS, SKILLS, type ModifierTarget } from "@/lib/modifiers";

/** A blank (or fixed words) in a sentence. */
export type Slot =
  | { kind: "word"; text: string } // fixed words between blanks ("damage")
  | { kind: "choice"; id: string; label: string; options: Option[] } // pick one; its `next` blanks come before the rest
  | { kind: "dice"; id: string; label: string } // 2d6, 1d4+1, 3
  | { kind: "amount"; id: string; label: string } // dice or a number, or "[your | its] [attribute] modifier"
  | { kind: "number"; id: string; label: string; min?: number; max?: number } // 12, 20 (feet)
  | { kind: "optional"; id: string; lead: string; slots: Slot[] } // a clause that may be left off, starting with `lead`
  | { kind: "condition"; id: string; label: string }; // a catalog condition, by name (its choices come from the catalog)
export type Option = { value: string; text: string; next?: Slot[] };

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const an = (s: string) => `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s}`;
const attrs = (id: string): Slot => ({ kind: "choice", id, label: "attribute", options: ATTRIBUTES.map((a) => ({ value: a, text: cap(a) })) });
const types: Slot = { kind: "choice", id: "type", label: "damage type", options: DAMAGE_TYPES.map((t) => ({ value: t, text: t })) };
const word = (text: string): Slot => ({ kind: "word", text });
const num = (id: string, label: string, min = 0, max = 99): Slot => ({ kind: "number", id, label, min, max });
const dice: Slot = { kind: "dice", id: "dice", label: "dice expression" };
const amountSlot: Slot = { kind: "amount", id: "amount", label: "amount" };
const condition: Slot[] = [{ kind: "condition", id: "condition", label: "condition" }, word("condition")];
const keep: Slot = { kind: "choice", id: "keep", label: "which", options: [{ value: "disadvantage", text: "lower" }, { value: "advantage", text: "higher" }] };

/** "(DC [12] [Agility] save for [half])": a save against the damage. */
const SAVE: Slot = { kind: "optional", id: "save", lead: "DC", slots: [num("save_dc", "DC", 1, 40), attrs("save_attr"), word("save for"), { kind: "choice", id: "save_for", label: "on a success", options: [{ value: "half", text: "half" }, { value: "none", text: "none" }] }] };
/** "with a [melee] attack": which attacks a hit rule counts (left off: any). */
const WITH: Slot = { kind: "optional", id: "with", lead: "with", slots: [word("a"), { kind: "choice", id: "reach", label: "which attacks", options: [{ value: "melee", text: "melee" }] }, word("attack")] };

// ---------- Ongoing rules ----------
/** "You can't [take reactions]." / "You can't see beyond [5] feet." */
const YOU_CANT: Slot = { kind: "choice", id: "cant", label: "what", options: [
  { value: "actions", text: "take actions" }, { value: "bonus", text: "take bonus actions" }, { value: "reactions", text: "take reactions" }, { value: "movement", text: "move" },
  { value: "attack-source", text: "attack the creature that applied this" },
  { value: "see", text: "see beyond", next: [num("feet", "feet", 0, 120), word("feet")] },
] };
/** "You are [resistant] to [fire] damage." / "You are [invisible]." */
const YOU_ARE: Slot = { kind: "choice", id: "are", label: "what", options: [
  ...(["resistant", "vulnerable", "immune"] as const).map((level): Option => ({ value: level, text: level, next: [word("to"), { kind: "choice", id: "type", label: "damage type", options: [{ value: "all", text: "all" }, ...DAMAGE_TYPES.map((t) => ({ value: t, text: t }))] }, word("damage")] })),
  { value: "invisible", text: "invisible" },
] };
/** What "Your …" can change (rolls and skills are said with "When you make …"). */
const STATS: Option[] = MODIFIER_TARGET_GROUPS.filter(([g]) => g !== "Rolls" && g !== "Skills").flatMap(([group, opts]) =>
  opts.filter(([v]) => v !== "attack").map(([value, label]): Option => ({ value, text: value === "health" ? "maximum health" : value === "damage" || value === "defense" ? value : group === "Movement" ? `${label.toLowerCase()} speed` : label })),
);
/** How "Your [stat]" changes: by an amount, at least / at most a value, or multiplied. */
const HOW: Slot = { kind: "choice", id: "how", label: "how", options: [
  { value: "plus", text: "increases by", next: [amountSlot] },
  { value: "min", text: "is raised to", next: [num("to", "value"), { kind: "optional", id: "plus", lead: "plus", slots: [word("your"), attrs("plus_attr"), word("modifier")] }] },
  { value: "max", text: "is reduced to", next: [num("to", "value")] },
  { value: "x2", text: "is doubled" }, { value: "x0.5", text: "is halved" }, { value: "x0", text: "drops to zero" },
] };
const YOUR_STAT: Slot = { kind: "choice", id: "stat", label: "what", options: [
  ...STATS.map((o): Option => ({ ...o, next: [HOW] })),
  { value: "speed", text: "speed", next: [{ kind: "choice", id: "how", label: "how", options: [{ value: "x0.5", text: "is halved" }, { value: "x2", text: "is doubled" }] }] },
  { value: "darkvision", text: "darkvision", next: [{ kind: "choice", id: "how", label: "how", options: [{ value: "min", text: "is raised to" }, { value: "max", text: "is reduced to" }] }, num("to", "feet", 0, 300), word("feet")] },
  { value: "crit", text: "attacks score a critical hit on a d20 roll of", next: [num("range", "lowest roll", 2, 20), word("or higher")] },
] };

// ---------- Rolls ----------
/** Which roll "When you make …" is about: one kind, or every kind of a group. */
const ROLLS: Option[] = [
  { value: "attack", text: "an attack roll" },
  { value: "save", text: "a saving throw" },
  ...ATTRIBUTES.map((a): Option => ({ value: `save:${a}`, text: an(`${cap(a)} saving throw`) })),
  { value: "check", text: "an ability check" },
  ...ATTRIBUTES.map((a): Option => ({ value: `check:${a}`, text: an(`${cap(a)} check`) })),
  ...SKILLS.map((s): Option => ({ value: `skill:${s}`, text: an(`${cap(s)} check`) })),
  { value: "any", text: "any d20 roll" },
];
const ON_ROLL: Slot = { kind: "choice", id: "sign", label: "what happens", options: [
  { value: "+", text: "add", next: [dice, word("to the roll")] },
  { value: "-", text: "subtract", next: [dice, word("from the roll")] },
  { value: "twice", text: "roll it twice and use the", next: [keep, word("result")] },
  { value: "reroll", text: "reroll a d20 roll of", next: [num("at", "highest roll rerolled", 1, 19), word("or lower and use the new result")] },
  { value: "min", text: "treat any d20 roll below", next: [num("min", "minimum", 2, 20), word("as that number")] },
] };

// ---------- Outcomes of a timed or triggered rule (their words depend on who "it" is, and when) ----------
const youTake: Option = { value: "you_take", text: "you take", next: [dice, types, word("damage"), SAVE] };
const itTakes = (extra: boolean): Option => ({ value: "it_takes", text: extra ? "it takes an extra" : "it takes", next: [dice, types, word("damage"), SAVE] });
const youTakeExtra: Option = { value: "you_take_extra", text: "you take an extra", next: [dice, types, word("damage")] };
const yourHealth: Option = { value: "your_health", text: "your health increases by", next: [amountSlot] };
const tempHealth: Option = { value: "temp", text: "you gain", next: [dice, word("temporary health")] };
const youGain: Option = { value: "you_gain", text: "you gain the", next: condition };
const itGains: Option = { value: "it_gains", text: "it gains the", next: condition };
const strainYour: Option = { value: "strain", text: "strain your", next: [attrs("strain_attr"), word("by"), num("points", "points", 1, 20)] };
const relieve: Option = { value: "relieve", text: "relieve", next: [num("points", "points", 1, 20), word("strain from your"), attrs("strain_attr")] };
/** "your [defense] increases by [1] for [3] rounds (up to [5] times)": a stacking condition made for it. */
const yourStatFor: Option = { value: "your_stat", text: "your", next: [
  { kind: "choice", id: "stat", label: "what", options: STATS.filter((o) => o.value !== "health") },
  word("increases by"), amountSlot, word("for"), num("rounds", "rounds", 1, 600), word("rounds"),
  { kind: "optional", id: "limit", lead: "up", slots: [word("to"), num("stack_limit", "times at most", 1, 99), word("times")] },
] };
const outcome = (options: Option[]): Slot => ({ kind: "choice", id: "outcome", label: "what happens", options });

export const EFFECT_SENTENCE: Slot[] = [{
  kind: "choice", id: "when", label: "select", options: [
    // Ongoing (while the condition lasts)
    { value: "you", text: "You can't", next: [YOU_CANT] },
    { value: "are", text: "You are", next: [YOU_ARE] },
    { value: "can", text: "You can see invisible creatures" },
    { value: "autofail", text: "You automatically fail", next: [attrs("fail_attr"), word("saving throws")] },
    { value: "your", text: "Your", next: [YOUR_STAT] },
    { value: "nocrit", text: "Critical hits against you are normal hits" },
    { value: "aura", text: "Within", next: [num("radius", "feet", 5, 300), word("feet of you"), { kind: "choice", id: "who", label: "who", options: [{ value: "enemy", text: "enemies" }, { value: "friendly", text: "allies" }, { value: "", text: "creatures" }] }, { kind: "optional", id: "self", lead: "and", slots: [word("you")] }, word("gain the"), ...condition] },
    // Rolls
    { value: "roll", text: "When you make", next: [{ kind: "choice", id: "roll", label: "which roll", options: ROLLS }, ON_ROLL] },
    { value: "attacked", text: "When a creature makes an attack roll against you", next: [word("it rolls twice and uses the"), keep, word("result")] },
    // Timed and triggered
    { value: "applied", text: "When this is applied", next: [outcome([tempHealth, yourHealth, youTake, strainYour, relieve])] },
    { value: "start", text: "At the start of each round", next: [outcome([youTake, yourHealth, youGain])] },
    { value: "end", text: "At the end of each round", next: [outcome([youTake, yourHealth])] },
    { value: "hitting", text: "When you hit a creature", next: [WITH, outcome([itTakes(true), youTake, yourHealth, itGains, youGain])] },
    { value: "hit", text: "When a creature hits you", next: [WITH, outcome([itTakes(false), youTakeExtra, itGains, youGain])] },
    { value: "hit_by_source", text: "When the creature that applied this hits you", next: [outcome([youTakeExtra])] },
    { value: "damaged", text: "When you take damage", next: [outcome([yourStatFor, yourHealth, youGain])] },
    { value: "moves", text: "When you move", next: [outcome([youTake, youGain])] },
  ],
}];

/** A sentence's filled blanks, by slot id (an amount from a modifier: `amount` = "your:fortitude" / "its:might"). */
export type Filled = Record<string, string | number>;
/** A condition a shortcut sentence makes for itself (a stacking bonus): its name, its one effect's modifiers and its lifecycle. */
export type MadeCondition = { name: string; effect: Modifier[]; rounds: number; reapply: "stack"; stack_limit: number };
export type Compiled = { modifiers: Modifier[]; notes: string[]; creates?: MadeCondition };

const signed = (v: string) => (/^[+-]/.test(v) ? v : `+${v}`);
/** The engine's roll kinds for a "which roll" choice (a group: one per attribute). */
const rollKinds = (r: string): RollKind[] =>
  r === "save" ? ATTRIBUTES.map((a) => `save:${a}` as const) : r === "check" ? ATTRIBUTES.map((a) => `check:${a}` as const) : r === "any" ? ["attack", ...rollKinds("save"), ...rollKinds("check")] : [r as RollKind];

/**
 * Turns a complete sentence into the modifiers the engine reads (most rules are one; "any d20 roll" and the like are
 * several), with notes on anything it can't do yet. `conditionId` looks a catalog condition up by name.
 */
export function compile(f: Filled, conditionId: (name: string) => number = () => -1): Compiled {
  const notes: string[] = [];
  const one = (m: Modifier): Compiled => ({ modifiers: [m], notes });
  const none = (note: string): Compiled => ({ modifiers: [], notes: [...notes, note] });
  const save = f.save_attr !== undefined, half = f.save_for !== "none";
  if (typeof f.amount === "string" && f.amount.includes(":")) notes.push(`an amount from ${f.amount.split(":")[0]} ${f.amount.split(":")[1]} modifier isn't in the engine yet: amounts are dice or numbers`);
  const amount = String(f.dice ?? f.amount);
  const cond = f.condition !== undefined ? conditionId(String(f.condition)) : 0;
  const trigger = (on: "hit" | "hitting" | "start" | "moves", extra: Partial<Extract<Modifier, { kind: "trigger" }>> = {}): Modifier => ({
    kind: "trigger", on, reach: f.reach === "melee" ? "melee" : "any", damage: "", damage_type: "", save_attr: save ? (f.save_attr as Attribute) : "", save_dc: save ? Number(f.save_dc) : 12, save_halves: half, condition: 0, condition_on: "other", ...extra,
  });
  const triggerOutcome = (on: "hit" | "hitting" | "start" | "moves"): Compiled => {
    if (f.outcome === "it_takes") return one(trigger(on, { damage: amount, damage_type: f.type as never }));
    if (f.outcome === "it_gains") return one(trigger(on, { condition: cond, condition_on: "other" }));
    if (f.outcome === "you_gain") return one(trigger(on, { condition: cond, condition_on: "self" }));
    if (f.outcome === "you_take" && (on === "start" || on === "moves")) return one(trigger(on, { damage: amount, damage_type: f.type as never }));
    if (f.outcome === "you_take") return none("backwash (a trigger damaging whoever has the effect) isn't in the engine yet");
    return none("healing from a trigger isn't in the engine yet");
  };
  switch (f.when) {
    case "you":
      if (f.cant === "see") {
        if (Number(f.feet) !== 5) notes.push(`the engine's blindness is fixed at 5 feet, not ${f.feet}`);
        return one({ kind: "sense", sense: "blind" });
      }
      return one({ kind: "forbid", what: f.cant as never });
    case "are":
      if (f.are === "invisible") return one({ kind: "sense", sense: "invisible" });
      return { modifiers: (f.type === "all" ? [...DAMAGE_TYPES] : [f.type as (typeof DAMAGE_TYPES)[number]]).map((damage_type): Modifier => ({ kind: "resist", damage_type, level: f.are as never })), notes };
    case "can":
      return one({ kind: "sense", sense: "seeinvisible" });
    case "autofail":
      return one({ kind: "autofail", save: f.fail_attr as Attribute });
    case "nocrit":
      return one({ kind: "nocrit" });
    case "aura":
      return one({ kind: "aura", condition: cond, radius: Number(f.radius), who: f.who as never, self: f.self !== undefined });
    case "your": {
      if (f.stat === "crit") return one({ kind: "crit", range: Number(f.range) });
      if (f.stat === "speed") return one({ kind: "speed", factor: Number(String(f.how).slice(1)) });
      if (f.how === "max") return none(`"is reduced to" needs caps in the engine (today the best of several sources counts, so nothing lowers it)`);
      if (f.stat === "darkvision") return one({ kind: "sense", sense: "darkvision", range: Number(f.to) });
      const target = f.stat as ModifierTarget;
      if (f.how === "min") return one({ kind: "set", target, value: Number(f.to), ...(f.plus_attr ? { plus: f.plus_attr as Attribute } : {}) });
      if (String(f.how).startsWith("x")) return one({ kind: "multiply", target, factor: Number(String(f.how).slice(1)) });
      if (f.stat === "health") return /^[+-]?\d+$/.test(amount) ? one({ kind: "maxhp", value: Number(amount) }) : none("maximum health takes a plain number, not dice");
      return one({ kind: "boost", target, value: signed(amount) });
    }
    case "roll": {
      const kinds = rollKinds(String(f.roll));
      if (f.sign === "twice") return { modifiers: kinds.map((roll): Modifier => ({ kind: "roll", roll, mode: f.keep as never })), notes };
      if (f.sign === "reroll") return { modifiers: kinds.map((roll): Modifier => ({ kind: "reroll", roll, at: Number(f.at) })), notes };
      if (f.sign === "min") return { modifiers: kinds.map((roll): Modifier => ({ kind: "minroll", roll, min: Number(f.min) })), notes };
      // Added dice: the engine boosts all saving throws ("save"), one attribute's ("save:x"), a skill, attack rolls or every check.
      const value = `${f.sign}${amount.replace(/^[+-]/, "")}`;
      if (String(f.roll).startsWith("check:")) return none("the engine can't add to one attribute's checks (only to every check, or to a skill)");
      const targets: ModifierTarget[] = f.roll === "any" ? ["attack", "save", "check"] : [f.roll as ModifierTarget];
      return { modifiers: targets.map((target): Modifier => ({ kind: "boost", target, value })), notes };
    }
    case "attacked":
      return one({ kind: "roll", roll: "attacked", mode: f.keep as never });
    case "applied":
      if (f.outcome === "temp") return one({ kind: "temphp", value: amount });
      if (f.outcome === "your_health") return one({ kind: "instant", value: amount, heal: true, damage_type: "" });
      if (f.outcome === "strain") return one({ kind: "strain", attribute: f.strain_attr as Attribute, points: Number(f.points) });
      if (f.outcome === "relieve") return one({ kind: "strain", attribute: f.strain_attr as Attribute, points: -Number(f.points) });
      if (save) notes.push("damage as it's applied has no save in the engine (the condition's own save as it lands covers that)");
      return one({ kind: "instant", value: amount, heal: false, damage_type: f.type as never });
    case "start":
      if (f.outcome === "your_health") return none("healing at the start of a round needs triggers that heal");
      return triggerOutcome("start");
    case "end":
      if (f.outcome === "your_health") return one({ kind: "periodic", value: amount, heal: true, damage_type: "" });
      if (save) notes.push("damage at the end of a round has no save in the engine yet (the start-of-round kind does)");
      return one({ kind: "periodic", value: amount, heal: false, damage_type: f.type as never });
    case "hitting":
      if (f.outcome === "it_takes" && !save && f.reach !== "melee") return one({ kind: "extra", value: amount, damage_type: f.type as never, when: "dealing" });
      return triggerOutcome("hitting");
    case "hit":
      if (f.outcome === "you_take_extra") return none("extra damage on hits against you from anyone isn't in the engine yet: only from the creature that applied this (that opening)");
      return triggerOutcome("hit");
    case "hit_by_source":
      return one({ kind: "extra", value: amount, damage_type: f.type as never, when: "taking" });
    case "damaged":
      notes.push(`"when you take damage" isn't a trigger event in the engine yet`);
      if (f.outcome === "your_stat") return { modifiers: [], notes, creates: { name: `${signed(amount)} ${f.stat}`, effect: [{ kind: "boost", target: f.stat as ModifierTarget, value: signed(amount) }], rounds: Number(f.rounds), reapply: "stack", stack_limit: Number(f.stack_limit ?? 0) } };
      return { modifiers: [], notes };
    case "moves":
      return triggerOutcome("moves");
  }
  return { modifiers: [], notes };
}
