import { MAX_SCORE, MIN_SCORE, modifier, type Attributes } from "./attributes";
import { rollDice } from "./dice";
import {
  addCreatureToken, setTokenHp, isPortraitLevel, listStructures, type MapStructure, getEncounter, getLevelPlace, saveEncounter, getVars, listCharacterStates, listCreatures, listLocations, listTokens, moveToken, saveCharacterState, saveVars, transaction,
  type VarValue,
} from "./db";
import { Collection, FREEFORM, Method, ScriptError, Tags, runScript, spread, toPlain } from "./script";
import { makeEncounter, rollsFor, type Actor, type EncounterState } from "./encounter";
import { fallDice, floorsUnder, hasFloors, landingRow, snapHeight } from "./gravity";

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

export type { Actor };

export interface GameLocation {
  id: number;
  name: string;
}

/** The location a script runs on (a map button's), with what's on that button's map level. */
export interface CurrentLocation extends GameLocation {
  level: string;
  actors: Collection<Actor>;
  creatures: Collection<Actor>;
  /** The encounter on this level: active, round, actor, order, begin(actors, rolls), next(), end(). */
  encounter: Record<string, unknown>;
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
  startHp: Map<Actor, number | null>; // creature tokens' saved health
  encounter: () => EncounterState | null;
  portrait: boolean; // gravity applies
  structures: MapStructure[];
}

function loadLocation(levelId: number, players: Player[]): [CurrentLocation, ActorChanges] {
  const place = getLevelPlace(levelId);
  if (!place) throw new ScriptError("This map level no longer exists");
  const changes: ActorChanges = {
    levelId, added: new Map(), start: new Map(), startHp: new Map(), encounter: () => null,
    portrait: isPortraitLevel(levelId), structures: listStructures(levelId),
  };
  const templates = listCreatures();
  const characters = listCharacterStates();
  const attributesOf = (t: { creature_id: number | null; character_id: number | null }) =>
    (t.character_id ? characters.find((c) => c.id === t.character_id) : templates.find((c) => c.id === t.creature_id))?.attributes ?? {};
  const actors = listTokens(levelId).map((t): Actor => {
    const a: Actor = {
      id: t.id,
      name: t.name,
      type: t.character_id ? "character" : "creature",
      position: { col: t.col, row: t.row },
      rolls: rollsFor(attributesOf(t)),
      health: 0,
    };
    const player = t.character_id ? players.find((p) => p.id === t.character_id) : undefined;
    if (player) {
      Object.defineProperty(a, "health", { enumerable: true, get: () => player.health, set: (v: number) => (player.health = v) });
    } else {
      const template = templates.find((c) => c.id === t.creature_id);
      a.health = t.hp ?? rollDice(template?.health || "0");
      changes.startHp.set(a, t.hp);
    }
    changes.start.set(a, `${t.col},${t.row}`);
    return a;
  });
  let nextId = -1;
  // add('giant rat') returns the new creature; add('giant rat', 3) returns a group of them.
  const creatures = new Collection("creature", actors.filter((a) => a.type === "creature"), (name, count) => {
    const template = templates.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!template) throw new ScriptError(`No creature named "${name}" (see Campaign › Creatures)`);
    const added = Array.from({ length: count }, (): Actor => {
      const a: Actor = {
        id: nextId--, name: template.name, type: "creature", position: null,
        rolls: rollsFor(template.attributes), health: rollDice(template.health || "0"),
      };
      changes.added.set(a, template.id);
      creatures.items.push(a);
      actorsColl.items.push(a);
      return a;
    });
    return count === 1 ? added[0] : new Collection("creature", added);
  });
  const actorsColl = new Collection("actor", actors);
  // The saved encounter, with token ids turned back into actors (tokens removed since are dropped).
  const saved = getEncounter(levelId);
  const order = (saved?.order ?? []).flatMap((o) => {
    const actor = actors.find((a) => a.id === o.token_id);
    return actor ? [{ actor, initiative: o.initiative }] : [];
  });
  const { encounter, state } = makeEncounter(
    actorsColl,
    saved && order.length ? { order, round: saved.round, turn: Math.min(saved.turn, order.length - 1) } : null
  );
  changes.encounter = state;
  return [{ id: place.location_id, name: place.location, level: place.level, actors: actorsColl, creatures, encounter }, changes];
}

function saveActors(changes: ActorChanges, location: CurrentLocation): void {
  for (const a of location.actors.items) {
    const creatureId = changes.added.get(a);
    if (creatureId !== undefined) {
      if (!a.position) throw new ScriptError(`${a.name} was added but never placed; use place(...)`);
      a.id = addCreatureToken(changes.levelId, creatureId, a.position.col, a.position.row, Math.round(a.health));
      continue;
    }
    if (a.position && changes.start.get(a) !== `${a.position.col},${a.position.row}`) {
      moveToken(a.id, a.position.col, a.position.row); // already whole cells, or snapped heights on portrait maps
    }
    // Creature tokens keep their own health (rolled on first use); characters' is saved with the player.
    if (changes.startHp.has(a) && changes.startHp.get(a) !== Math.round(a.health)) setTokenHp(a.id, Math.round(a.health));
  }
  // After the inserts above, so new creatures have their token ids.
  const e = changes.encounter();
  saveEncounter(changes.levelId, e && { round: e.round, turn: e.turn, order: e.order.map((o) => ({ token_id: o.actor.id, initiative: o.initiative })) });
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
  const [current, changes] = levelId === undefined ? [null, null] : loadLocation(levelId, players);
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
function mapHelpers(game: Game, changes: ActorChanges | null) {
  const location = () => {
    if (!game.locations.current) throw new ScriptError("There's no current location; run this from a map button");
    return game.locations.current as CurrentLocation;
  };
  const portrait = !!changes?.portrait;
  const structures = changes?.structures ?? [];
  /** Whether an actor already occupies this spot (same column, overlapping height). */
  const taken = (c: Cell) =>
    location().actors.items.some((a) => a.position && a.position.col === c.col && Math.abs(a.position.row - c.row) < 0.5);
  /** A position from script values: whole cells, except heights on portrait maps. */
  const toCell = (at: Cell): Cell => ({ col: Math.round(at.col), row: portrait ? snapHeight(at.row) : Math.round(at.row) });
  /** Where something here comes to rest: on portrait maps it falls to the floor below. */
  const settle = (c: Cell): Cell => (portrait ? { col: c.col, row: landingRow(structures, c.col, c.row) } : c);
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  /** A random free spot next to a position, widening the search until one is found. */
  const freeNear = ({ col, row }: Cell): Cell => {
    if (portrait && hasFloors(structures)) {
      // Side-on: the spots are the floors in nearby columns; nearest by columns across and cells of height.
      const spots = Array.from({ length: 41 }, (_, i) => col - 20 + i).flatMap((c) =>
        c < 0 ? [] : floorsUnder(structures, c).map((y) => ({ col: c, row: y - 1 }))
      );
      const free = spots.filter((s) => !(s.col === col && Math.abs(s.row - row) < 0.5) && !taken(s));
      if (!free.length) throw new ScriptError("No free spot on a floor near that position");
      const distance = (s: Cell) => Math.ceil(Math.max(Math.abs(s.col - col), Math.abs(s.row - row)));
      const best = Math.min(...free.map(distance));
      return pick(free.filter((s) => distance(s) === best));
    }
    for (let r = 1; r <= 20; r++) {
      const free: Cell[] = [];
      for (let dc = -r; dc <= r; dc++)
        for (let dr = -r; dr <= r; dr++) {
          const c = { col: col + dc, row: row + dr };
          if (Math.max(Math.abs(dc), Math.abs(dr)) === r && c.col >= 0 && c.row >= 0 && !taken(c)) free.push(c);
        }
      if (free.length) return pick(free);
    }
    throw new ScriptError("No free cell near that position");
  };
  return {
    /** A random free cell next to a position, actor or group. */
    near: new Method((pos) => freeNear(asCell(pos, "near()"))),
    /**
     * Puts an actor, or each of a group, at a position: setting up the scene, so no fall damage.
     * On portrait maps it drops to the floor below. The first goes there if it's free; the rest
     * (or all, if it's taken) go to free cells around it.
     */
    place: new Method((target, pos) => {
      const members = target instanceof Collection ? (target.items as Actor[]) : [target as Actor];
      for (const a of members) if (!location().actors.items.includes(a)) throw new ScriptError("place() needs actors on the current map");
      const at = asCell(pos, "place()");
      const cell = settle(toCell(at));
      for (const a of members) {
        a.position = null;
        a.position = taken(cell) ? freeNear(cell) : cell;
      }
      return target;
    }),
    /**
     * Moves an actor during play (e.g. pushed off a ledge). On portrait maps it falls to the floor below
     * and takes fall damage: 1d6 per 10 ft (2 cells). Returns the damage taken.
     */
    move: new Method((actor, pos) => {
      const a = actor as Actor;
      if (!location().actors.items.includes(a)) throw new ScriptError("move() needs an actor on the current map");
      if (!a.position) throw new ScriptError(`${a.name} isn't placed yet; use place() to put it in the scene`);
      const at = asCell(pos, "move()");
      const target = toCell(at);
      const landed = settle(target);
      a.position = landed;
      const dice = fallDice(landed.row - target.row);
      const damage = dice > 0 ? rollDice(`${dice}d6`) : 0;
      a.health = Math.max(0, a.health - damage);
      return damage;
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
  const result = runScript(source, { game, ...HELPERS, ...mapHelpers(game, changes) });
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
