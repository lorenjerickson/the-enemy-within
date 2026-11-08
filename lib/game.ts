import { MAX_SCORE, MIN_SCORE, modifier, type Attributes } from "./attributes";
import { rollDice } from "./dice";
import { AREA_SHAPES, placeArea, type AreaShape } from "./aoe";
import type { AttackFx, Fx } from "./vfx";
import type { Point } from "./visibility";

/** How far ahead a script's effects are scheduled, so every map in the session (polling each second) catches them together. */
const FX_LEAD_MS = 1500;
import { characterHealth, saveCharacterHealth, saveTokenHealth, tokenHealth } from "./health";
import {
  getGameTime, setGameTime, listTimers, saveTimers, addTrigger, listActiveTriggers, setTriggerState, setTriggerError, logSessionEvent, type Trigger,
  getIllumination, saveIllumination, listLights, updateLight, listEffects, updateEffect, setDoorOpen, setDoorLocked,
  addCreatureToken, addMapFx, isPortraitLevel, isGridlessLevel, listStructures, type MapStructure, getEncounter, getLevelPlace, saveEncounter, getVars, listCharacterStates, listCreatures, listLocations, listTokens, moveToken, saveCharacterState, saveVars, transaction,
  type VarValue,
} from "./db";
import type { ScriptAnswers, ScriptPrompt } from "./scriptPrompt";
import { Collection, FREEFORM, Health, PromptNeeded, plain, promptHelpers, Method, ScriptError, Tags, Watch, quote, refCollection, runScript, setRef, spread, toPlain, triggerScript, truthy, type TriggerDef } from "./script";
import { makeEncounter, rollsFor, type Actor, type EncounterState, type Rolls } from "./encounter";
import { fallDice, floorsUnder, hasFloors, landingRow, snapHeight } from "./gravity";
import { OBJECTIVE_STATUSES, listObjectives, setObjectiveRevealed, setObjectiveStatus, syncObjectiveJournals, type ObjectiveStatus } from "./story";
import { objectiveSettled } from "./storyRules";

/** A script's outcome; `prompt` when it stopped to ask the GM something (run it again with the answers). */
export type ScriptResult = { ok: true; value: string } | { ok: false; error: string; prompt?: ScriptPrompt };

/** A character as scripts see it. Everything here except id, name and type can be changed. */
export interface Player {
  id: number;
  name: string;
  type: string;
  attributes: Attributes;
  /** health.current, .maximum, .temporary; plain "health" is the current value. */
  health: Health;
  conditions: Tags;
  /** Read-only: health above 0. */
  readonly alive: boolean;
  /** Fresh d20 rolls with modifiers: rolls.investigation, rolls.might, rolls.initiative … */
  rolls: Rolls;
}

/** A named timer, measured in game time. */
export interface GameTimer {
  id: number;
  name: string;
  started: number; // game minutes
  readonly elapsed: number; // game minutes since it started
  duration: number | null; // minutes until it expires; null = never
  readonly remaining: number | null; // minutes left; null if it never expires
  readonly expired: boolean; // has run for its duration
  expires: Method; // expires(3, 'days'): sets the duration, returns the timer
}

/** Game time (minutes since the campaign began) and named timers. */
export interface Calendar {
  now: number;
  timers: Collection<GameTimer>;
  advance: Method;
}

/** Time units scripts can use, in minutes. */
const UNITS: Record<string, number> = { minute: 1, hour: 60, day: 1440, week: 10080 };
function unitMinutes(unit: unknown): number {
  const u = String(unit ?? "").toLowerCase().replace(/s$/, "");
  const m = UNITS[u];
  if (!m) throw new ScriptError(`Unknown time unit "${unit}" (use minutes, hours, days or weeks)`);
  return m;
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
  /** The level's overall light as a percentage, 0 (dark) to 100 (full): the Lighting layer's global illumination. */
  illumination: number;
  lights: Collection<ScriptLight>;
  effects: Collection<ScriptEffect>;
  doors: Collection<ScriptDoor>;
}

/** A light source as scripts see it (by name, e.g. lights['lamp']). */
export interface ScriptLight { id: number; name: string; kind: string; range: number; flicker: boolean; on: boolean }
/** An effect as scripts see it. */
export interface ScriptEffect { id: number; name: string; kind: string; intensity: number; on: boolean }
/** A door as scripts see it. */
export interface ScriptDoor { id: number; name: string; open: boolean; locked: boolean }

/** An objective as scripts see it (by title, e.g. game.objectives['find holmes']). */
export interface ScriptObjective {
  id: number;
  name: string; // the title
  /** open, succeeded or failed; setting it runs the reward or penalty, as when the GM settles it. */
  status: ObjectiveStatus;
  /** The party knows about it. */
  revealed: boolean;
}

export interface Game {
  calendar: Calendar;
  objectives: Collection<ScriptObjective>;
  players: Collection<Player>;
  /** The same list as players (the party's characters). */
  characters: Collection<Player>;
  vars: Record<string, VarValue>;
  /** All locations; `.current` is the one the script runs on. */
  locations: Collection<GameLocation>;
}

/** Bookkeeping for saving actors: the level, creatures added by the script, and where actors started. */
interface ActorChanges {
  levelId: number;
  added: Map<Actor, number>; // actor -> creature id
  start: Map<Actor, string>;
  startHp: Map<Actor, string>; // creature tokens' saved health (as JSON, to spot changes)
  encounter: () => EncounterState | null;
  portrait: boolean; // gravity applies
  gridless: boolean; // positions anywhere, distances in straight lines
  structures: MapStructure[];
  fx: (() => Fx)[]; // effects the script played, made when saving (so new creatures have their token ids)
}

/** Fresh health for a new creature: the maximum rolled from its formula. */
function rolledHealth(formula: string | null | undefined): Health {
  const max = rollDice(formula || "0");
  return new Health(max, max, 0);
}

function loadLocation(levelId: number, players: Player[]): [CurrentLocation, ActorChanges] {
  const place = getLevelPlace(levelId);
  if (!place) throw new ScriptError("This map level no longer exists");
  const changes: ActorChanges = {
    levelId, added: new Map(), start: new Map(), startHp: new Map(), encounter: () => null, fx: [],
    portrait: isPortraitLevel(levelId), gridless: isGridlessLevel(levelId), structures: listStructures(levelId),
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
      health: new Health(0, 0, 0),
    };
    const player = t.character_id ? players.find((p) => p.id === t.character_id) : undefined;
    if (player) {
      Object.defineProperty(a, "health", { enumerable: true, get: () => player.health, set: (v: number) => player.health.set(v) });
    } else {
      const h = tokenHealth(t.id) ?? { current: 0, maximum: 0, temporary: 0 };
      a.health = new Health(h.current, h.maximum, h.temporary);
      changes.startHp.set(a, JSON.stringify(a.health));
    }
    changes.start.set(a, `${t.col},${t.row}`);
    return a;
  });
  let nextId = -1;
  // Everyone on the map: creature tokens and characters (players' and NPCs) alike, so "restore every creature" includes
  // a downed player character. add('giant rat') returns the new creature; add('giant rat', 3) returns a group of them.
  const creatures = new Collection("creature", [...actors], (name, count) => {
    const template = templates.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!template) throw new ScriptError(`No creature named "${name}" (see Campaign › Creatures)`);
    const added = Array.from({ length: count }, (): Actor => {
      const a: Actor = {
        id: nextId--, name: template.name, type: "creature", position: null,
        rolls: rollsFor(template.attributes), health: rolledHealth(template.health),
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
  // Things from the map's layers that scripts can switch and adjust.
  const lights = listLights(levelId).map((l): ScriptLight => ({
    id: l.id, name: l.name, kind: l.kind, range: l.radius, flicker: !!l.flicker, on: !!l.enabled,
  }));
  const effects = listEffects(levelId).map((e): ScriptEffect => ({ id: e.id, name: e.name, kind: e.kind, intensity: e.intensity, on: !!e.enabled }));
  const doors = changes.structures
    .filter((s) => s.kind === "door")
    .map((s): ScriptDoor => ({ id: s.id, name: s.name ?? `Door ${s.id}`, open: !!s.open, locked: !!s.locked }));
  return [
    {
      id: place.location_id, name: place.location, level: place.level, actors: actorsColl, creatures, encounter,
      illumination: Math.round(getIllumination(levelId) * 100),
      lights: new Collection("light", lights),
      effects: new Collection("effect", effects),
      doors: new Collection("door", doors),
    },
    changes,
  ];
}

function saveActors(changes: ActorChanges, location: CurrentLocation): void {
  for (const a of location.actors.items) {
    const creatureId = changes.added.get(a);
    if (creatureId !== undefined) {
      if (!a.position) throw new ScriptError(`${a.name} was added but never placed; use place(...)`);
      a.id = addCreatureToken(changes.levelId, creatureId, a.position.col, a.position.row);
      saveTokenHealth(a.id, a.health);
      continue;
    }
    if (a.position && changes.start.get(a) !== `${a.position.col},${a.position.row}`) {
      moveToken(a.id, a.position.col, a.position.row); // already whole cells, or snapped heights on portrait maps
    }
    // Creature tokens keep their own health (rolled on first use); characters' is saved with the player.
    if (changes.startHp.has(a) && changes.startHp.get(a) !== JSON.stringify(a.health)) saveTokenHealth(a.id, a.health);
  }
  // After the inserts above, so new creatures have their token ids.
  const e = changes.encounter();
  // Effects the script played: drawn on every map in the session, a moment from now so they all catch it together.
  const starts = Date.now() + FX_LEAD_MS;
  for (const make of changes.fx) addMapFx(changes.levelId, starts, make());
  saveEncounter(changes.levelId, e && { round: e.round, turn: e.turn, order: e.order.map((o) => ({ token_id: o.actor.id, initiative: o.initiative })) });
  // Lighting, effects and doors (small lists, so simply written back).
  saveIllumination(changes.levelId, Number(location.illumination) / 100); // scripts use percent; stored as 0..1
  for (const l of location.lights.items) updateLight(l.id, { radius: l.range, flicker: l.flicker, on: l.on });
  for (const f of location.effects.items) updateEffect(f.id, { intensity: f.intensity, on: f.on });
  for (const d of location.doors.items) {
    setDoorLocked(d.id, d.locked); // locking shuts it; unlock before opening
    setDoorOpen(d.id, d.open && !d.locked);
  }
}

function loadGame(levelId?: number): [Game, ActorChanges | null] {
  const players = listCharacterStates().map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    attributes: { ...c.attributes },
    // Maximum health is rolled once from the character's formula; current starts there.
    health: ((h) => new Health(h.current, h.maximum, h.temporary))(characterHealth(c.id)!),
    conditions: new Tags(new Set(c.conditions)),
  })) as unknown as Player[]; // `alive` and `rolls` are added just below
  const inParty = new Set(listCharacterStates().filter((c) => c.in_party).map((c) => c.id));
  for (const p of players) {
    p.rolls = rollsFor(p.attributes); // reads the attributes live, so changes made by the script count
    Object.defineProperty(p, "alive", {
      enumerable: true,
      get: () => p.health.current > 0,
      set() {
        throw new ScriptError('"alive" can\'t be set; change health instead');
      },
    });
  }
  const vars = Object.assign(Object.create(null), getVars());
  FREEFORM.add(vars);
  const [current, changes] = levelId === undefined ? [null, null] : loadLocation(levelId, players);
  const locations = new Collection<GameLocation>(
    "location",
    listLocations().map((l) => (l.id === current?.id ? current : { id: l.id, name: l.name }))
  );
  if (current) locations.current = current;
  const party = new Collection("character", players);
  // So ON can name what a script refers to again later (see setRef in lib/script.ts).
  refCollection(party, "game.characters");
  if (current) setRef(current, "game.locations.current"); // before the list names it by name
  refCollection(locations, "game.locations");
  if (current) {
    for (const key of ["actors", "creatures", "lights", "effects", "doors"] as const) {
      refCollection(current[key] as Collection<{ id: number; name: string }>, `game.locations.current.${key}`);
    }
  }
  // game.characters.party: the player characters (ticked "In the party" on the character form).
  party.extras.party = () => new Collection("party member", players.filter((p) => inParty.has(p.id)));
  const objectives = new Collection("objective", listObjectives().map(scriptObjective));
  refCollection(objectives, "game.objectives");
  return [{ players: party, characters: party, vars, locations, calendar: loadCalendar(), objectives }, changes];
}

function scriptObjective(o: { id: number; title: string; status: ObjectiveStatus; revealed: 0 | 1 }): ScriptObjective {
  let status = o.status;
  const so = { id: o.id, name: o.title, revealed: !!o.revealed } as ScriptObjective;
  Object.defineProperty(so, "status", {
    enumerable: true,
    get: () => status,
    set(v: unknown) {
      if (!OBJECTIVE_STATUSES.includes(v as ObjectiveStatus)) throw new ScriptError(`An objective's status is ${OBJECTIVE_STATUSES.map((s) => `'${s}'`).join(", ")}`);
      status = v as ObjectiveStatus;
    },
  });
  return so;
}

function loadCalendar(): Calendar {
  const calendar = { now: getGameTime() } as Calendar;
  const timer = (name: string, started: number, id: number, duration: number | null = null): GameTimer => {
    const t = { id, name, started } as GameTimer;
    const readOnly = (key: string, get: () => unknown, hint: string) =>
      Object.defineProperty(t, key, {
        enumerable: true,
        get,
        set() {
          throw new ScriptError(`"${key}" can't be set; ${hint}`);
        },
      });
    readOnly("elapsed", () => calendar.now - t.started, "change started or restart the timer");
    t.duration = duration;
    readOnly("remaining", () => (t.duration === null ? null : Math.max(0, t.duration - t.elapsed)), "change duration");
    readOnly("expired", () => t.duration !== null && t.elapsed >= t.duration, "change duration");
    // A method, so not listed when a timer is shown.
    Object.defineProperty(t, "expires", {
      enumerable: false,
      value: new Method((n, unit = "minutes") => {
        if (typeof n !== "number" || n < 0) throw new ScriptError("expires() needs a number, like expires(3, 'days')");
        t.duration = n * unitMinutes(unit);
        return t;
      }),
    });
    setRef(t, `game.calendar.timers[${quote(name)}]`);
    return t;
  };
  const timers = new Collection<GameTimer>("timer", listTimers().map((t, i) => timer(t.name, t.started, i + 1, t.duration)));
  /** Starts (or restarts) a timer from now. */
  const start = (name: string) => {
    const existing = timers.items.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.started = calendar.now;
      return existing;
    }
    const t = timer(name, calendar.now, timers.items.length + 1);
    timers.items.push(t);
    return t;
  };
  timers.adder = (name) => start(name);
  timers.extras.start = () => new Method((name) => start(String(name)));
  timers.extras.stop = () =>
    new Method((name) => {
      timers.items = timers.items.filter((t) => t.name.toLowerCase() !== String(name).toLowerCase());
    });
  calendar.timers = timers;
  /** advance(2, 'hours'): moves game time forward. */
  calendar.advance = new Method((n, unit = "minutes") => {
    if (typeof n !== "number") throw new ScriptError("advance() needs a number, like advance(2, 'hours')");
    calendar.now += n * unitMinutes(unit);
    return calendar.now;
  });
  return calendar;
}

/** Saves what a script changed. Returns the objectives it succeeded or failed, for their rewards and penalties. */
function saveGame(game: Game, changes: ActorChanges | null, triggers: TriggerDef[] = []): [number, ObjectiveStatus][] {
  const clamp = (n: number) => Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(n)));
  const before = new Map(listObjectives().map((o) => [o.id, o]));
  const settled: [number, ObjectiveStatus][] = [];
  transaction(() => {
    for (const o of game.objectives.items) {
      const was = before.get(o.id);
      if (!was) continue;
      if (was.status !== o.status) {
        setObjectiveStatus(o.id, o.status);
        if (o.status !== "open") settled.push([o.id, o.status]);
      }
      if (!!was.revealed !== o.revealed) setObjectiveRevealed(o.id, o.revealed);
    }
    for (const p of game.players.items) {
      const attributes = Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, clamp(v)])) as Attributes;
      saveCharacterState({ id: p.id, attributes, conditions: [...p.conditions.set] });
      saveCharacterHealth(p.id, p.health);
    }
    saveVars({ ...game.vars });
    setGameTime(game.calendar.now);
    saveTimers(game.calendar.timers.items.map((t) => ({ name: t.name, started: t.started, duration: t.duration })));
    for (const t of triggers) addTrigger({ ...t, level_id: changes?.levelId ?? null, created: game.calendar.now });
    if (changes && game.locations.current) saveActors(changes, game.locations.current as CurrentLocation);
  });
  return settled;
}

/** Numbers from helper arguments, lists spread out. */
function numbers(args: unknown[]): number[] {
  return spread(args).map((v) => {
    v = plain(v);
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
  const gridless = !!changes?.gridless;
  const structures = changes?.structures ?? [];
  /** How far apart two positions are: in a straight line on gridless maps, otherwise in squares (diagonals count 1). */
  const distance = (a: Cell, b: Cell) =>
    gridless ? Math.hypot(a.col - b.col, a.row - b.row) : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
  /** Whether an actor already occupies this spot (same column, overlapping height; on gridless maps, within a token's width). */
  const taken = (c: Cell) =>
    location().actors.items.some((a) =>
      a.position && (gridless ? Math.hypot(a.position.col - c.col, a.position.row - c.row) < 0.9 : a.position.col === c.col && Math.abs(a.position.row - c.row) < 0.5)
    );
  /** A position from script values: whole cells, except heights on portrait maps and anything on gridless maps. */
  const toCell = (at: Cell): Cell =>
    gridless ? { col: snapHeight(at.col), row: snapHeight(at.row) } : { col: Math.round(at.col), row: portrait ? snapHeight(at.row) : Math.round(at.row) };
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
    if (gridless) {
      // Anywhere around it: a random direction, a token's width away, then further out.
      for (let r = 1; r <= 20; r += 0.5) {
        const turn = Math.random() * Math.PI * 2;
        for (let i = 0; i < 16; i++) {
          const a = turn + (i / 16) * Math.PI * 2;
          const c = toCell({ col: col + Math.cos(a) * r, row: row + Math.sin(a) * r });
          if (c.col >= 0 && c.row >= 0 && !taken(c)) return c;
        }
      }
      throw new ScriptError("No free spot near that position");
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
  /** An actor (by its token) or a position, as a point on the map (a token's centre). */
  const point = (v: unknown, what: string): Point => {
    const c = asCell(v, what);
    return { x: c.col + 0.5, y: c.row + 0.5 };
  };
  const actorOf = (v: unknown, what: string): Actor => {
    if (!v || typeof v !== "object" || !("position" in v) || !location().actors.items.includes(v as Actor)) throw new ScriptError(`${what} needs an actor on this map`);
    if (!(v as Actor).position) throw new ScriptError(`${what}: ${(v as Actor).name} isn't placed on the map`);
    return v as Actor;
  };
  return {
    /**
     * Plays a visual effect on everyone's map (it doesn't change anything):
     * fx('slash' | 'arrow', attacker, target, 'hit' | 'miss' | 'down') · fx('circle', where, radius ft)
     * · fx('cone' | 'line', from, towards, length ft). `where` / `from` / `towards`: an actor or a position.
     */
    fx: new Method((look, from, to, extra) => {
      if (!changes) throw new ScriptError("fx() needs a map; run this from a map button or the session console");
      const kind = String(look);
      if (kind === "slash" || kind === "arrow") {
        const a = actorOf(from, `fx('${kind}')`), b = actorOf(to, `fx('${kind}')`);
        const outcome = extra === undefined || extra === null ? "hit" : String(extra);
        if (!["hit", "miss", "down"].includes(outcome)) throw new ScriptError("fx(): the outcome is 'hit', 'miss' or 'down'");
        changes.fx.push(() => ({ look: kind, from: a.id, to: b.id, outcome: outcome as AttackFx["outcome"] }));
      } else if ((AREA_SHAPES as readonly string[]).includes(kind)) {
        const shape = kind as AreaShape;
        const origin = point(from, `fx('${kind}')`);
        const ft = shape === "circle" ? (typeof to === "number" ? to : 10) : typeof extra === "number" ? extra : shape === "cone" ? 15 : 30;
        if (!(ft > 0 && ft <= 500)) throw new ScriptError("fx(): the size is in feet, from 1 to 500");
        const towards = shape === "circle" ? origin : point(to, `fx('${kind}')`);
        const area = placeArea(shape, ft, origin, shape === "circle" ? origin : towards);
        changes.fx.push(() => ({ look: "area", from: 0, area, hits: [] }));
      } else throw new ScriptError(`fx() looks: 'slash', 'arrow', 'circle', 'cone', 'line' (not '${kind}')`);
      return null;
    }),
    /** A random free cell next to a position, actor or group. */
    near: new Method((pos) => freeNear(asCell(pos, "near()"))),
    /** distance(a, b) between positions or actors: squares on grid maps, a straight line on gridless ones. */
    distance: new Method((a, b) => distance(asCell(a, "distance()"), asCell(b, "distance()"))),
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
      a.health.set(Math.max(0, a.health.current - damage));
      return damage;
    }),
  };
}

/** Helpers scripts can call alongside `game`. */
const HELPERS = {
  /** interval(minutes, 'days'): a game time span in the given unit, e.g. interval(timer.elapsed, 'days') < 3 */
  interval: new Method((minutes, unit) => {
    if (typeof minutes !== "number") throw new ScriptError("interval() needs a time in minutes, like a timer's elapsed");
    return minutes / unitMinutes(unit);
  }),
  /** duration(3, 'days'): that span in minutes (game time is in minutes). */
  duration: new Method((n, unit) => {
    if (typeof n !== "number") throw new ScriptError("duration() needs a number, like duration(3, 'days')");
    return n * unitMinutes(unit);
  }),
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
export function runGameScript(
  source: string,
  levelId?: number,
  { depth = 0, bind, answers }: { depth?: number; bind?: (name: string, value: unknown) => unknown; answers?: ScriptAnswers } = {}
): unknown {
  const [game, changes] = loadGame(levelId);
  const triggers: TriggerDef[] = [];
  // select() and ask() put questions to the GM; it throws PromptNeeded (before anything is saved) until it has its answer.
  const globals = { game, ...HELPERS, ...mapHelpers(game, changes), ...promptHelpers(answers) };
  const result = runScript(source, globals, { onTrigger: (t) => triggers.push(t), bind });
  const settled = saveGame(game, changes, triggers);
  // Objectives the script succeeded or failed: rewards and penalties, as when the GM settles one.
  for (const [id, status] of settled) objectiveSettled(id, status);
  syncObjectiveJournals(); // objectives the script revealed
  fireTriggers(depth);
  return toPlain(result);
}

/** How many triggers may set off further triggers in a row (a guard against loops). */
const MAX_CHAIN = 5;

/**
 * Runs each waiting ON trigger whose condition now holds, once. Called after every game script and when game
 * time moves. A trigger whose condition or action fails keeps its error, for the GM to see, and isn't tried again.
 */
/** Checks the waiting triggers and runs any that go off; returns the conditions of those that went off. */
export function fireTriggers(depth = 0): string[] {
  const went: string[] = [];
  if (depth >= MAX_CHAIN) return went;
  // One at a time, re-reading the list: an action may itself have checked (or added) triggers.
  for (let last = 0, t: Trigger | undefined; (t = listActiveTriggers().find((x) => x.id > last)); last = t.id) {
    const trigger = t;
    const fail = (e: unknown) => {
      if (!(e instanceof ScriptError)) throw e;
      setTriggerError(trigger.id, e.message);
    };
    // Watched names (WITH x.health AS H) are read afresh and compared with the value at the last check.
    const seen: Record<string, VarValue> = {};
    const bind = (name: string, v: unknown) => {
      if (!Object.hasOwn(trigger.watches, name)) return v;
      const now = plain(v) as VarValue;
      seen[name] = now ?? null;
      return new Watch(now, trigger.watches[name]);
    };
    let holds = false;
    try {
      const [game, changes] = loadGame(trigger.level_id ?? undefined);
      holds = truthy(runScript(triggerScript(trigger.prelude, trigger.condition), { game, ...HELPERS, ...mapHelpers(game, changes) }, { bind }));
    } catch (e) {
      fail(e);
      continue;
    }
    // It goes off when the condition becomes true, not again while it stays true.
    const fires = holds && !trigger.last;
    // Saved before the action runs, so the action (and triggers it sets off) see this check as done.
    setTriggerState(trigger.id, holds, { ...trigger.watches, ...seen }, fires ? getGameTime() : null);
    if (!fires) continue;
    logSessionEvent(`ON ${readableCondition(trigger)} went off.`);
    went.push(readableCondition(trigger));
    const watched = trigger.watches;
    try {
      runGameScript(triggerScript(trigger.prelude, trigger.action), trigger.level_id ?? undefined, {
        depth: depth + 1,
        bind: (name, v) => (Object.hasOwn(watched, name) ? new Watch(plain(v), watched[name]) : v),
      });
    } catch (e) {
      fail(e);
    }
  }
  return went;
}

/** A trigger's condition with its WITH names written out, e.g. game.calendar.timers['find holmes'].expired. */
function readableCondition(t: Pick<Trigger, "prelude" | "condition">): string {
  let text = t.condition;
  for (const line of t.prelude) {
    const m = line.match(/^WITH (.+) AS ([A-Za-z_]\w*)$/);
    if (m) text = text.replace(new RegExp(`(?<![\\w.'"])${m[2]}\\b`, "g"), () => m[1]);
  }
  return text;
}

/** A trigger as one script, for showing to the GM. */
export function triggerText(t: Pick<Trigger, "prelude" | "condition" | "action">): string {
  return triggerScript(t.prelude, `ON ${t.condition} DO\n${t.action.split("\n").map((l) => `   ${l}`).join("\n")}`);
}

/** Runs a game script, returning its value as JSON text, or the script error. */
export function tryGameScript(source: string, levelId?: number, answers?: ScriptAnswers): ScriptResult {
  try {
    return { ok: true, value: JSON.stringify(runGameScript(source, levelId, { answers }), null, 2) };
  } catch (e) {
    if (e instanceof PromptNeeded) return { ok: false, error: e.message, prompt: e.prompt };
    if (e instanceof ScriptError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * Evaluates a script as a question about the game state (e.g. an objective's condition) without saving
 * anything it changes. Returns its value, or the script error.
 */
export function checkGameState(source: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const [game, changes] = loadGame();
    return { ok: true, value: toPlain(runScript(source, { game, ...HELPERS, ...mapHelpers(game, changes), ...promptHelpers() })) };
  } catch (e) {
    if (e instanceof ScriptError) return { ok: false, error: e.message };
    throw e;
  }
}
