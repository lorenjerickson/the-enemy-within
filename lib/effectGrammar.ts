/**
 * The effect sentence grammar (draft): an effect's rules written as a player's handbook would, in the second person
 * ("you" = whoever has the effect, always), built blank by blank, each choice deciding the blanks that follow. The
 * creature that applied the condition is "the source" ("When the source hits you, add 1d6 necrotic damage."; "You
 * can't attack the source."). A rule with no
 * "When …" / "At the start of …" opening holds while the condition lasts ("You can't take reactions."); one with an
 * opening happens then. How long anything lasts is the condition's, never a rule's. One tree drives the editor,
 * validation, the text and the modifiers the engine reads; what the engine can't do yet is noted, not dropped.
 * Audit against the current effect form: docs/effect-grammar-audit.md.
 */
import { DAMAGE_TYPES, type RollKind } from "@/lib/actions";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import type { ConditionDef, Modifier } from "@/lib/conditions";
import { MODIFIER_TARGET_GROUPS, SKILLS, type ModifierTarget } from "@/lib/modifiers";
import { isDiceFormula } from "@/lib/itemTypes";

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
const types: Slot = { kind: "choice", id: "type", label: "damage type", options: [...DAMAGE_TYPES.map((t) => ({ value: t, text: t })), { value: "untyped", text: "" }] };
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
  { value: "attack-source", text: "attack the source" },
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
  { value: "minus", text: "decreases by", next: [amountSlot] },
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
/** "it takes [2d8] [fire] damage": separate damage to the other creature (Fire Shield). */
const itTakes: Option = { value: "it_takes", text: "it takes", next: [dice, types, word("damage"), SAVE] };
/** "add [1d6] [lightning] damage": more damage on the hit itself (a flaming blade; a Hex). */
const addDamage = (value: string, withSave: boolean): Option => ({ value, text: "add", next: [dice, types, word("damage"), ...(withSave ? [SAVE] : [])] });
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
    { value: "hitting", text: "When you hit a creature", next: [WITH, outcome([addDamage("add", true), youTake, yourHealth, itGains, youGain])] },
    { value: "hit", text: "When a creature hits you", next: [WITH, outcome([itTakes, addDamage("you_take_extra", false), itGains, youGain])] },
    { value: "hit_by_source", text: "When the source hits you", next: [outcome([addDamage("add", false)])] }, // the source: whoever applied the condition
    { value: "damaged", text: "When you take damage", next: [{ kind: "optional", id: "from", lead: "from", slots: [word("the source")] }, outcome([yourStatFor, yourHealth, youGain])] },
    { value: "moves", text: "When you move", next: [outcome([youTake, youGain])] },
  ],
}];

/** A sentence's filled blanks, by slot id (an amount from a modifier: `amount` = "your:fortitude" / "its:might"). */
export type Filled = Record<string, string | number>;
/** A condition a shortcut sentence makes for itself (a stacking bonus): its name, its one effect's modifiers and its lifecycle. */
export type MadeCondition = { name: string; effect: Modifier[]; rounds: number; reapply: "stack"; stack_limit: number };
export type Compiled = { modifiers: Modifier[]; notes: string[]; creates?: MadeCondition };
/** Stands for the condition a shortcut sentence makes, until it's saved and has an id. */
export const MADE_CONDITION = -2;

const signed = (v: string) => (/^[+-]/.test(v) ? v : `+${v}`);
/** The engine's roll kinds for a "which roll" choice (a group: one per attribute). */
const rollKinds = (r: string): RollKind[] =>
  r === "save" ? ATTRIBUTES.map((a) => `save:${a}` as const) : r === "check" ? ATTRIBUTES.map((a) => `check:${a}` as const) : r === "any" ? ["attack", ...rollKinds("save"), ...rollKinds("check")] : [r as RollKind];

/**
 * Turns a complete sentence into the modifiers the engine reads (most rules are one; "any d20 roll" and the like are
 * several), with notes on anything it can't do yet. `conditionId` looks a catalog condition up by name.
 */
export function compile(rule: Filled, conditionId: (name: string) => number = () => -1): Compiled {
  const f: Filled = rule.type === "untyped" ? { ...rule, type: "" } : rule; // untyped damage
  const notes: string[] = [];
  const one = (m: Modifier): Compiled => ({ modifiers: [m], notes });
  const none = (note: string): Compiled => ({ modifiers: [], notes: [...notes, note] });
  const save = f.save_attr !== undefined, half = f.save_for !== "none";
  const triggered = ["start", "hitting", "hit", "damaged", "moves"].includes(String(f.when)) && f.outcome !== "your_stat";
  if (typeof f.amount === "string" && f.amount.includes(":") && !triggered) notes.push(`an amount from ${f.amount.split(":")[0]} ${f.amount.split(":")[1]} modifier isn't in the engine yet here (only in rules that happen when something happens)`);
  const amount = String(f.dice ?? f.amount);
  const cond = f.condition !== undefined ? conditionId(String(f.condition)) : 0;
  const trigger = (on: "hit" | "hitting" | "start" | "moves" | "damaged", extra: Partial<Extract<Modifier, { kind: "trigger" }>> = {}): Modifier => ({
    kind: "trigger", on, reach: f.reach === "melee" ? "melee" : "any", damage: "", damage_type: "", save_attr: save ? (f.save_attr as Attribute) : "", save_dc: save ? Number(f.save_dc) : 12, save_halves: half, condition: 0, condition_on: "other", ...extra,
  });
  /** An amount as a trigger has it: dice (or a number), or an attribute's modifier (yours, or the other creature's). */
  const amountOf = (): Partial<Extract<Modifier, { kind: "trigger" }>> => {
    const a = String(f.dice ?? f.amount);
    if (!a.includes(":")) return { damage: a };
    const [whose, attr] = a.split(":");
    return { damage: "", amount_mod: { whose: whose === "its" ? "other" : "self", attr: attr as Attribute } };
  };
  const triggerOutcome = (on: "hit" | "hitting" | "start" | "moves" | "damaged"): Compiled => {
    const from = f.from !== undefined ? { from: "source" as const } : {};
    if (f.outcome === "it_takes") return one(trigger(on, { ...amountOf(), damage_type: f.type as never, ...from }));
    if (f.outcome === "it_gains") return one(trigger(on, { condition: cond, condition_on: "other", ...from }));
    if (f.outcome === "you_gain") return one(trigger(on, { condition: cond, condition_on: "self", ...from }));
    if (f.outcome === "you_take" || f.outcome === "you_take_extra") return one(trigger(on, { ...amountOf(), damage_type: f.type as never, damage_to: on === "start" || on === "moves" ? undefined : "self", ...from })); // backwash; more damage on hits against you
    if (f.outcome === "your_health") return one(trigger(on, { ...amountOf(), heal: true, damage_to: "self", ...from }));
    return none("that outcome isn't in the engine yet");
  };
  switch (f.when) {
    case "you":
      if (f.cant === "see") return one({ kind: "sense", sense: "blind", ...(Number(f.feet) !== 5 ? { range: Number(f.feet) } : {}) });
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
      if (f.how === "max") return f.stat === "health" ? none("maximum health can't be capped yet") : one({ kind: "cap", target: f.stat as ModifierTarget | "darkvision", value: Number(f.to) });
      if (f.stat === "darkvision") return one({ kind: "sense", sense: "darkvision", range: Number(f.to) });
      const target = f.stat as ModifierTarget;
      if (f.how === "min") return one({ kind: "set", target, value: Number(f.to), ...(f.plus_attr ? { plus: f.plus_attr as Attribute } : {}) });
      if (String(f.how).startsWith("x")) return one({ kind: "multiply", target, factor: Number(String(f.how).slice(1)) });
      const by = f.how === "minus" ? `-${amount.replace(/^[+-]/, "")}` : amount;
      if (f.stat === "health") return /^[+-]?\d+$/.test(by) ? one({ kind: "maxhp", value: Number(by) }) : none("maximum health takes a plain number, not dice");
      return one({ kind: "boost", target, value: signed(by) });
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
      return triggerOutcome("start");
    case "end":
      if (f.outcome === "your_health") return one({ kind: "periodic", value: amount, heal: true, damage_type: "" });
      if (save) notes.push("damage at the end of a round has no save in the engine yet (the start-of-round kind does)");
      return one({ kind: "periodic", value: amount, heal: false, damage_type: f.type as never });
    case "hitting":
      if (f.outcome === "add" && !save && f.reach !== "melee") return one({ kind: "extra", value: amount, damage_type: f.type as never, when: "dealing" });
      if (f.outcome === "add") return one(trigger("hitting", { damage: amount, damage_type: f.type as never })); // with a save, or melee only: a trigger
      return triggerOutcome("hitting");
    case "hit":
      return triggerOutcome("hit");
    case "hit_by_source":
      return one({ kind: "extra", value: amount, damage_type: f.type as never, when: "taking" });
    case "damaged":
      // "Your [defense] increases by [1] for [3] rounds": a stacking condition made for it (its id once saved: MADE_CONDITION).
      if (f.outcome === "your_stat") return { modifiers: [trigger("damaged", { condition: MADE_CONDITION, condition_on: "self", ...(f.from !== undefined ? { from: "source" as const } : {}) })], notes, creates: { name: `${signed(amount)} ${f.stat}`, effect: [{ kind: "boost", target: f.stat as ModifierTarget, value: signed(amount) }], rounds: Number(f.rounds), reapply: "stack", stack_limit: Number(f.stack_limit ?? 0) } };
      return triggerOutcome("damaged");
    case "moves":
      return triggerOutcome("moves");
  }
  return { modifiers: [], notes };
}

// ---------- Sentences from modifiers (to show and edit what an effect already has) ----------

/** A blank's text in a sentence: a choice's words, a number, dice, "your Fortitude modifier", a condition's name. */
function blankText(slot: Slot, v: string | number): string {
  if (slot.kind === "amount" && typeof v === "string" && v.includes(":")) return `${v.split(":")[0]} ${cap(v.split(":")[1])} modifier`;
  return String(v);
}

/** A complete sentence's words, from its filled blanks (punctuation as the handbook would). */
export function render(f: Filled, root: Slot[] = EFFECT_SENTENCE): string {
  const out: string[] = [];
  const walk = (slots: Slot[]) => {
    for (const slot of slots) {
      if (slot.kind === "word") { if (slot.text.startsWith("it rolls twice")) out[out.length - 1] += ","; out.push(slot.text); }
      else if (slot.kind === "optional") {
        if (f[slot.id] === undefined) continue;
        const paren = slot.id === "save" || slot.id === "limit" || slot.id === "needed";
        const at = out.length;
        out.push(slot.lead);
        walk(slot.slots);
        if (paren) { out[at] = `(${out[at]}`; out[out.length - 1] += ")"; }
      } else if (slot.kind === "choice") {
        const o = slot.options.find((x) => x.value === f[slot.id]) ?? slot.options[0];
        if ((slot.id === "outcome" || slot.id === "sign") && out.length) out[out.length - 1] += ","; // after the opening
        if (o.text) out.push(o.text);
        walk(o.next ?? []);
      } else out.push(blankText(slot, f[slot.id] ?? "?"));
    }
  };
  walk(root);
  const text = out.join(" ").replace(/\b1 (rounds|copies|successes|times)\b/g, (_, w: string) => `1 ${w === "copies" ? "copy" : w.slice(0, -1)}`);
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/**
 * The sentences that say what a set of modifiers does (most modifiers are one; a group the builder says at once,
 * such as a roll mode on every saving throw or a resistance to every damage type, is one too). The inverse of
 * `compile`: compiling these gives back modifiers that do the same. `conditionName` names a catalog condition by id.
 */
export function sentencesOf(modifiers: Modifier[], conditionName: (id: number) => string = (id) => `#${id}`): Filled[] {
  let left = [...modifiers];
  const out: Filled[] = [];
  /** Takes a group of modifiers out if every one is there; returns whether it did. */
  const take = (group: Modifier[]): boolean => {
    const keys = group.map((g) => JSON.stringify(g)), found = keys.map((k) => left.findIndex((m) => JSON.stringify(m) === k));
    if (found.some((i) => i < 0)) return false;
    left = left.filter((_, i) => !found.includes(i));
    return true;
  };
  // Groups first: resistances to all damage; a roll mode, reroll or minimum on a whole group of rolls; dice on any d20 roll.
  for (const level of ["resistant", "vulnerable", "immune"] as const)
    if (take(DAMAGE_TYPES.map((damage_type): Modifier => ({ kind: "resist", damage_type, level })))) out.push({ when: "are", are: level, type: "all" });
  for (const r of ["any", "save", "check"]) {
    for (const mode of ["advantage", "disadvantage"] as const) if (take(rollKinds(r).map((roll): Modifier => ({ kind: "roll", roll, mode })))) out.push({ when: "roll", roll: r, sign: "twice", keep: mode });
    for (const m of left.filter((x) => x.kind === "reroll" && x.roll === rollKinds(r)[0]) as Extract<Modifier, { kind: "reroll" }>[])
      if (take(rollKinds(r).map((roll): Modifier => ({ kind: "reroll", roll, at: m.at })))) out.push({ when: "roll", roll: r, sign: "reroll", at: m.at });
    for (const m of left.filter((x) => x.kind === "minroll" && x.roll === rollKinds(r)[0]) as Extract<Modifier, { kind: "minroll" }>[])
      if (take(rollKinds(r).map((roll): Modifier => ({ kind: "minroll", roll, min: m.min })))) out.push({ when: "roll", roll: r, sign: "min", min: m.min });
  }
  for (const m of left.filter((x) => x.kind === "boost" && x.target === "attack") as Extract<Modifier, { kind: "boost" }>[])
    if (take((["attack", "save", "check"] as const).map((target): Modifier => ({ kind: "boost", target, value: m.value })))) out.push({ when: "roll", roll: "any", sign: m.value.startsWith("-") ? "-" : "+", dice: m.value.replace(/^[+-]/, "") });
  // Then one sentence per modifier.
  for (const m of left) out.push(...sentenceOf(m, conditionName));
  return out;
}

/** The sentence(s) for one modifier (a trigger with damage and a condition is two). */
function sentenceOf(m: Modifier, conditionName: (id: number) => string): Filled[] {
  const sign = (v: string) => (v.startsWith("-") ? "-" : "+"), bare = (v: string) => v.replace(/^[+-]/, "");
  switch (m.kind) {
    case "boost":
      if (m.target === "health") return [{ when: "applied", outcome: "your_health", amount: bare(m.value) }];
      if (m.target === "attack" || m.target === "save" || m.target === "check" || m.target.startsWith("save:") || m.target.startsWith("skill:")) return [{ when: "roll", roll: m.target, sign: sign(m.value), dice: bare(m.value) }];
      return [{ when: "your", stat: m.target, how: m.value.startsWith("-") ? "minus" : "plus", amount: bare(m.value) }];
    case "roll":
      return m.roll === "attacked" ? [{ when: "attacked", keep: m.mode }] : [{ when: "roll", roll: m.roll, sign: "twice", keep: m.mode }];
    case "periodic":
      return [m.heal ? { when: "end", outcome: "your_health", amount: m.value } : { when: "end", outcome: "you_take", dice: m.value, type: m.damage_type || "untyped" }];
    case "instant":
      return [m.heal ? { when: "applied", outcome: "your_health", amount: m.value } : { when: "applied", outcome: "you_take", dice: m.value, type: m.damage_type || "untyped" }];
    case "resist":
      return [{ when: "are", are: m.level, type: m.damage_type }];
    case "extra":
      return [m.when === "dealing" ? { when: "hitting", outcome: "add", dice: m.value, type: m.damage_type || "untyped" } : { when: "hit_by_source", outcome: "add", dice: m.value, type: m.damage_type || "untyped" }];
    case "forbid":
      return [{ when: "you", cant: m.what }];
    case "autofail":
      return [{ when: "autofail", fail_attr: m.save }];
    case "speed":
      return [{ when: "your", stat: "speed", how: `x${m.factor}` }];
    case "set":
      return [{ when: "your", stat: m.target, how: "min", to: m.value, ...(m.plus ? { plus: 1, plus_attr: m.plus } : {}) }];
    case "multiply":
      return [{ when: "your", stat: m.target, how: `x${m.factor}` }];
    case "temphp":
      return [{ when: "applied", outcome: "temp", dice: m.value }];
    case "maxhp":
      return [{ when: "your", stat: "health", how: m.value < 0 ? "minus" : "plus", amount: String(Math.abs(m.value)) }];
    case "trigger": {
      const own = m.on === "start" || m.on === "moves";
      const from: Filled = m.from === "source" ? { from: 1 } : {};
      const amount = m.amount_mod ? `${m.amount_mod.whose === "other" ? "its" : "your"}:${m.amount_mod.attr}` : m.damage;
      if (m.heal) return [{ when: m.on, ...from, outcome: "your_health", amount }];
      // A stacking condition a shortcut made ("your defense increases by 1 for 3 rounds"): said the way it was written.
      const g = m.given, b = g?.effects.length === 1 && g.effects[0].modifiers.length === 1 ? g.effects[0].modifiers[0] : undefined;
      if (m.on === "damaged" && m.condition_on === "self" && g && g.reapply === "stack" && b?.kind === "boost" && g.name === `${b.value} ${b.target}`)
        return [{ when: "damaged", ...from, outcome: "your_stat", stat: b.target, amount: b.value.replace(/^\+/, ""), rounds: g.rounds, ...(g.stack_limit ? { limit: 1, stack_limit: g.stack_limit } : {}) }];
      if (m.damage_to === "self" && (m.damage || m.amount_mod) && !own) return [{ when: m.on, ...(m.reach === "melee" ? { with: 1, reach: "melee" } : {}), ...from, outcome: m.on === "hit" ? "you_take_extra" : "you_take", dice: amount, type: m.damage_type || "untyped", ...(m.save_attr && m.on === "hitting" ? { save: 1, save_dc: m.save_dc, save_attr: m.save_attr, save_for: m.save_halves ? "half" : "none" } : {}) }];
      const save: Filled = m.save_attr ? { save: 1, save_dc: m.save_dc, save_attr: m.save_attr, save_for: m.save_halves ? "half" : "none" } : {};
      const reach: Filled = !own && m.reach === "melee" ? { with: 1, reach: "melee" } : {};
      const out: Filled[] = [];
      if (m.damage || m.amount_mod) out.push({ when: m.on, ...reach, ...from, outcome: m.on === "hitting" ? "add" : m.on === "hit" ? "it_takes" : "you_take", dice: amount, type: m.damage_type || "untyped", ...save });
      if (m.condition) out.push({ when: m.on, ...reach, ...from, outcome: own || m.on === "damaged" || m.condition_on === "self" ? "you_gain" : "it_gains", condition: m.given?.name ?? conditionName(m.condition) });
      return out;
    }
    case "reroll":
      return [{ when: "roll", roll: m.roll, sign: "reroll", at: m.at }];
    case "minroll":
      return [{ when: "roll", roll: m.roll, sign: "min", min: m.min }];
    case "crit":
      return [{ when: "your", stat: "crit", range: m.range }];
    case "nocrit":
      return [{ when: "nocrit" }];
    case "strain":
      return [m.points >= 0 ? { when: "applied", outcome: "strain", strain_attr: m.attribute, points: m.points } : { when: "applied", outcome: "relieve", strain_attr: m.attribute, points: -m.points }];
    case "cap":
      return [{ when: "your", stat: m.target, how: "max", to: m.value }];
    case "sense":
      return [m.sense === "blind" ? { when: "you", cant: "see", feet: m.range ?? 5 } : m.sense === "invisible" ? { when: "are", are: "invisible" } : m.sense === "seeinvisible" ? { when: "can" } : { when: "your", stat: "darkvision", how: "min", to: m.range ?? 60 }];
    case "aura":
      return [{ when: "aura", radius: m.radius, who: m.who, ...(m.self ? { self: 1 } : {}), condition: m.given?.name ?? conditionName(m.condition) }];
  }
}

/** An effect's rules as handbook sentences. */
export const effectSentences = (modifiers: Modifier[], conditionName?: (id: number) => string) => sentencesOf(modifiers, conditionName).map((f) => render(f));
/** An effect's rules as one line of text (for lists). */
export const effectText = (e: { modifiers: Modifier[] }, conditionName?: (id: number) => string) => effectSentences(e.modifiers, conditionName).join(" ");

// ---------- Checking a rule (the builder and the server agree on what's complete) ----------

const isAmountText = (v: string) => isDiceFormula(v.replace(/^[+-]/, "")) || /^[+-]?\d+$/.test(v);

/** Whether a rule's blanks are all filled and valid along the path its choices take; the first problem if not. */
export function checkRule(f: Filled, root: Slot[] = EFFECT_SENTENCE): string | null {
  const walk = (slots: Slot[]): string | null => {
    for (const s of slots) {
      if (s.kind === "word") continue;
      if (s.kind === "optional") { if (f[s.id] !== undefined) { const e = walk(s.slots); if (e) return e; } continue; }
      const v = f[s.id];
      if (v === undefined || v === "") return `fill in "${s.label}"`;
      if (s.kind === "choice") {
        const o = s.options.find((x) => x.value === v);
        if (!o) return `"${v}" isn't a choice for "${s.label}"`;
        const e = walk(o.next ?? []);
        if (e) return e;
      } else if (s.kind === "dice") { if (!isAmountText(String(v))) return `"${v}" isn't dice or a number`; }
      else if (s.kind === "amount") { if (!isAmountText(String(v)) && !/^(your|its):[a-z]+$/.test(String(v))) return `"${v}" isn't an amount`; }
      else if (s.kind === "number") { const n = Number(v); if (!Number.isFinite(n) || n < (s.min ?? -Infinity) || n > (s.max ?? Infinity)) return `"${s.label}" must be ${s.min}–${s.max}`; }
    }
    return null;
  };
  return walk(root);
}

/** The ids of every blank under a choice's options (cleared when the choice changes, so nothing stale is kept). */
export function idsUnder(slot: Slot): string[] {
  const under = (slots: Slot[]): string[] => slots.flatMap((s) => (s.kind === "word" ? [] : s.kind === "optional" ? [s.id, ...under(s.slots)] : s.kind === "choice" ? [s.id, ...s.options.flatMap((o) => under(o.next ?? []))] : [s.id]));
  return slot.kind === "choice" ? slot.options.flatMap((o) => under(o.next ?? [])) : [];
}

// ---------- Reading a rule's text (the text view): what it says, or how far it got and what could come next ----------

/** What could come next where a text stops: words to type (a choice's options, fixed words) or a hint (dice, a number…). */
export type Next = { text: string; hint?: boolean };

/**
 * Reads one rule's text against the grammar (punctuation ignored, case too). Returns the blanks it filled, whether it's a
 * whole rule, a problem if the text goes wrong, and, where it stops, what could come next and the partly typed word.
 */
export function readRule(text: string, conditions: string[] = [], root: Slot[] = EFFECT_SENTENCE): { filled: Filled; complete: boolean; error?: string; next: Next[]; partial: string } {
  let rest = text.replace(/[.,()]/g, " ").replace(/\s+/g, " ").trimStart();
  const filled: Filled = {};
  const lower = (s: string) => s.toLowerCase();
  /** Takes `w` off the front (whole words only). */
  const eat = (words: string) => {
    const w = words.replace(/[.,()]/g, " ").replace(/\s+/g, " ").trim(); // fixed words may carry punctuation; the text's is dropped
    if (!w || !lower(rest).startsWith(lower(w)) || (rest.length > w.length && rest[w.length] !== " ")) return false;
    rest = rest.slice(w.length).trimStart();
    return true;
  };
  type Stop = { next: Next[]; error?: string };
  let trailing: Next[] = [];
  /** What a slot offers next (an optional part: its lead, or whatever follows it). */
  const offers = (s: Slot, after: Slot[]): Next[] => {
    if (s.kind === "word") return [{ text: s.text }];
    if (s.kind === "optional") return [{ text: s.slots[0]?.kind === "word" ? `${s.lead} ${s.slots[0].text}` : s.lead }, ...(after.length ? offers(after[0], after.slice(1)) : [{ text: "." }])]; // "up to", "or by using your action"
    if (s.kind === "choice") return s.options.filter((o) => o.text).map((o) => ({ text: o.text }));
    if (s.kind === "condition") return conditions.map((c) => ({ text: `${c} condition` }));
    if (s.kind === "amount") return [{ text: "1d6", hint: true }, { text: "your" }, { text: "its" }];
    if (s.kind === "dice") return [{ text: "2d6", hint: true }];
    return [{ text: s.label, hint: true }];
  };
  const walk = (slots: Slot[]): Stop | null => {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i], after = slots.slice(i + 1);
      if (!rest) {
        if ([s, ...after].every((x) => x.kind === "optional")) { trailing = offers(s, after).filter((n) => n.text !== "."); return null; } // whole; optional parts could still follow
        return { next: offers(s, after) };
      }
      if (s.kind === "word") { if (!eat(s.text) && !(/s$/.test(s.text) && eat(s.text.slice(0, -1)))) return { next: offers(s, after), error: `expected "${s.text}"` }; continue; } // "1 round" as well as "6 rounds"
      if (s.kind === "optional") { if (eat(s.lead)) { filled[s.id] = 1; const e = walk(s.slots); if (e) return e; } continue; }
      if (s.kind === "choice") {
        const typing = !rest.includes(" ") || s.options.some((x) => x.text && lower(x.text).startsWith(lower(rest)) && lower(x.text) !== lower(rest));
        const o = [...s.options].filter((x) => x.text).sort((a, b) => b.text.length - a.text.length).find((x) => eat(x.text))
          ?? (typing && s.options.some((x) => x.text && lower(x.text).startsWith(lower(rest))) ? undefined : s.options.find((x) => !x.text)); // a choice with no words (untyped) when nothing's being typed
        if (!o) return { next: offers(s, after), error: `not one of the choices for "${s.label}"` };
        filled[s.id] = o.value;
        const e = walk([...(o.next ?? []), ...after]);
        return e;
      }
      if (s.kind === "condition") {
        const name = [...conditions].sort((a, b) => b.length - a.length).find((c) => lower(rest).startsWith(lower(`${c} condition`)));
        if (!name) return { next: offers(s, after), error: "not a condition in the catalog" };
        rest = rest.slice(name.length).trimStart();
        filled[s.id] = name;
        continue;
      }
      const tok = rest.split(" ")[0];
      if (s.kind === "amount" && /^(your|its)$/i.test(tok)) {
        const [, attr, word] = rest.split(" ");
        if (!attr) { rest = rest.slice(tok.length).trimStart(); return { next: ATTRIBUTES.map((a) => ({ text: `${cap(a)} modifier` })) }; }
        if (!ATTRIBUTES.includes(lower(attr) as Attribute)) { rest = rest.slice(tok.length).trimStart(); return { next: ATTRIBUTES.map((a) => ({ text: `${cap(a)} modifier` })), error: `"${attr}" isn't an attribute` }; }
        if (lower(word ?? "") !== "modifier") { rest = rest.split(" ").slice(2).join(" "); return { next: [{ text: "modifier" }] }; }
        rest = rest.split(" ").slice(3).join(" ");
        filled[s.id] = `${lower(tok)}:${lower(attr)}`;
        continue;
      }
      const isNum = s.kind === "number" ? /^-?\d+$/.test(tok) : isAmountText(tok);
      if (!isNum) return { next: offers(s, after), error: s.kind === "number" ? `expected ${s.label}` : "expected dice or a number" };
      filled[s.id] = s.kind === "number" ? Number(tok) : tok;
      rest = rest.slice(tok.length).trimStart();
    }
    return null;
  };
  const stop = walk(root);
  if (!stop) return rest ? { filled, complete: false, error: `extra words: "${rest}"`, next: [], partial: "" } : { filled, complete: true, next: trailing, partial: "" };
  // Stopped: if the text left is the start of something that could come next, it's still being typed.
  const partial = stop.error ? rest : "";
  const fits = stop.next.filter((n) => !n.hint && lower(n.text).startsWith(lower(partial)));
  if (stop.error && partial && (fits.length || stop.next.some((n) => n.hint && !partial.includes(" ")))) return { filled, complete: false, next: fits.length ? fits : stop.next, partial };
  return { filled, complete: false, error: stop.error, next: stop.next, partial: stop.error ? "" : "" };
}

// ---------- A condition's lifecycle as sentences (how long it lasts, its saves, what ends it, stacking) ----------

/** A lifecycle sentence ("you" = whoever has the condition; "the source" = whoever applied it). */
export const CONDITION_SENTENCE: Slot[] = [{
  kind: "choice", id: "rule", label: "select", options: [
    { value: "lasts", text: "It lasts", next: [num("rounds", "rounds", 1, 600), word("rounds")] },
    { value: "apply_save", text: "When it's applied, a DC", next: [num("dc", "DC", 1, 40), attrs("attr"), word("save"), { kind: "choice", id: "outcome_save", label: "what a success does", options: [{ value: "negates", text: "avoids it" }, { value: "halves", text: "halves how long it lasts" }] }] },
    { value: "end_save", text: "You can end it with a DC", next: [
      num("dc", "DC", 1, 40), attrs("attr"), word("save"),
      { kind: "choice", id: "when", label: "when", options: [{ value: "end", text: "at the end of each round" }, { value: "start", text: "at the start of each round" }, { value: "damaged", text: "when you take damage" }] },
      { kind: "optional", id: "action", lead: "or", slots: [word("by using your action")] },
      { kind: "optional", id: "needed", lead: "needing", slots: [num("saves", "successes", 2, 10), word("successes")] },
    ] },
    { value: "ends", text: "It ends when", next: [{ kind: "choice", id: "ends", label: "what", options: [{ value: "damage", text: "you take damage" }, { value: "attack", text: "you attack" }, { value: "trigger", text: "one of its triggers fires" }, { value: "concentration", text: "the source stops concentrating on it" }] }] },
    { value: "again", text: "If it's applied again,", next: [{ kind: "choice", id: "again", label: "what happens", options: [
      { value: "refresh", text: "it starts over" },
      { value: "stack", text: "another copy runs alongside", next: [{ kind: "optional", id: "limit", lead: "up", slots: [word("to"), num("stack_limit", "copies at most", 2, 99), word("copies")] }] },
      { value: "ignore", text: "nothing happens" },
    ] }] },
  ],
}];

type Lifecycle = Pick<ConditionDef, "rounds" | "save_attr" | "save_dc" | "apply_save_attr" | "apply_save_dc" | "apply_save_outcome" | "save_when" | "save_action" | "saves_needed" | "ends_on_damage" | "ends_on_attack" | "ends_on_trigger" | "concentration" | "reapply" | "stack_limit">;

/** A condition's lifecycle from its sentences; a problem if one's missing or said twice. */
export function compileLifecycle(rules: Filled[]): { lifecycle?: Lifecycle; problem?: string } {
  const count = (v: string) => rules.filter((r) => r.rule === v).length;
  if (count("lasts") !== 1) return { problem: count("lasts") ? `say how long it lasts once, not ${count("lasts")} times` : "say how long it lasts (It lasts … rounds)" };
  for (const v of ["apply_save", "end_save", "again"]) if (count(v) > 1) return { problem: `"${CONDITION_SENTENCE[0].kind === "choice" ? CONDITION_SENTENCE[0].options.find((o) => o.value === v)!.text : v}…" is said twice` };
  const one = (v: string) => rules.find((r) => r.rule === v), ends = new Set(rules.filter((r) => r.rule === "ends").map((r) => r.ends));
  const lasts = one("lasts")!, apply = one("apply_save"), end = one("end_save"), again = one("again");
  return { lifecycle: {
    rounds: Number(lasts.rounds),
    apply_save_attr: apply ? (apply.attr as Attribute) : "", apply_save_dc: apply ? Number(apply.dc) : 12, apply_save_outcome: apply?.outcome_save === "halves" ? "halves" : "negates",
    save_attr: end ? (end.attr as Attribute) : "", save_dc: end ? Number(end.dc) : 12, save_when: (end?.when as "end" | "start" | "damaged") ?? "end",
    save_action: end?.action !== undefined ? 1 : 0, saves_needed: end?.needed !== undefined ? Number(end.saves) : 1,
    ends_on_damage: ends.has("damage") ? 1 : 0, ends_on_attack: ends.has("attack") ? 1 : 0, ends_on_trigger: ends.has("trigger") ? 1 : 0, concentration: ends.has("concentration") ? 1 : 0,
    reapply: (again?.again as "refresh" | "stack" | "ignore") ?? "refresh", stack_limit: again?.limit !== undefined ? Number(again.stack_limit) : 0,
  } };
}

/** A condition's lifecycle as sentences (what the builder loads). */
export function lifecycleSentences(c: Partial<Lifecycle>): Filled[] {
  const out: Filled[] = [{ rule: "lasts", rounds: c.rounds ?? 1 }];
  if (c.apply_save_attr) out.push({ rule: "apply_save", dc: c.apply_save_dc ?? 12, attr: c.apply_save_attr, outcome_save: c.apply_save_outcome ?? "negates" });
  if (c.save_attr) out.push({ rule: "end_save", dc: c.save_dc ?? 12, attr: c.save_attr, when: c.save_when ?? "end", ...(c.save_action ? { action: 1 } : {}), ...((c.saves_needed ?? 1) > 1 ? { needed: 1, saves: c.saves_needed! } : {}) });
  for (const [flag, v] of [[c.ends_on_damage, "damage"], [c.ends_on_attack, "attack"], [c.ends_on_trigger, "trigger"], [c.concentration, "concentration"]] as const) if (flag) out.push({ rule: "ends", ends: v });
  if (c.reapply && c.reapply !== "refresh") out.push({ rule: "again", again: c.reapply, ...(c.reapply === "stack" && c.stack_limit ? { limit: 1, stack_limit: c.stack_limit } : {}) });
  return out;
}
