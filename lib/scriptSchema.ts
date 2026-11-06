import { ATTRIBUTES, SKILLS_BY_ATTRIBUTE } from "./attributes";

/**
 * What scripts can reach, for the editor's autocomplete. It mirrors lib/game.ts (the runtime is the authority:
 * anything missing here still runs, it just isn't suggested). Types are names like "character" or
 * "coll:light" (a collection of lights); a collection's items are also reachable by name, from ScriptNames.
 */
export type ItemKind = "character" | "location" | "actor" | "creature" | "light" | "effect" | "door" | "timer" | "objective";

/** Real names to suggest: characters, locations, the level's lights … and game.vars keys. */
export type ScriptNames = Partial<Record<ItemKind | "var", string[]>>;

type Member = { label: string; type?: string; detail: string; method?: boolean };

const SKILLS = [...new Set(Object.values(SKILLS_BY_ATTRIBUTE).flat())].map((s) => s.replace(/ /g, "_")).sort();
const num = (label: string, detail: string): Member => ({ label, detail, type: "number" });
const flag = (label: string, detail: string): Member => ({ label, detail, type: "boolean" });
const text = (label: string, detail: string): Member => ({ label, detail, type: "text" });

const TYPES: Record<string, Member[]> = {
  game: [
    { label: "characters", type: "coll:character", detail: "the characters (also game.players)" },
    { label: "players", type: "coll:character", detail: "the characters" },
    { label: "locations", type: "coll:location", detail: "all locations; .current is the button's" },
    { label: "calendar", type: "calendar", detail: "game time and timers" },
    { label: "vars", type: "vars", detail: "your own flags and numbers" },
    { label: "objectives", type: "coll:objective", detail: "the story's objectives, by title" },
  ],
  objective: [text("name", "the title, read-only"), text("status", "'open', 'succeeded' or 'failed'"), flag("revealed", "the party knows of it")],
  character: [
    text("name", "read-only"), text("type", "read-only"),
    { label: "attributes", type: "attributes", detail: "might, intellect …" },
    { label: "health", type: "health", detail: "current (plain health), maximum, temporary" }, flag("alive", "read-only: health above 0"),
    { label: "conditions", type: "tags", detail: "add / remove / has" },
    { label: "rolls", type: "rolls", detail: "d20 + modifier, fresh each read" },
  ],
  attributes: ATTRIBUTES.map((a) => num(a, "score, 1–20")),
  rolls: [num("initiative", "d20 + agility modifier"), ...ATTRIBUTES.map((a) => num(a, `d20 + ${a} modifier`)), ...SKILLS.map((s) => num(s, "d20 + skill modifier"))],
  tags: [
    { label: "add", detail: "add('grappled')", method: true }, { label: "remove", detail: "remove('grappled')", method: true },
    { label: "has", detail: "has('grappled') → true/false", method: true }, num("count", "how many"),
  ],
  location: [num("id", "read-only"), text("name", "read-only")],
  currentLocation: [
    text("name", "the location"), text("level", "the map level's name"),
    { label: "actors", type: "coll:actor", detail: "everything on the level" },
    { label: "creatures", type: "coll:creature", detail: "creatures on the level; add('giant rat', 2)" },
    { label: "encounter", type: "encounter", detail: "begin / next / end" },
    num("illumination", "overall light, 0 to 100 (%)"),
    { label: "lights", type: "coll:light", detail: "light sources" },
    { label: "effects", type: "coll:effect", detail: "animated effects" },
    { label: "doors", type: "coll:door", detail: "doors" },
  ],
  actor: [
    text("name", "read-only"), text("type", "creature / character"),
    { label: "position", type: "position", detail: "{ col, row }" }, { label: "health", type: "health", detail: "current (plain health), maximum, temporary" },
    { label: "rolls", type: "rolls", detail: "d20 + modifier" },
  ],
  health: [num("current", "health now; set exactly"), num("maximum", "full health; restore with health = health.maximum"), num("temporary", "lost before current")],
  position: [num("col", "column"), num("row", "row (fractional on portrait maps)")],
  encounter: [
    flag("active", "an encounter is running"), num("round", "from 1"),
    { label: "actor", type: "actor", detail: "whose turn it is" }, { label: "order", type: "coll:actor", detail: "turn order" },
    { label: "begin", detail: "begin(actors, initiatives)", method: true }, { label: "next", detail: "next() → whose turn", method: true },
    { label: "end", detail: "end()", method: true },
  ],
  light: [text("name", "read-only"), text("kind", "point / directional"), num("range", "cells"), flag("flicker", ""), flag("on", "switched on")],
  effect: [text("name", "read-only"), text("kind", "rain, fire …"), num("intensity", "0 to 1"), flag("on", "switched on")],
  door: [text("name", "read-only"), flag("open", "")],
  calendar: [
    num("now", "game minutes since the campaign began"), { label: "timers", type: "coll:timer", detail: "start / stop" },
    { label: "advance", detail: "advance(2, 'hours')", method: true },
  ],
  // A WITH name for a property's value, watched in an ON trigger (WITH x.health AS H / ON H.changed DO …).
  ...Object.fromEntries(
    ["number", "text", "boolean"].map((t) => [
      t,
      [{ label: "changed", type: "boolean", detail: "in ON: changed since the last check" }, { label: "current", type: t, detail: "in ON: the value now" },
       { label: "previous", type: t, detail: "in ON: the value at the last check" }],
    ])
  ),
  timer: [
    text("name", "read-only"), num("started", "game minute it started"), num("elapsed", "minutes since; interval(…, 'days')"),
    num("duration", "minutes until it expires (null: never)"), num("remaining", "minutes left"), flag("expired", "has run its duration"),
    { label: "expires", type: "timer", detail: "expires(3, 'days') → the timer", method: true },
  ],
};

/** Members every collection has, for a collection of `item`. */
function collectionMembers(item: string): Member[] {
  const extra: Member[] = [];
  if (item === "character") extra.push({ label: "party", type: "coll:character", detail: "the player characters" });
  if (item === "location") extra.push({ label: "current", type: "currentLocation", detail: "the button's location (map scripts)" });
  if (item === "creature") extra.push({ label: "add", type: item, detail: "add('giant rat', 2)", method: true });
  if (item === "timer") {
    extra.push({ label: "start", type: "timer", detail: "start('name') (or restart)", method: true });
    extra.push({ label: "stop", detail: "stop('name')", method: true });
  }
  return [
    ...extra,
    { label: "each", type: `each:${item}`, detail: "that property of every one (a list)" },
    { label: "all", type: `each:${item}`, detail: "same as each; assigning sets it on all" },
    { label: "any", type: `group:${item}`, detail: "every one has a go; true if any succeeds" },
    { label: "one", type: `group:${item}`, detail: "a single attempt, by the one best at it" },
    { label: "random", type: item, detail: "one at random" },
    num("count", "how many"),
    { label: "find", type: item, detail: "find('name')", method: true },
  ];
}

/** The item type behind a collection / list / group type ("coll:light" → "light"). */
const itemOf = (type: string) => type.replace(/^(coll|each|group):/, "");
/** Creatures and actors are the same kind of thing. */
const shape = (item: string) => (item === "creature" ? "actor" : item);

export function membersOf(type: string, names: ScriptNames): Member[] {
  if (type.startsWith("coll:")) {
    const item = itemOf(type);
    const named = (names[item as ItemKind] ?? []).filter((n) => /^[A-Za-z_]\w*$/.test(n)).map((n) => ({ label: n, type: item, detail: item }));
    return [...collectionMembers(item), ...named];
  }
  if (type.startsWith("each:") || type.startsWith("group:")) {
    const [wrap, item] = type.split(":");
    return (TYPES[shape(item)] ?? []).map((m) => ({ ...m, type: m.type && !m.method ? `${wrap}:${m.type}` : m.type }));
  }
  if (type === "vars") return (names.var ?? []).map((v) => ({ label: v, detail: "game.vars" }));
  return TYPES[shape(type)] ?? [];
}

/** The type of a member of a type: by property name, or an item of a collection by its name. */
function memberType(type: string, name: string, names: ScriptNames): string | undefined {
  const m = membersOf(type, names).find((x) => x.label === name);
  if (m) return m.type;
  return type.startsWith("coll:") ? itemOf(type) : undefined; // an item by a name we don't know about
}

/** Helpers callable on their own (game.ts HELPERS and map helpers). */
export const HELPER_NAMES: Member[] = [
  { label: "roll", detail: "roll('2d6+1')", method: true }, { label: "select", detail: "select(coll, 'instructions') → what the GM picks", method: true }, { label: "mod", detail: "mod(score) → modifier", method: true },
  { label: "min", detail: "min(…)", method: true }, { label: "max", detail: "max(…)", method: true },
  { label: "sum", detail: "sum(list)", method: true }, { label: "avg", detail: "avg(list)", method: true },
  { label: "count", detail: "count(list)", method: true },
  { label: "interval", detail: "interval(minutes, 'days')", method: true }, { label: "duration", detail: "duration(3, 'days') → minutes", method: true },
  { label: "near", detail: "near(position or actor)", method: true },
  { label: "distance", detail: "distance(a, b): squares, or straight line if gridless", method: true }, { label: "place", detail: "place(actor, position)", method: true },
  { label: "move", detail: "move(actor, position) → fall damage", method: true },
];

export const KEYWORDS = ["WITH", "AS", "IF", "THEN", "ELSE", "ON", "DO", "and", "or", "not", "true", "false", "null"];

/** Splits a chain like game.locations.current.lights['lamp'] into its steps. */
function steps(chain: string): { name?: string; index?: string; call?: boolean }[] {
  const out: { name?: string; index?: string; call?: boolean }[] = [];
  for (const m of chain.matchAll(/([A-Za-z_]\w*)|\[\s*(['"]?)([^\]'"]*)\2\s*\]|\(([^()]*)\)/g)) {
    if (m[1]) out.push({ name: m[1] });
    else if (m[3] !== undefined) out.push({ index: m[3] });
    else out.push({ call: true });
  }
  return out;
}

/** The type a chain evaluates to, given WITH … AS names (or undefined if it can't tell). */
export function typeOfChain(chain: string, aliases: Record<string, string>, names: ScriptNames): string | undefined {
  const [first, ...rest] = steps(chain);
  if (!first?.name) return undefined;
  let type: string | undefined = first.name === "game" ? "game" : aliases[first.name];
  for (const s of rest) {
    if (!type) return undefined;
    if (s.name) type = memberType(type, s.name, names);
    else if (s.index !== undefined) type = type.startsWith("coll:") ? itemOf(type) : undefined;
    // A call keeps the type its member said it returns (find → item, start → timer); anything else is unknown.
  }
  return type;
}

/** WITH … AS name, from the script's text, in order (so later ones can use earlier ones). */
export function aliasesIn(source: string, names: ScriptNames): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*with\s+(.+?)\s+as\s+([A-Za-z_]\w*)\s*$/gim)) {
    const t = typeOfChain(m[1], aliases, names);
    if (t) aliases[m[2]] = t;
  }
  return aliases;
}

/** A chain of names, indexes and calls ending just before the cursor, e.g. "game.locations.current". */
export const CHAIN = String.raw`[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^\[\]]*\]|\s*\([^()]*\))*`;
