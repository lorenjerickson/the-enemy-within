import { ATTRIBUTES, modifier, skillModifiers, type Attributes } from "./attributes";
import { rollDice } from "./dice";
import { Broadcast, Collection, MODIFIERS, Method, ScriptError } from "./script";

/** A creature or character on the current map level. */
export interface Actor {
  id: number; // negative until saved
  name: string;
  type: "creature" | "character";
  /** Grid cell; null for a creature added but not placed yet. */
  position: { col: number; row: number } | null;
  /** Fresh rolls each time they're read, e.g. rolls.initiative. */
  rolls: Rolls;
  /** Current health; a character's is its own (the same as game.players.<name>.health). */
  health: number;
}

/** Defines a read-only, computed property that scripts can read but not assign. */
function computed<T extends object>(obj: T, key: string, get: () => unknown, hint: string): void {
  Object.defineProperty(obj, key, {
    enumerable: true,
    get,
    set() {
      throw new ScriptError(`"${key}" can't be set${hint}`);
    },
  });
}

/**
 * An actor's or character's rolls. Initiative is 1d20 + agility modifier, rolled automatically.
 * (In a session, characters' rolls will prompt their player instead.)
 */
export function rollsFor(attributes: Partial<Attributes>): Rolls {
  const rolls = {} as Rolls;
  const hint = "; it's rolled each time";
  // Modifiers are read when rolled, so attribute changes made earlier in a script count.
  const full = () => Object.fromEntries(ATTRIBUTES.map((a) => [a, attributes[a] ?? 10])) as Attributes;
  const modifiers = () => {
    const f = full();
    return {
      initiative: modifier(f.agility),
      ...Object.fromEntries(ATTRIBUTES.map((a) => [a, modifier(f[a])])),
      ...Object.fromEntries(skillModifiers(f).map((s) => [s.skill.replace(/ /g, "_"), s.modifier])),
    } as Record<string, number>;
  };
  for (const key of Object.keys(modifiers())) computed(rolls, key, () => rollDice("1d20") + modifiers()[key], hint);
  // Not visible to scripts: lets coll.one find who's best at a roll.
  Object.defineProperty(rolls, MODIFIERS, { get: modifiers });
  return rolls;
}

/** Fresh rolls each time they're read: initiative, each attribute (might …) and each skill (investigation, sleight_of_hand …). */
export type Rolls = { initiative: number } & Record<string, number>;

export interface EncounterState {
  order: { actor: Actor; initiative: number }[]; // highest initiative first
  round: number; // from 1
  turn: number; // index into order
}

/** Actors (or numbers) from a script value: a single one, a group, or a coll.each list. */
const listOf = (v: unknown): unknown[] => (v instanceof Collection ? v.items : v instanceof Broadcast ? v.values : v === undefined ? [] : [v]);

/** The encounter on the current map level, as scripts see it, over a mutable state. */
export function makeEncounter(actors: Collection<Actor>, initial: EncounterState | null) {
  let state = initial;
  const encounter = {} as Record<string, unknown>;
  const hint = "; use begin, next or end";
  computed(encounter, "active", () => state !== null, hint);
  computed(encounter, "round", () => state?.round ?? 0, hint);
  computed(encounter, "actor", () => (state ? state.order[state.turn].actor : null), hint);
  computed(encounter, "order", () => new Collection("actor", state ? state.order.map((o) => o.actor) : []), hint);

  /** begin(actors, initiatives): initiatives are optional (rolled if left out) and match actors one for one. */
  encounter.begin = new Method((who, rolls) => {
    const list = listOf(who) as Actor[];
    if (!list.length) throw new ScriptError("begin() needs the actors in the encounter");
    for (const a of list) if (!actors.items.includes(a)) throw new ScriptError("begin() needs actors on the current map");
    const given = listOf(rolls);
    if (given.length && given.length !== list.length) throw new ScriptError(`begin() got ${list.length} actors but ${given.length} initiative rolls`);
    const order = list.map((actor, i) => {
      const initiative = given.length ? given[i] : actor.rolls.initiative;
      if (typeof initiative !== "number") throw new ScriptError("initiative rolls must be numbers");
      return { actor, initiative };
    });
    order.sort((a, b) => b.initiative - a.initiative);
    state = { order, round: 1, turn: 0 };
    return encounter.order;
  });
  /** next(): the next actor's turn, starting a new round after the last. Returns that actor. */
  encounter.next = new Method(() => {
    if (!state) throw new ScriptError("There's no encounter; begin one first");
    state.turn++;
    if (state.turn >= state.order.length) {
      state.turn = 0;
      state.round++;
    }
    return encounter.actor;
  });
  encounter.end = new Method(() => {
    state = null;
  });

  return { encounter, state: () => state };
}
