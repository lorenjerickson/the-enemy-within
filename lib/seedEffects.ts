import type { Duration, Lifecycle, Modifier } from "@/lib/conditions";
import { CONDITION_SENTENCE, MADE_CONDITION, compile, compileLifecycle, readRule } from "@/lib/effectGrammar";

/**
 * Catalog effects added once at start-up (`seedCatalogEffects` in lib/db.ts), written as the effect builder's
 * sentences: what it does, then how long it lasts. Once added they're the GM's: edited, renamed or deleted, they stay so.
 */
export const SEEDED_EFFECTS: { name: string; description: string; rules: string[]; lasts: string[] }[] = [
  { name: "Festering", description: "Phossy Jaw's bite.", rules: ["At the end of each round, you take 1d4 necrotic damage (DC 12 Fortitude save for none)", "Your Charisma decreases by 2"], lasts: ["It lasts 3 rounds"] },
  { name: "Miasmic", description: "Phossy Jaw's glowing vapour.", rules: ["Within 10 feet of you enemies gain the Sickly effect"], lasts: ["It lasts always"] },
  { name: "Electrified", description: "The Galvanic Lurker's charge.", rules: ["You are immune to lightning damage", "When a creature hits you with a melee attack, it takes 1d6 lightning damage (DC 12 Agility save for half)"], lasts: ["It lasts always"] },
  { name: "Jolted", description: "A Lurker's touch, live wires.", rules: ["When this is applied, you take 1d6 lightning damage", "You can't take reactions", "You are vulnerable to lightning damage"], lasts: ["It lasts 1 rounds"] },
  { name: "Stiffened", description: "Sovereign's Parasite: flesh turning to statue.", rules: ["You are resistant to slashing damage", "You are resistant to piercing damage", "You are vulnerable to bludgeoning damage", "Your Agility decreases by 2", "When this is applied, strain your Sanity by 1"], lasts: ["It lasts 3 rounds", "You can end it with a DC 12 Fortitude save at the end of each round", "If it's applied again, another copy runs alongside"] },
  { name: "Choking", description: "The Soot-lung Leviathan's breath, tunnel smoke.", rules: ["You can't take bonus actions", "At the end of each round, you take 1d4 poison damage (DC 12 Fortitude save for none)"], lasts: ["It lasts 2 rounds"] },
  { name: "Corroded", description: "The Stagnant Weeper's burning hair.", rules: ["At the start of each round, you take 1d4 acid damage (DC 12 Might save for none)", "Your defense decreases by 2"], lasts: ["It lasts 10 rounds", "You can end it with a DC 12 Might save at the end of each round"] },
  { name: "Feverish", description: "The Blind Boiler's biting fever.", rules: ["At the end of each round, you take 1d4 fire damage", "Your Might decreases by 2"], lasts: ["It lasts 10 rounds", "You can end it with a DC 12 Fortitude save at the end of each round", "If it's applied again, nothing happens"] },
  { name: "Unnerved", description: "The Brake Screamer's shriek; horror.", rules: ["When this is applied, strain your Sanity by 1", "When you make a Sanity saving throw, roll it twice and use the lower result", "When you make a Perception check, subtract 2 from the roll"], lasts: ["It lasts 3 rounds"] },
  { name: "Steadfast", description: "A steadying word: Theosophist, Medium, Nurse.", rules: ["When this is applied, relieve 1 strain from your Sanity", "When you make a Sanity saving throw, add 1d4 to the roll"], lasts: ["It lasts 3 rounds"] },
  { name: "Marked", description: "Singled out by a Detective or Sniper.", rules: ["When the source hits you, add 1d6 piercing damage"], lasts: ["It lasts 3 rounds"] },
  { name: "Ruthless", description: "Soldiers and gangsters.", rules: ["Your attacks score a critical hit on a d20 roll of 19 or higher"], lasts: ["It lasts 2 rounds"] },
  { name: "Bolstered", description: "Orderly, Head Nurse.", rules: ["When this is applied, you gain 1d4+2 temporary health"], lasts: ["It lasts 10 rounds"] },
  { name: "Vigilant", description: "Beat Cop, Sergeant: planned as the round's reaction.", rules: ["When a creature attacks you (using your reaction), it gains the Hampered effect"], lasts: ["It lasts 1 rounds", "It ends when one of its triggers fires"] },
  { name: "Nocturnal", description: "Giant Rat, Blind Boiler.", rules: ["Your darkvision is raised to 60 feet"], lasts: ["It lasts always"] },
  { name: "Fleet", description: "Courier, Street Rat.", rules: ["Your speed is doubled"], lasts: ["It lasts 1 rounds"] },
  { name: "Lucky", description: "Fortune Teller, Astrologer.", rules: ["When you make an attack roll, reroll a d20 roll of 1 or lower and use the new result", "When you make a saving throw, reroll a d20 roll of 1 or lower and use the new result"], lasts: ["It lasts 3 rounds"] },
  { name: "Meticulous", description: "Surgeon, Engineer.", rules: ["When you make a Medicine check, treat any d20 roll below 10 as that number", "When you make an Engineering check, treat any d20 roll below 10 as that number"], lasts: ["It lasts 3 rounds"] },
  { name: "Reinforced", description: "Leatherworker-made coats and vests.", rules: ["Critical hits against you are normal hits"], lasts: ["It lasts while equipped"] },
  { name: "Frenzied", description: "Brake Screamer, Soot-lung Leviathan.", rules: ["When you take damage, your damage increases by 1 for 3 rounds (up to 3 times)"], lasts: ["It lasts always"] },
  { name: "Warded", description: "Magus, Theosophist.", rules: ["You are resistant to necrotic damage", "You are resistant to psychic damage"], lasts: ["It lasts 10 rounds", "It ends when the source stops concentrating on it"] },
  { name: "Lacerated", description: "Scalpel, Sever, Slash.", rules: ["At the end of each round, you take 1 slashing damage"], lasts: ["It lasts 5 rounds", "You can end it with a DC 10 Fortitude save at the end of each round or by using your action", "If it's applied again, another copy runs alongside up to 3 copies"] },
];

export type SeedMade = { name: string; effect: Modifier[]; rounds: number; reapply: "stack"; stack_limit: number };

/**
 * A seeded effect's modifiers and lifecycle. `effectId` finds a catalog effect by name (-1: none); `make` adds an
 * effect a shortcut sentence makes ("your damage increases by 1 for 3 rounds") and returns its id. Throws on a
 * sentence that doesn't read or compile, or names an effect that isn't there.
 */
export function compileSeed(e: (typeof SEEDED_EFFECTS)[number], effectId: (name: string) => number, make: (m: SeedMade) => number): { modifiers: Modifier[]; lifecycle: Required<Lifecycle> & { duration: Duration } } {
  const names = [...e.rules.join(" ").matchAll(/the (\w+) effect/g)].map((m) => m[1]);
  const modifiers = e.rules.flatMap((text) => {
    const r = readRule(text, names);
    if (!r.complete) throw new Error(`${e.name}: "${text}" doesn't read (${r.error ?? "unfinished"})`);
    const out = compile(r.filled, effectId);
    if (!out.modifiers.length) throw new Error(`${e.name}: "${text}" can't be saved: ${out.notes.join("; ")}`);
    const madeId = out.creates ? make(out.creates as SeedMade) : 0;
    return out.modifiers.map((m) => {
      if ("condition" in m && m.condition === MADE_CONDITION) return { ...m, condition: madeId };
      if ("condition" in m && m.condition === -1) throw new Error(`${e.name}: "${text}" names an effect that isn't in the catalog`);
      return m;
    });
  });
  const { lifecycle, problem } = compileLifecycle(e.lasts.map((text) => {
    const r = readRule(text, [], CONDITION_SENTENCE);
    if (!r.complete) throw new Error(`${e.name}: "${text}" doesn't read (${r.error ?? "unfinished"})`);
    return r.filled;
  }));
  if (!lifecycle) throw new Error(`${e.name}: ${problem}`);
  return { modifiers, lifecycle };
}
