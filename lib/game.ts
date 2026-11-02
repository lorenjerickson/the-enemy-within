import { MAX_SCORE, MIN_SCORE, modifier, type Attributes } from "./attributes";
import { rollDice } from "./dice";
import {
  addCreatureToken, getLevelPlace, getVars, listCharacterStates, listCreatures, listLocations, listTokens, moveToken, saveCharacterState, saveVars, transaction,
  type VarValue,
} from "./db";
import { Collection, FREEFORM, Method, ScriptError, Tags, runScript, spread, toPlain } from "./script";

export type ScriptResult = { ok: true; value: string } | { ok: false; error: string };

/** A character as scripts see it. Everything here except id, name and type can be changed. */
export interface Player {
  id: number;
  name: string;
  type: string;
  attributes: Attributes;
  health: number;
  conditions: Tags;
}

/** A creature or character on the current map level. */
export interface Actor {
  id: number; // negative until saved
  name: string;
  type: "creature" | "character";
  /** Grid cell; null for a creature added but not placed yet. */
  position: { col: number; row: number } | null;
}

export interface GameLocation {
  id: number;
  name: string;
}

/** The location a script runs on (a map button's), with what's on that button's map level. */
export interface CurrentLocation extends GameLocation {
  level: string;
  actors: Collection<Actor>;
  creatures: Collection<Actor>;
}

export interface Game {
  players: Collection<Player>;
  vars: Record<string, VarValue>;
  /** All locations; `.current` is the one the script runs on. */
  locations: Collection<GameLocation>;
}

/** Bookkeeping for saving actors: the level, creatures added by the script, and where actors started. */
interface ActorChanges {
  levelId: number;
  added: Map<Actor, number>; // actor -> creature id
  start: Map<Actor, string>;
}

function loadLocation(levelId: number): [CurrentLocation, ActorChanges] {
  const place = getLevelPlace(levelId);
  if (!place) throw new ScriptError("This map level no longer exists");
  const changes: ActorChanges = { levelId, added: new Map(), start: new Map() };
  const actors = listTokens(levelId).map((t): Actor => {
    const a: Actor = { id: t.id, name: t.name, type: t.character_id ? "character" : "creature", position: { col: t.col, row: t.row } };
    changes.start.set(a, `${t.col},${t.row}`);
    return a;
  });
  let nextId = -1;
  // add('giant rat') returns the new creature; add('giant rat', 3) returns a group of them.
  const creatures = new Collection("creature", actors.filter((a) => a.type === "creature"), (name, count) => {
    const template = listCreatures().find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!template) throw new ScriptError(`No creature named "${name}" (see Campaign › Creatures)`);
    const added = Array.from({ length: count }, (): Actor => {
      const a: Actor = { id: nextId--, name: template.name, type: "creature", position: null };
      changes.added.set(a, template.id);
      creatures.items.push(a);
      actorsColl.items.push(a);
      return a;
    });
    return count === 1 ? added[0] : new Collection("creature", added);
  });
  const actorsColl = new Collection("actor", actors);
  return [{ id: place.location_id, name: place.location, level: place.level, actors: actorsColl, creatures }, changes];
}

function saveActors(changes: ActorChanges, location: CurrentLocation): void {
  for (const a of location.actors.items) {
    const creatureId = changes.added.get(a);
    if (creatureId !== undefined) {
      if (!a.position) throw new ScriptError(`${a.name} was added but never placed; use place(...)`);
      addCreatureToken(changes.levelId, creatureId, a.position.col, a.position.row);
    } else if (a.position && changes.start.get(a) !== `${a.position.col},${a.position.row}`) {
      moveToken(a.id, Math.round(a.position.col), Math.round(a.position.row));
    }
  }
}

function loadGame(levelId?: number): [Game, ActorChanges | null] {
  const players = listCharacterStates().map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    attributes: { ...c.attributes },
    // Current health starts as a roll of the character's health formula.
    health: c.hp ?? rollDice(c.health || "0"),
    conditions: new Tags(new Set(c.conditions)),
  }));
  const vars = Object.assign(Object.create(null), getVars());
  FREEFORM.add(vars);
  const [current, changes] = levelId === undefined ? [null, null] : loadLocation(levelId);
  const locations = new Collection<GameLocation>(
    "location",
    listLocations().map((l) => (l.id === current?.id ? current : { id: l.id, name: l.name }))
  );
  if (current) locations.current = current;
  return [{ players: new Collection("player", players), vars, locations }, changes];
}

function saveGame(game: Game, changes: ActorChanges | null): void {
  const clamp = (n: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n)));
  transaction(() => {
    for (const p of game.players.items) {
      const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, clamp(v)])) as Attributes;
      saveCharacterState({ id: p.id, attributes, hp: Math.round(p.health), conditions: [...p.conditions.set] });
    }
    saveVars({ ...game.vars });
    if (changes && game.locations.current) saveActors(changes, game.locations.current as CurrentLocation);
  });
}

/** Numbers from helper arguments, lists spread out. */
function numbers(args: unknown[]): number[] {
  return spread(args).map((v) => {
    if (typeof v !== "number") throw new ScriptError(`expected numbers, got ${JSON.stringify(v)}`);
    return v;
  });
}

type Cell = { col: number; row: number };

/** A position from a position, an actor, or a group of actors (the first one that's placed). */
function asCell(v: unknown, what: string): Cell {
  if (v instanceof Collection) {
    const placed = (v.items as Actor[]).find((a) => a.position);
    if (!placed) throw new ScriptError(`${what}: none of those are placed on the map`);
    return placed.position!;
  }
  if (v && typeof v === "object" && "position" in v) {
    const a = v as Actor;
    if (!a.position) throw new ScriptError(`${what}: ${a.name} isn't placed on the map`);
    return a.position;
  }
  const c = v as Cell | null;
  if (!c || typeof c !== "object" || typeof c.col !== "number" || typeof c.row !== "number") {
    throw new ScriptError(`${what} needs a position, like actor.position or near(...)`);
  }
  return c;
}

/** Helpers that need the game: placing actors on the current level. */
function mapHelpers(game: Game) {
  const location = () => {
    if (!game.locations.current) throw new ScriptError("There's no current location; run this from a map button");
    return game.locations.current as CurrentLocation;
  };
  const taken = () => new Set(location().actors.items.flatMap((a) => (a.position ? [`${a.position.col},${a.position.row}`] : [])));
  /** A random free cell next to a cell, widening the search until one is found. */
  const freeNear = ({ col, row }: Cell): Cell => {
    const used = taken();
    for (let r = 1; r <= 20; r++) {
      const free: Cell[] = [];
      for (let dc = -r; dc <= r; dc++)
        for (let dr = -r; dr <= r; dr++) {
          const c = { col: col + dc, row: row + dr };
          if (Math.max(Math.abs(dc), Math.abs(dr)) === r && c.col >= 0 && c.row >= 0 && !used.has(`${c.col},${c.row}`)) free.push(c);
        }
      if (free.length) return free[Math.floor(Math.random() * free.length)];
    }
    throw new ScriptError("No free cell near that position");
  };
  return {
    /** A random free cell next to a position, actor or group. */
    near: new Method((pos) => freeNear(asCell(pos, "near()"))),
    /**
     * Moves an actor, or each of a group, to a position. The first goes there if it's free;
     * the rest (or all, if it's taken) go to free cells around it.
     */
    place: new Method((target, pos) => {
      const members = target instanceof Collection ? (target.items as Actor[]) : [target as Actor];
      for (const a of members) if (!location().actors.items.includes(a)) throw new ScriptError("place() needs actors on the current map");
      const at = asCell(pos, "place()");
      const cell = { col: Math.round(at.col), row: Math.round(at.row) };
      for (const a of members) {
        a.position = null;
        a.position = taken().has(`${cell.col},${cell.row}`) ? freeNear(cell) : cell;
      }
      return target;
    }),
  };
}

/** Helpers scripts can call alongside `game`. */
const HELPERS = {
  roll: new Method((f) => {
    try {
      return rollDice(String(f));
    } catch (e) {
      throw new ScriptError((e as Error).message);
    }
  }),
  mod: new Method((score) => modifier(Number(score))),
  min: new Method((...a) => Math.min(...numbers(a))),
  max: new Method((...a) => Math.max(...numbers(a))),
  sum: new Method((...a) => numbers(a).reduce((s, n) => s + n, 0)),
  avg: new Method((...a) => {
    const n = numbers(a);
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : 0;
  }),
  count: new Method((...a) => spread(a).length),
};

/**
 * Runs a script against the current game state and saves what it changed. Returns the last value.
 * `levelId` is the map level the script runs on (game.locations.current); none for the Session console.
 */
export function runGameScript(source: string, levelId?: number): unknown {
  const [game, changes] = loadGame(levelId);
  const result = runScript(source, { game, ...HELPERS, ...mapHelpers(game) });
  saveGame(game, changes);
  return toPlain(result);
}

/** Runs a game script, returning its value as JSON text, or the script error. */
export function tryGameScript(source: string, levelId?: number): ScriptResult {
  try {
    return { ok: true, value: JSON.stringify(runGameScript(source, levelId), null, 2) };
  } catch (e) {
    if (e instanceof ScriptError) return { ok: false, error: e.message };
    throw e;
  }
}
