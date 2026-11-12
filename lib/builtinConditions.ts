/**
 * The built-in effects (5e's conditions, with this setting's names for Charmed and Petrified), each made of building
 * blocks below. Seeded into the catalog once each (by key); the GM can rename them and change their descriptions,
 * rounds and saves, but their rules follow the code.
 */
import type { Modifier } from "@/lib/conditions";
import { DAMAGE_TYPES } from "@/lib/actions";
import { ATTRIBUTES } from "@/lib/attributes";

/** Building blocks the built-ins share (before 2026-11-13 they were catalog effects of their own, with these keys). */
export const BUILTIN_PIECES: { key: string; name: string; description: string; modifiers: Modifier[] }[] = [
  { key: "incapacitated", name: "Incapacitated", description: "Can't take actions, bonus actions or reactions.", modifiers: [{ kind: "forbid", what: "actions" }, { kind: "forbid", what: "bonus" }, { kind: "forbid", what: "reactions" }] },
  { key: "immobile", name: "Can't move", description: "Their speed is 0.", modifiers: [{ kind: "forbid", what: "movement" }] },
  { key: "exposed", name: "Exposed", description: "Attacks against them have advantage.", modifiers: [{ kind: "roll", roll: "attacked", mode: "advantage" }] },
  { key: "hampered", name: "Hampered", description: "Their attacks have disadvantage.", modifiers: [{ kind: "roll", roll: "attack", mode: "disadvantage" }] },
  { key: "clumsy", name: "Clumsy", description: "Disadvantage on Agility saves.", modifiers: [{ kind: "roll", roll: "save:agility", mode: "disadvantage" }] },
  { key: "limp", name: "Limp", description: "Fails Might and Agility saves.", modifiers: [{ kind: "autofail", save: "might" }, { kind: "autofail", save: "agility" }] },
  { key: "fear", name: "Fear", description: "Disadvantage on attacks and ability checks.", modifiers: [{ kind: "roll", roll: "attack", mode: "disadvantage" }, ...ATTRIBUTES.map((a): Modifier => ({ kind: "roll", roll: `check:${a}`, mode: "disadvantage" }))] },
  { key: "sickly", name: "Sickly", description: "Disadvantage on attacks and ability checks (poison in the blood).", modifiers: [{ kind: "roll", roll: "attack", mode: "disadvantage" }, ...ATTRIBUTES.map((a): Modifier => ({ kind: "roll", roll: `check:${a}`, mode: "disadvantage" }))] },
  { key: "unseen", name: "Unseen", description: "Invisible: hidden from anyone who can't see invisible things; against them, advantage on their attacks and disadvantage on attacks against them.", modifiers: [{ kind: "sense", sense: "invisible" }] },
  { key: "sightless", name: "Sightless", description: "Sees only what's within 5 ft.", modifiers: [{ kind: "sense", sense: "blind" }] },
  { key: "see-invisible", name: "See invisible", description: "Sees invisible creatures as if they were visible.", modifiers: [{ kind: "sense", sense: "seeinvisible" }] },
  { key: "spellbound", name: "Spellbound", description: "Can't attack whoever put them in this state.", modifiers: [{ kind: "forbid", what: "attack-source" }] },
  { key: "crawling", name: "Crawling", description: "Moves at half speed.", modifiers: [{ kind: "speed", factor: 0.5 }] },
  { key: "rigid", name: "Rigid", description: "Resistant to all damage.", modifiers: DAMAGE_TYPES.map((t): Modifier => ({ kind: "resist", damage_type: t, level: "resistant" })) },
];

/** The built-ins as the pieces they're made of. */
export const BUILTIN_CONDITIONS: { key: string; name: string; description: string; effects: string[] }[] = [
  { key: "incapacitated", name: "Incapacitated", description: "Can't act or react.", effects: ["incapacitated"] },
  { key: "prone", name: "Prone", description: "On the ground: half speed; their attacks have disadvantage, attacks against them advantage.", effects: ["crawling", "hampered", "exposed"] },
  { key: "restrained", name: "Restrained", description: "Held fast: can't move, attacks hampered, easy to hit, clumsy.", effects: ["immobile", "hampered", "exposed", "clumsy"] },
  { key: "grappled", name: "Grappled", description: "Held: can't move.", effects: ["immobile"] },
  { key: "stunned", name: "Stunned", description: "Reeling: can't act, react or move; fails Might and Agility saves; easy to hit.", effects: ["incapacitated", "immobile", "limp", "exposed"] },
  { key: "paralyzed", name: "Paralyzed", description: "Frozen: can't act, react or move; fails Might and Agility saves; easy to hit.", effects: ["incapacitated", "immobile", "limp", "exposed"] },
  { key: "unconscious", name: "Unconscious", description: "Out cold: can't act, react or move; fails Might and Agility saves; easy to hit.", effects: ["incapacitated", "immobile", "limp", "exposed"] },
  { key: "frightened", name: "Frightened", description: "Terrified: disadvantage on attacks and ability checks.", effects: ["fear"] },
  { key: "blinded", name: "Blinded", description: "Can't see: only perceives what's within 5 ft; their attacks have disadvantage, attacks against them advantage.", effects: ["sightless", "hampered", "exposed"] },
  { key: "deafened", name: "Deafened", description: "Can't hear (no rules effect yet).", effects: [] },
  { key: "invisible", name: "Invisible", description: "Unseen: advantage on attacks, attacks against them have disadvantage.", effects: ["unseen"] },
  { key: "poisoned", name: "Poisoned", description: "Disadvantage on attacks and ability checks.", effects: ["sickly"] },
  { key: "hypnotized", name: "Hypnotized", description: "Entranced (5e Charmed): can't attack whoever hypnotized them.", effects: ["spellbound"] },
  { key: "catatonic", name: "Catatonic", description: "Locked rigid (5e Petrified, minus the stone): can't act, react or move; fails Might and Agility saves; easy to hit; resists all damage.", effects: ["incapacitated", "immobile", "limp", "exposed", "rigid"] },
];

/** The built-in effects, each with every rule of its pieces. */
export const BUILTIN_EFFECTS: { key: string; name: string; description: string; modifiers: Modifier[] }[] = BUILTIN_CONDITIONS.map((c) => ({
  key: c.key, name: c.name, description: c.description, modifiers: c.effects.flatMap((k) => BUILTIN_PIECES.find((p) => p.key === k)?.modifiers ?? []),
}));
