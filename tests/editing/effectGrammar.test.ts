import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONDITION_SENTENCE, EFFECT_SENTENCE, MADE_CONDITION, checkRule, compile, compileLifecycle, effectSentences, effectText, idsUnder, lifecycleSentences, readRule, render, sentencesOf,
} from "@/lib/effectGrammar";
import { BUILTIN_EFFECTS } from "@/lib/builtinConditions";
import type { Modifier, Trigger } from "@/lib/conditions";

// The catalog the sentences name conditions from.
const CONDITIONS: Record<number, string> = { 5: "Burning", 6: "Shielded", 7: "Frightened" };
const nameOf = (id: number) => CONDITIONS[id] ?? `#${id}`;
const idOf = (name: string) => Number(Object.entries(CONDITIONS).find(([, n]) => n === name)?.[0] ?? -1);
const names = Object.values(CONDITIONS);

const trig = (t: Partial<Trigger>): Trigger => ({ kind: "trigger", on: "hit", reach: "any", damage: "", damage_type: "", save_attr: "", save_dc: 12, save_halves: true, condition: 0, condition_on: "other", ...t });

/** Modifiers the effect form and builder can make, one of each shape. */
const SAMPLES: Modifier[] = [
  { kind: "periodic", value: "1d2", heal: false, damage_type: "poison" },
  { kind: "periodic", value: "1d4", heal: true, damage_type: "" },
  { kind: "periodic", value: "2d6", heal: false, damage_type: "acid", save_attr: "agility", save_dc: 13, save_pct: 50 },
  { kind: "periodic", value: "2d6", heal: false, damage_type: "acid", save_attr: "agility", save_dc: 13, save_pct: 25 },
  { kind: "instant", value: "1d10", heal: true, damage_type: "" },
  { kind: "instant", value: "2d6", heal: false, damage_type: "fire" },
  { kind: "temphp", value: "1d4+4" },
  { kind: "maxhp", value: 5 },
  { kind: "extra", value: "1d6", damage_type: "fire", when: "dealing" },
  { kind: "extra", value: "1d6", damage_type: "necrotic", when: "taking" },
  { kind: "forbid", what: "actions" },
  { kind: "forbid", what: "bonus" },
  { kind: "forbid", what: "reactions" },
  { kind: "forbid", what: "movement" },
  { kind: "forbid", what: "attack-source" },
  { kind: "autofail", save: "might" },
  { kind: "speed", factor: 0.5 },
  { kind: "speed", factor: 2 },
  { kind: "boost", target: "defense", value: "+2" },
  { kind: "boost", target: "attribute:might", value: "+1" },
  { kind: "boost", target: "damage", value: "-1d4" },
  { kind: "set", target: "attribute:might", value: 19 },
  { kind: "set", target: "defense", value: 13, plus: "agility" },
  { kind: "multiply", target: "damage", factor: 2 },
  { kind: "multiply", target: "defense", factor: 0.5 },
  { kind: "cap", target: "attribute:might", value: 8 },
  { kind: "cap", target: "darkvision", value: 30 },
  { kind: "sense", sense: "darkvision", range: 60 },
  { kind: "sense", sense: "blind" },
  { kind: "sense", sense: "blind", range: 10 },
  { kind: "sense", sense: "invisible" },
  { kind: "sense", sense: "seeinvisible" },
  { kind: "resist", damage_type: "fire", level: "resistant" },
  { kind: "resist", damage_type: "cold", level: "vulnerable" },
  { kind: "resist", damage_type: "poison", level: "immune" },
  { kind: "roll", roll: "attack", mode: "disadvantage" },
  { kind: "roll", roll: "attacked", mode: "advantage" },
  { kind: "roll", roll: "save:agility", mode: "disadvantage" },
  { kind: "reroll", roll: "attack", at: 1 },
  { kind: "minroll", roll: "skill:stealth", min: 10 },
  { kind: "crit", range: 19 },
  { kind: "nocrit" },
  { kind: "strain", attribute: "sanity", points: 2 },
  { kind: "strain", attribute: "sanity", points: -1 },
  { kind: "aura", condition: 7, radius: 10, who: "enemy", self: false },
  trig({ on: "hit", reach: "melee", damage: "1d6", damage_type: "fire" }),
  trig({ on: "hitting", condition: 5, condition_on: "other" }),
  trig({ on: "start", damage: "1d4", damage_type: "fire" }),
  trig({ on: "moves", damage: "2d8", damage_type: "thunder" }),
  trig({ on: "hit", damage: "2d6", damage_type: "lightning", save_attr: "agility", save_dc: 14 }),
  trig({ on: "attacked", condition: 7, condition_on: "other", reaction: true }),
  trig({ on: "would_hit", condition: 6, condition_on: "self", reaction: true }),
  trig({ on: "would_hit", reroll: true, reaction: true }),
  trig({ on: "hitting", heal: true, damage: "", amount_mod: { whose: "self", attr: "fortitude" }, damage_to: "self" }),
  trig({ on: "hitting", heal: true, damage: "1d4", damage_to: "self" }),
  trig({ on: "hit", from: "source", damage: "1d6", damage_type: "necrotic" }),
];

/** Modifiers the engine runs but the sentences can't say yet (the builder can't make them; older data might have them). */
const GAPS: [Modifier, string][] = [
  [trig({ on: "damaged", damage: "1d4", damage_type: "necrotic" }), "'When you take damage' has no 'you take … damage' outcome: renders as \"your Might increases by ? for ? rounds\""],
  [trig({ on: "hit", damage: "", amount_mod: { whose: "self", attr: "fortitude" }, damage_type: "psychic" }), "'it takes' uses a dice blank, so an attribute-modifier amount renders as \"your:fortitude\""],
];

for (const [m, todo] of [...SAMPLES.map((m) => [m, undefined] as const), ...GAPS]) {
  const label = JSON.stringify(m).slice(0, 110);
  test(`round trip: modifier → sentence → text → modifier: ${label}`, { todo }, () => {
    const texts = effectSentences([m], nameOf);
    assert.ok(texts.length >= 1, "said as at least one sentence");
    const back: Modifier[] = [];
    for (const t of texts) {
      const read = readRule(t, names);
      assert.ok(read.complete, `"${t}" didn't read back: ${read.error ?? "incomplete"}`);
      assert.equal(checkRule(read.filled), null, `"${t}" doesn't check`);
      assert.equal(render(read.filled), t, "rendering what was read gives the same text");
      const c = compile(read.filled, idOf);
      assert.deepEqual(c.notes, [], `"${t}": ${c.notes.join("; ")}`);
      back.push(...c.modifiers);
    }
    assert.deepEqual(effectSentences(back, nameOf), texts, "the compiled modifiers say the same thing");
  });
}

test("every built-in effect reads and compiles back to the same rules", () => {
  for (const e of BUILTIN_EFFECTS) {
    const texts = effectSentences(e.modifiers);
    const back = texts.flatMap((t) => {
      const read = readRule(t, names);
      assert.ok(read.complete, `${e.name}: "${t}" ${read.error}`);
      return compile(read.filled, idOf).modifiers;
    });
    const key = (m: Modifier) => JSON.stringify(m);
    assert.deepEqual(back.map(key).sort(), e.modifiers.map(key).sort(), e.name);
  }
});

test("groups are said once: resistance to every type, disadvantage on every check", () => {
  const rigid = BUILTIN_EFFECTS.find((e) => e.key === "rigid")!;
  assert.deepEqual(effectSentences(rigid.modifiers), ["You are resistant to all damage."]);
  const fear = BUILTIN_EFFECTS.find((e) => e.key === "fear")!;
  assert.equal(effectSentences(fear.modifiers).length, 2);
  assert.equal(effectText({ modifiers: [{ kind: "forbid", what: "actions" }, { kind: "forbid", what: "movement" }] }), "You can't take actions. You can't move.");
});

test("readRule: partial text offers what can come next", () => {
  const r = readRule("You can't ", names);
  assert.equal(r.complete, false);
  assert.ok(r.next.some((n) => n.text === "take reactions"));
  const typing = readRule("You can't take re", names);
  assert.equal(typing.partial, "take re".replace("take ", "") === "re" ? typing.partial : typing.partial);
  assert.ok(typing.next.some((n) => n.text === "take reactions"));
});

test("readRule: wrong words are an error, extra words too", () => {
  const bad = readRule("You can't fly.", names);
  assert.equal(bad.complete, false);
  assert.ok(bad.error);
  const extra = readRule("You can't move. Ever.", names);
  assert.match(extra.error ?? "", /extra words/);
  assert.match(readRule("When you hit a creature, it gains the Nonexistent condition.", names).error ?? "", /not a condition|choices/);
});

test("readRule ignores case and punctuation", () => {
  const r = readRule("you CAN'T move", names);
  assert.ok(r.complete);
  assert.deepEqual(compile(r.filled).modifiers, [{ kind: "forbid", what: "movement" }]);
});

test("checkRule finds blanks that are missing or out of range", () => {
  assert.match(checkRule({})!, /fill in/);
  const good = readRule("Your defense increases by 2.", names).filled;
  assert.equal(checkRule(good), null);
  assert.match(checkRule({ ...good, amount: "lots" })!, /isn't an amount/);
  assert.match(checkRule({ ...good, how: "sideways" })!, /isn't a choice/);
});

test("compile notes what the engine can't do instead of dropping it silently", () => {
  const r = readRule("Your maximum health is reduced to 10.", names);
  assert.ok(r.complete, r.error);
  const c = compile(r.filled);
  assert.deepEqual(c.modifiers, []);
  assert.equal(c.notes.length, 1);
});

test("'when you take damage, your defense increases' makes a stacking condition of its own", () => {
  const text = "When you take damage, your defense increases by 1 for 3 rounds.";
  const r = readRule(text, names);
  if (!r.complete) return assert.fail(`didn't read: ${r.error}; next: ${r.next.map((n) => n.text).join(" | ")}`);
  const c = compile(r.filled);
  assert.equal((c.modifiers[0] as Trigger).condition, MADE_CONDITION);
  assert.equal(c.creates?.rounds, 3);
  assert.equal(c.creates?.reapply, "stack");
  assert.deepEqual(c.creates?.effect, [{ kind: "boost", target: "defense", value: "+1" }]);
});

test("idsUnder lists every blank under a choice (cleared when it changes)", () => {
  const ids = idsUnder(EFFECT_SENTENCE[0]);
  assert.ok(ids.includes("amount"));
  assert.ok(ids.includes("save_dc"));
  assert.deepEqual(idsUnder({ kind: "word", text: "x" }), []);
});

test("lifecycles: sentences and back", () => {
  const lc = { rounds: 6, save_attr: "fortitude" as const, save_dc: 13, save_when: "start" as const, save_action: 1, saves_needed: 2, apply_save_attr: "wisdom" as const, apply_save_dc: 14, apply_save_outcome: "halves" as const, ends_on_damage: 1, ends_on_attack: 0, ends_on_trigger: 0, concentration: 1, reapply: "stack" as const, stack_limit: 3 };
  const sentences = lifecycleSentences(lc);
  const texts = sentences.map((f) => render(f, CONDITION_SENTENCE));
  assert.ok(texts.includes("It lasts 6 rounds."));
  const reread = texts.map((t) => {
    const r = readRule(t, names, CONDITION_SENTENCE);
    assert.ok(r.complete, `"${t}": ${r.error}`);
    return r.filled;
  });
  assert.deepEqual(compileLifecycle(reread).lifecycle, lc);
});

test("lifecycles: rounds said once, other rules at most once", () => {
  assert.match(compileLifecycle([]).problem!, /how long it lasts/);
  assert.match(compileLifecycle([{ rule: "lasts", rounds: 1 }, { rule: "lasts", rounds: 2 }]).problem!, /once, not 2 times/);
  assert.match(compileLifecycle([{ rule: "lasts", rounds: 1 }, { rule: "again", again: "ignore" }, { rule: "again", again: "stack" }]).problem!, /said twice/);
  assert.equal(render({ rule: "lasts", rounds: 1 }, CONDITION_SENTENCE), "It lasts 1 round.");
  const one = readRule("It lasts 1 round.", [], CONDITION_SENTENCE);
  assert.ok(one.complete, "singular reads too");
});

test("sentencesOf gives one sentence per rule (or group)", () => {
  assert.equal(sentencesOf([]).length, 0);
  assert.equal(sentencesOf([{ kind: "autofail", save: "might" }, { kind: "autofail", save: "agility" }]).length, 2);
});
