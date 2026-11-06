/**
 * The game scripting language: a small, indentation-structured DSL that reads and changes game state.
 * Scripts are parsed and interpreted here; nothing is passed to JavaScript's eval, and only the
 * properties and methods below are reachable. See docs/scripting.md.
 */

// ---------- Values the interpreter understands besides plain data ----------

/**
 * Named records, reachable as coll['annis'], coll.annis, coll.find('annis'), coll.random or coll.all.<property>;
 * coll.add(name, count) when `adder` is given, and coll.current when there is one (e.g. the location a map button is on).
 */
export class Collection<T extends { id: number; name: string }> {
  current?: T;
  /** Extra named values computed on demand, e.g. characters.party. */
  extras: Record<string, () => unknown> = {};
  constructor(public kind: string, public items: T[], public adder?: (name: string, count: number) => unknown) {}
}
/** A set of words, e.g. conditions: add, remove, has, count. */
export class Tags {
  constructor(public set: Set<string>) {}
}
/** The same property on every item of a collection: reads give a list, writes and calls apply to each. */
export class Broadcast {
  constructor(public values: unknown[]) {}
}
/**
 * A question put to a group, from coll.any or coll.one:
 * - any: every member has a go; a comparison holds if it holds for any of them.
 * - one: a single attempt by whichever member the party sends. Rolls are made once, by the member with the
 *   best modifier for that roll (until the players can be asked who goes); for anything else it's the same as any.
 */
export class Some {
  constructor(public mode: "any" | "one", public values: unknown[]) {}
}
/** Each rolls object carries the modifier behind each roll, so .one can tell who's best at it. */
export const MODIFIERS = Symbol("modifiers");
/** A group's rolls under .one: reading a roll makes it once, for the member best at it. */
class OneRoll {
  constructor(public members: unknown[]) {}
}

/** A callable: a helper like roll() or a method like conditions.add. */
export class Method {
  constructor(public fn: (...args: unknown[]) => unknown) {}
}
/**
 * A value an ON trigger watches (WITH x.health AS H): current, previous (at the last check) and changed.
 * Used as a plain value it's the current one, so "H < 5" works too.
 */
export class Watch {
  constructor(public current: unknown, public previous: unknown) {}
}
/**
 * Health as scripts see it: x.health.current, .maximum and .temporary.
 * Used as a plain value it's the current one ("x.health < 5", "x.health -= 3"); a loss assigned to x.health
 * comes off temporary first. x.health.current = n sets current exactly.
 */
export class Health {
  constructor(public current: number, public maximum: number, public temporary: number) {}
  set(v: number): void {
    const loss = this.current - v;
    const fromTemp = Math.min(this.temporary, Math.max(0, loss));
    this.temporary -= fromTemp;
    this.current -= loss - fromTemp;
  }
}
const HEALTH_KEYS = ["current", "maximum", "temporary"];
/** A value as a plain number, text, etc.: a watched value's current one, health's current. */
export const plain = (v: unknown): unknown => (v instanceof Watch ? plain(v.current) : v instanceof Health ? v.current : v);

/** Objects whose keys scripts may create (game.vars); missing keys read as null. */
export const FREEFORM = new WeakSet<object>();

export class ScriptError extends Error {}

/**
 * How to name a value again in a later script, e.g. "game.calendar.timers['find holmes']". Set as values are read
 * (a property's path from its parent's, a collection item by its name), so ON can remember what its names meant.
 */
const REFS = new WeakMap<object, string>();
/** Gives a value (e.g. a timer made by a method) a path for ON to remember it by. */
export function setRef(v: unknown, ref: string): void {
  if (v && typeof v === "object" && !REFS.has(v)) REFS.set(v, ref);
}
export const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * A trigger made by ON: the WITH lines it needs, its condition, and what it does, as script text.
 * `watches`: WITH names bound to a property's value (WITH x.health AS H), with the value when the ON ran;
 * when the trigger runs these names are Watches (H.current, H.previous, H.changed).
 */
export interface TriggerDef {
  prelude: string[];
  condition: string;
  action: string;
  watches: Record<string, unknown>;
}
/** What running a script may do besides changing the game. */
export interface Hooks {
  /** Registers an ON trigger; without it, ON is an error. */
  onTrigger?: (t: TriggerDef) => void;
  /** Turns what a WITH … AS name is bound to into something else (a trigger's watched values). */
  bind?: (name: string, value: unknown) => unknown;
}

// ---------- Tokens ----------

type Tok = { t: "num" | "str" | "id" | "op" | "nl" | "indent" | "dedent" | "eof"; v: string; line: number };

export const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\+\+|--|[-+*/%<>=!?:.,()[\]]))/y;

function tokenize(source: string): Tok[] {
  const toks: Tok[] = [];
  const indents = [0];
  source.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const text = raw.replace(/\t/g, "    ").replace(/\s*(#|\/\/).*$/, "");
    if (!text.trim()) return;
    const indent = text.length - text.trimStart().length;
    if (indent > indents[indents.length - 1]) {
      indents.push(indent);
      toks.push({ t: "indent", v: "", line });
    }
    while (indent < indents[indents.length - 1]) {
      indents.pop();
      toks.push({ t: "dedent", v: "", line });
    }
    if (indent !== indents[indents.length - 1]) throw new ScriptError(`Line ${line}: indentation doesn't match any outer line`);
    TOKEN.lastIndex = indent;
    while (TOKEN.lastIndex < text.trimEnd().length) {
      const at = TOKEN.lastIndex;
      const m = TOKEN.exec(text);
      if (!m) throw new ScriptError(`Line ${line}: unexpected "${text.slice(at).trim()[0]}"`);
      if (m[1]) toks.push({ t: "num", v: m[1], line });
      else if (m[2]) toks.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1"), line });
      else if (m[3]) toks.push({ t: "id", v: m[3], line });
      else toks.push({ t: "op", v: m[4], line });
    }
    toks.push({ t: "nl", v: "", line });
  });
  for (let i = 1; i < indents.length; i++) toks.push({ t: "dedent", v: "", line: 0 });
  toks.push({ t: "eof", v: "", line: 0 });
  return toks;
}

// ---------- Syntax tree ----------

type Expr =
  | { k: "lit"; v: unknown }
  | { k: "id"; name: string }
  | { k: "mem"; obj: Expr; key: string }
  | { k: "idx"; obj: Expr; index: Expr }
  | { k: "call"; callee: Expr; args: Expr[] }
  | { k: "un"; op: string; e: Expr }
  | { k: "bin"; op: string; a: Expr; b: Expr }
  | { k: "tern"; c: Expr; a: Expr; b?: Expr };

type Stmt = { line: number } & (
  | { k: "expr"; e: Expr }
  | { k: "assign"; target: Expr; op: string; value?: Expr }
  | { k: "with"; e: Expr; as?: string; body: Stmt[] }
  | { k: "if"; c: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: "on"; c: Expr; then: Stmt[] } // ON cond DO …
);

const ASSIGN_OPS = ["=", "+=", "-=", "*=", "/=", "++", "--"];
const kw = (tok: Tok, word: string) => tok.t === "id" && tok.v.toLowerCase() === word;

function parse(source: string): Stmt[] {
  const toks = tokenize(source);
  let p = 0;
  const peek = (o = 0) => toks[p + o];
  const next = () => toks[p++];
  const fail = (msg: string): never => {
    throw new ScriptError(`Line ${peek().line || toks[p - 1]?.line}: ${msg}`);
  };
  const isOp = (v: string) => peek().t === "op" && peek().v === v;
  const eatOp = (v: string) => (isOp(v) ? (p++, true) : false);
  const expectOp = (v: string) => eatOp(v) || fail(`expected "${v}"`);
  const eatKw = (w: string) => (kw(peek(), w) ? (p++, true) : false);
  /** Inside an IF or ON condition, where "=" can only mean "is equal to". */
  let inCondition = false;
  const condition = () => {
    inCondition = true;
    try {
      return expr();
    } finally {
      inCondition = false;
    }
  };

  function block(): Stmt[] {
    if (peek().t !== "indent") fail("expected an indented block");
    p++;
    const body: Stmt[] = [];
    while (peek().t !== "dedent" && peek().t !== "eof") body.push(statement());
    p++;
    return body;
  }

  /** The body of THEN or ELSE: the rest of the line, or an indented block below it. */
  function branch(): Stmt[] {
    if (peek().t === "nl") {
      p++;
      return block();
    }
    return [statement()];
  }

  function statement(): Stmt {
    const line = peek().line;
    if (eatKw("with")) {
      const e = expr();
      let as: string | undefined;
      if (eatKw("as")) as = peek().t === "id" ? next().v : fail("expected a name after AS");
      if (peek().t !== "nl") fail("expected the end of the line after WITH");
      p++;
      if (peek().t !== "indent") throw new ScriptError(`Line ${line}: WITH needs an indented block below it`);
      return { k: "with", e, as, body: block(), line };
    }
    // ON cond DO …: unless "on" is a name being used (on = false inside WITH light, or on.x).
    const isOn = kw(peek(), "on") && !(peek(1).t === "op" && [".", "[", "(", ...ASSIGN_OPS].includes(peek(1).v));
    if (isOn || eatKw("if")) {
      if (isOn) p++;
      const c = condition();
      // IF … THEN, ON … DO. It may follow on the same line, or start an indented line below.
      const opener = (t: Tok) => kw(t, isOn ? "do" : "then");
      let indented = false;
      if (peek().t === "nl" && toks[p + 1]?.t === "indent" && opener(toks[p + 2])) {
        p += 2;
        indented = true;
      }
      if (!eatKw(isOn ? "do" : "then")) fail(isOn ? "expected DO (ON … DO)" : "expected THEN");
      const then = branch();
      let otherwise: Stmt[] | undefined;
      if (kw(peek(), "else") && isOn) fail("ON has no ELSE");
      if (eatKw("else")) otherwise = branch();
      if (indented) {
        if (peek().t !== "dedent") fail(`expected the end of the ${isOn ? "ON" : "IF"} block`);
        p++;
      }
      return isOn ? { k: "on", c, then, line } : { k: "if", c, then, else: otherwise, line };
    }
    const e = expr();
    let s: Stmt = { k: "expr", e, line };
    if (peek().t === "op" && ASSIGN_OPS.includes(peek().v)) {
      const op = next().v;
      if (e.k !== "mem" && e.k !== "idx" && e.k !== "id") fail("can only assign to a property, like player.health");
      s = { k: "assign", target: e, op, value: op === "++" || op === "--" ? undefined : expr(), line };
    }
    // A statement ends at the end of its line, or at ELSE in "IF x THEN a ELSE b".
    if (peek().t === "nl") p++;
    else if (!kw(peek(), "else")) fail(`unexpected "${peek().v}"`);
    return s;
  }

  function expr(): Expr {
    const c = or();
    if (!eatOp("?")) return c;
    const a = or();
    return { k: "tern", c, a, b: eatOp(":") ? or() : undefined };
  }
  function or(): Expr {
    let a = and();
    while (eatOp("||") || eatKw("or")) a = { k: "bin", op: "or", a, b: and() };
    return a;
  }
  function and(): Expr {
    let a = not();
    while (eatOp("&&") || eatKw("and")) a = { k: "bin", op: "and", a, b: not() };
    return a;
  }
  function not(): Expr {
    return eatOp("!") || eatKw("not") ? { k: "un", op: "not", e: not() } : compare();
  }
  function compare(): Expr {
    let a = sum();
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      if (peek().t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(peek().v)) a = { k: "bin", op: next().v, a, b: sum() };
      else if (inCondition && isOp("=")) (p++, (a = { k: "bin", op: "==", a, b: sum() }));
      else return a;
    }
    return a;
  }
  function sum(): Expr {
    let a = product();
    while (isOp("+") || isOp("-")) a = { k: "bin", op: next().v, a, b: product() };
    return a;
  }
  function product(): Expr {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("%")) a = { k: "bin", op: next().v, a, b: unary() };
    return a;
  }
  function unary(): Expr {
    return eatOp("-") ? { k: "un", op: "-", e: unary() } : postfix();
  }
  function postfix(): Expr {
    let e = primary();
    for (;;) {
      if (eatOp(".")) e = { k: "mem", obj: e, key: peek().t === "id" ? next().v : fail("expected a name after .") };
      else if (eatOp("[")) {
        e = { k: "idx", obj: e, index: expr() };
        expectOp("]");
      } else if (eatOp("(")) {
        const args: Expr[] = [];
        if (!isOp(")")) do args.push(expr()); while (eatOp(","));
        expectOp(")");
        e = { k: "call", callee: e, args };
      } else return e;
    }
  }
  function primary(): Expr {
    const t = next();
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      const w = t.v.toLowerCase();
      if (w === "true" || w === "false") return { k: "lit", v: w === "true" };
      if (w === "null") return { k: "lit", v: null };
      return { k: "id", name: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      const e = expr();
      expectOp(")");
      return e;
    }
    p--;
    return fail(t.t === "nl" || t.t === "eof" ? "unexpected end of line" : `unexpected "${t.v}"`);
  }

  const program: Stmt[] = [];
  while (peek().t !== "eof") program.push(statement());
  return program;
}

// ---------- Back to text (for triggers saved by ON) ----------

function unparseExpr(e: Expr): string {
  const wrap = (x: Expr) => (x.k === "bin" || x.k === "tern" || x.k === "un" ? `(${unparseExpr(x)})` : unparseExpr(x));
  switch (e.k) {
    case "lit":
      return typeof e.v === "string" ? quote(e.v) : String(e.v);
    case "id":
      return e.name;
    case "mem":
      return `${wrap(e.obj)}.${e.key}`;
    case "idx":
      return `${wrap(e.obj)}[${unparseExpr(e.index)}]`;
    case "call":
      return `${wrap(e.callee)}(${e.args.map(unparseExpr).join(", ")})`;
    case "un":
      return e.op === "not" ? `not ${wrap(e.e)}` : `-${wrap(e.e)}`;
    case "bin":
      return `${wrap(e.a)} ${e.op} ${wrap(e.b)}`;
    case "tern":
      return `${wrap(e.c)} ? ${wrap(e.a)}${e.b ? ` : ${wrap(e.b)}` : ""}`;
  }
}

const INDENT = "   ";
function unparse(stmts: Stmt[], depth = 0): string[] {
  const pad = INDENT.repeat(depth);
  return stmts.flatMap((s): string[] => {
    switch (s.k) {
      case "expr":
        return [pad + unparseExpr(s.e)];
      case "assign":
        return [pad + unparseExpr(s.target) + (s.value ? ` ${s.op} ${unparseExpr(s.value)}` : s.op)];
      case "with":
        return [`${pad}WITH ${unparseExpr(s.e)}${s.as ? ` AS ${s.as}` : ""}`, ...unparse(s.body, depth + 1)];
      case "if":
        return [
          `${pad}IF ${unparseExpr(s.c)} THEN`, ...unparse(s.then, depth + 1),
          ...(s.else ? [`${pad}ELSE`, ...unparse(s.else, depth + 1)] : []),
        ];
      case "on":
        return [`${pad}ON ${unparseExpr(s.c)} DO`, ...unparse(s.then, depth + 1)];
    }
  });
}

/** A trigger's WITH lines with a body (condition or action) inside them, as one script. */
export function triggerScript(prelude: string[], body: string): string {
  return [...prelude.map((l, i) => INDENT.repeat(i) + l), ...body.split("\n").map((l) => INDENT.repeat(prelude.length) + l)].join("\n");
}

// ---------- Interpreter ----------

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
/** Identity fields of records. */
const READ_ONLY = new Set(["id", "name", "type", "kind"]);
const TAG_METHODS = ["add", "remove", "has"] as const;

/** A WITH … AS name; `path` names where its value came from (for a trigger to watch), when it can. */
type Scope = { names: Record<string, unknown>; path?: string } | { with: unknown };

function describe(v: unknown): string {
  if (v instanceof Collection) return v.kind;
  if (v === null || v === undefined) return "nothing";
  return typeof v === "object" ? "this" : `${typeof v} ${JSON.stringify(v)}`;
}

/** A collection item's path: by name when that's unique in the collection, else by id. */
function itemRef(coll: Collection<{ id: number; name: string }>, item: { id: number; name: string }): string | undefined {
  const base = REFS.get(coll);
  if (!base) return undefined;
  const same = coll.items.filter((it) => it.name.toLowerCase() === item.name.toLowerCase()).length;
  if (same === 1) return `${base}[${quote(item.name)}]`;
  return item.id > 0 ? `${base}[${quote(String(item.id))}]` : undefined;
}

/** Names a collection and each of its items for ON (items by name, or id when names repeat). */
export function refCollection(coll: Collection<{ id: number; name: string }>, ref: string): void {
  setRef(coll, ref);
  for (const it of coll.items) {
    const r = itemRef(coll, it);
    if (r) setRef(it, r);
  }
}

function getKey(obj: unknown, key: string): unknown {
  const v = readKey(obj, key);
  if (v && typeof v === "object" && !REFS.has(v) && obj && typeof obj === "object") {
    const base = REFS.get(obj);
    if (obj instanceof Collection && obj.items.includes(v as never)) {
      const ref = key === "current" && base ? `${base}.current` : itemRef(obj, v as { id: number; name: string });
      if (ref) REFS.set(v, ref);
    } else if (base && /^[A-Za-z_]\w*$/.test(key) && !(v instanceof Some) && !(v instanceof Broadcast) && !(v instanceof Method)) {
      REFS.set(v, `${base}.${key}`);
    }
  }
  return v;
}

function readKey(obj: unknown, key: string): unknown {
  if (FORBIDDEN.has(key)) throw new ScriptError(`"${key}" isn't allowed`);
  if (obj instanceof Watch) {
    if (key === "current") return obj.current;
    if (key === "previous") return obj.previous;
    if (key === "changed") return obj.current !== obj.previous;
    return readKey(obj.current, key);
  }
  if (obj instanceof Health) {
    if (HEALTH_KEYS.includes(key)) return obj[key as keyof Health];
    throw new ScriptError(`Health has current, maximum and temporary, not "${key}"`);
  }
  if (obj instanceof Some) {
    if (obj.mode === "one" && key === "rolls") return new OneRoll(obj.values);
    return new Some(obj.mode, obj.values.map((v) => getKey(v, key)));
  }
  if (obj instanceof OneRoll) {
    // One attempt, by the member best at it (highest modifier for this roll).
    const best = (m: unknown) => {
      const rolls = getKey(m, "rolls") as Record<string | symbol, unknown>;
      return ((rolls?.[MODIFIERS] as Record<string, number> | undefined)?.[key] ?? 0);
    };
    const member = obj.members.reduce((a, b) => (best(b) > best(a) ? b : a));
    return getKey(getKey(member, "rolls"), key);
  }
  if (obj instanceof Broadcast) {
    // A list is already "each": coll.all.each.x is the same as coll.each.x.
    if (key === "each" || key === "all") return obj;
    if (key === "count") return obj.values.length;
    return new Broadcast(obj.values.map((v) => getKey(v, key)));
  }
  if (obj instanceof Collection) {
    if (key === "all" || key === "each") return new Broadcast(obj.items);
    if (key === "current") {
      if (!obj.current) throw new ScriptError(`There's no current ${obj.kind}${obj.kind === "location" ? "; run this from a map button" : ""}`);
      return obj.current;
    }
    if (Object.hasOwn(obj.extras, key)) return obj.extras[key]();
    // .one: any one item (picked at random), e.g. game.characters.party.one
    if (key === "random") {
      if (!obj.items.length) throw new ScriptError(`There are no ${obj.kind}s to pick from`);
      const picked = obj.items[Math.floor(Math.random() * obj.items.length)];
      const ref = itemRef(obj, picked);
      if (ref) setRef(picked, ref); // remembered as the one picked, not a new pick
      return picked;
    }
    if (key === "any" || key === "one") {
      if (!obj.items.length) throw new ScriptError(`There are no ${obj.kind}s`);
      return new Some(key, obj.items);
    }
    if (key === "add" && obj.adder) {
      const adder = obj.adder;
      return new Method((name, count = 1) => {
        if (typeof count !== "number" || count < 1 || count > 100 || !Number.isInteger(count)) throw new ScriptError("add() count must be a whole number from 1 to 100");
        return adder(String(name), count);
      });
    }
    if (key === "find") {
      return new Method((name) => {
        const found = obj.items.find((it) => it.name.toLowerCase() === String(name).toLowerCase());
        if (!found) throw new ScriptError(`No ${obj.kind} named "${name}"`);
        const ref = itemRef(obj, found);
        if (ref) setRef(found, ref);
        return found;
      });
    }
    if (key === "count") return obj.items.length;
    const found = obj.items.find((it) => it.name.toLowerCase() === key.toLowerCase() || String(it.id) === key);
    if (!found) throw new ScriptError(`No ${obj.kind} named "${key}"`);
    return found;
  }
  if (obj instanceof Tags) {
    if (key === "count") return obj.set.size;
    if (key === "add") return new Method((t) => void obj.set.add(String(t).toLowerCase()));
    if (key === "remove") return new Method((t) => void obj.set.delete(String(t).toLowerCase()));
    if (key === "has") return new Method((t) => obj.set.has(String(t).toLowerCase()));
    throw new ScriptError(`Conditions have ${TAG_METHODS.join(", ")} and count, not "${key}"`);
  }
  if (obj && typeof obj === "object") {
    if (Object.hasOwn(obj, key)) return (obj as Record<string, unknown>)[key];
    if (FREEFORM.has(obj)) return null;
  }
  if (["changed", "previous", "current"].includes(key) && (obj === null || typeof obj !== "object")) {
    throw new ScriptError(`"${key}" works in an ON trigger, on a WITH name for a property, e.g. WITH x.health AS H / ON H.changed DO …`);
  }
  throw new ScriptError(`Can't read "${key}" of ${describe(obj)}`);
}

function hasKey(obj: unknown, key: string): boolean {
  if (obj instanceof Collection) return obj.items.some((it) => it.name.toLowerCase() === key.toLowerCase());
  return !!obj && typeof obj === "object" && !(obj instanceof Tags) && Object.hasOwn(obj, key);
}

function setKey(obj: unknown, key: string, value: unknown): void {
  if (FORBIDDEN.has(key)) throw new ScriptError(`"${key}" isn't allowed`);
  if (obj instanceof Broadcast) return obj.values.forEach((v) => setKey(v, key, value));
  if (!obj || typeof obj !== "object" || obj instanceof Collection || obj instanceof Tags || obj instanceof Method) {
    throw new ScriptError(`Can't change "${key}" of ${describe(obj)}`);
  }
  const rec = obj as Record<string, unknown>;
  if (READ_ONLY.has(key) && !FREEFORM.has(obj)) throw new ScriptError(`"${key}" can't be changed by a script`);
  if (obj instanceof Health) {
    if (!HEALTH_KEYS.includes(key)) throw new ScriptError(`Health has current, maximum and temporary, not "${key}"`);
    if (typeof value !== "number") throw new ScriptError(`health.${key} must be a number`);
    if (key !== "current" && value < 0) throw new ScriptError(`health.${key} can't be below 0`);
    (obj as unknown as Record<string, number>)[key] = value;
    return;
  }
  if (Object.hasOwn(rec, key) && rec[key] instanceof Health) {
    if (typeof value !== "number") throw new ScriptError(`"${key}" must be a number (or change health.current, .maximum, .temporary)`);
    return rec[key].set(value);
  }
  if (FREEFORM.has(obj)) {
    if (value !== null && !["number", "string", "boolean"].includes(typeof value)) throw new ScriptError(`game.vars can only hold numbers, text, true/false or null`);
  } else if (!Object.hasOwn(rec, key)) {
    throw new ScriptError(`There is no "${key}" to change`);
  } else if (value !== null && typeof value === "object") {
    throw new ScriptError(`"${key}" can't be replaced as a whole; change its parts${key === "position" ? " or use place()" : ""}`);
  } else if (rec[key] !== null && value !== null && typeof rec[key] !== typeof value) {
    throw new ScriptError(`"${key}" is a ${typeof rec[key]}, not a ${typeof value}`);
  }
  rec[key] = value;
}

function call(callee: unknown, args: unknown[]): unknown {
  if (callee instanceof Method) return callee.fn(...args);
  if (callee instanceof Broadcast) return new Broadcast(callee.values.map((m) => call(m, args)));
  throw new ScriptError(`${describe(callee)} can't be called`);
}

function num(v: unknown, op: string): number {
  v = plain(v);
  if (typeof v !== "number") throw new ScriptError(`"${op}" needs numbers, got ${describe(v)}`);
  return v;
}

/** Truth of a value; a group's (any / one) is true if any member's is. */
export const truthy = (v: unknown): boolean => (v instanceof Some ? v.values.some(truthy) : !!plain(v));

function binary(op: string, a: unknown, b: unknown): unknown {
  a = plain(a);
  b = plain(b);
  // A group on either side: comparisons hold if they hold for any member; arithmetic applies to each.
  if (a instanceof Some || b instanceof Some) {
    const group = (a instanceof Some ? a : b) as Some;
    const each = group.values.map((v) => binary(op, a instanceof Some ? v : a, b instanceof Some ? v : b));
    return ["==", "!=", "<", ">", "<=", ">="].includes(op) ? each.some(truthy) : new Some(group.mode, each);
  }
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "+": return typeof a === "string" || typeof b === "string" ? `${a}${b}` : num(a, op) + num(b, op);
    case "-": return num(a, op) - num(b, op);
    case "*": return num(a, op) * num(b, op);
    case "/": return num(a, op) / num(b, op);
    case "%": return num(a, op) % num(b, op);
    case "<": return num(a, op) < num(b, op);
    case ">": return num(a, op) > num(b, op);
    case "<=": return num(a, op) <= num(b, op);
    case ">=": return num(a, op) >= num(b, op);
  }
  throw new ScriptError(`Unknown operator ${op}`);
}

function evaluate(e: Expr, scopes: Scope[]): unknown {
  switch (e.k) {
    case "lit":
      return e.v;
    case "id":
      for (let i = scopes.length - 1; i >= 0; i--) {
        const s = scopes[i];
        if ("names" in s) {
          if (Object.hasOwn(s.names, e.name)) return s.names[e.name];
        } else if (hasKey(s.with, e.name)) return getKey(s.with, e.name);
      }
      throw new ScriptError(`Unknown name "${e.name}"`);
    case "mem":
      return getKey(evaluate(e.obj, scopes), e.key);
    case "idx":
      return getKey(evaluate(e.obj, scopes), String(evaluate(e.index, scopes)));
    case "call":
      return call(evaluate(e.callee, scopes), e.args.map((a) => evaluate(a, scopes)));
    case "un": {
      const v = evaluate(e.e, scopes);
      if (e.op === "not") return !truthy(v);
      return v instanceof Some ? new Some(v.mode, v.values.map((x) => -num(x, "-"))) : -num(v, "-");
    }
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.a, scopes)) && truthy(evaluate(e.b, scopes));
      if (e.op === "or") {
        const a = evaluate(e.a, scopes);
        return truthy(a) ? a : evaluate(e.b, scopes);
      }
      return binary(e.op, evaluate(e.a, scopes), evaluate(e.b, scopes));
    }
    case "tern":
      return truthy(evaluate(e.c, scopes)) ? evaluate(e.a, scopes) : e.b ? evaluate(e.b, scopes) : null;
  }
}

/** The object and key an assignment writes to. A bare name refers to a property of an enclosing WITH. */
function assignTarget(t: Expr, scopes: Scope[]): [unknown, string] {
  if (t.k === "mem") return [evaluate(t.obj, scopes), t.key];
  if (t.k === "idx") return [evaluate(t.obj, scopes), String(evaluate(t.index, scopes))];
  if (t.k === "id") {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const sc = scopes[i];
      if ("with" in sc && hasKey(sc.with, t.name)) return [sc.with, t.name];
    }
    throw new ScriptError(`"${t.name}" isn't a property of anything in a WITH, so it can't be changed`);
  }
  throw new ScriptError("can only assign to a property");
}

/** How ON names a value from an enclosing WITH in the script it saves. */
function remember(v: unknown, name: string): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return quote(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const ref = typeof v === "object" ? REFS.get(v) : undefined;
  if (ref) return ref;
  throw new ScriptError(`ON can't keep track of ${name} for later; give it something it can find again by name, like game.characters['Ash'] or a timer`);
}

/** Registers an ON trigger: the enclosing WITH names are saved as the things they refer to now. */
function registerTrigger(s: Extract<Stmt, { k: "on" }>, scopes: Scope[], hooks: Hooks): void {
  if (!hooks.onTrigger) throw new ScriptError("ON can't be used here: this script only answers a question");
  const watches: Record<string, unknown> = {};
  const prelude = scopes.slice(1).flatMap((sc) => {
    if (!("names" in sc)) return [`WITH ${remember(sc.with, "what this WITH refers to")}`];
    return Object.entries(sc.names).map(([name, v]) => {
      // A property's value (WITH x.health AS H) is watched: the trigger reads it afresh each time.
      const value = plain(v);
      if (sc.path && (value === null || typeof value !== "object")) {
        watches[name] = value ?? null;
        return `WITH ${sc.path} AS ${name}`;
      }
      return `WITH ${remember(v, `"${name}"`)} AS ${name}`;
    });
  });
  hooks.onTrigger({ prelude, condition: unparseExpr(s.c), action: unparse(s.then).join("\n"), watches });
}

function execute(stmts: Stmt[], scopes: Scope[], hooks: Hooks = {}): unknown {
  let last: unknown = null;
  for (const s of stmts) {
    try {
      if (s.k === "expr") last = evaluate(s.e, scopes);
      else if (s.k === "with") {
        // For WITH x.health AS H, note where the value came from, so a trigger can watch it.
        let v: unknown;
        let path: string | undefined;
        if (s.as && (s.e.k === "mem" || s.e.k === "idx")) {
          const obj = evaluate(s.e.obj, scopes);
          const key = s.e.k === "mem" ? s.e.key : String(evaluate(s.e.index, scopes));
          v = getKey(obj, key);
          const base = obj && typeof obj === "object" ? REFS.get(obj) : undefined;
          if (base) path = /^[A-Za-z_]\w*$/.test(key) ? `${base}.${key}` : `${base}[${quote(key)}]`;
        } else v = evaluate(s.e, scopes);
        if (s.as && hooks.bind) v = hooks.bind(s.as, v);
        last = execute(s.body, [...scopes, s.as ? { names: { [s.as]: v }, path } : { with: v }], hooks);
      } else if (s.k === "if") {
        last = truthy(evaluate(s.c, scopes)) ? execute(s.then, scopes, hooks) : s.else ? execute(s.else, scopes, hooks) : null;
      } else if (s.k === "on") {
        registerTrigger(s, scopes, hooks);
        last = null;
      } else {
        const [obj, key] = assignTarget(s.target, scopes);
        const apply = (old: unknown) => {
          if (s.op === "++") return num(old, "++") + 1;
          if (s.op === "--") return num(old, "--") - 1;
          const v = plain(evaluate(s.value!, scopes));
          return s.op === "=" ? v : binary(s.op[0], old, v);
        };
        // A broadcast target ("lights.all.level += 1") updates each item from its own old value.
        const targets = obj instanceof Broadcast ? obj.values : [obj];
        for (const o of targets) {
          // An unset game.vars counter starts from 0, so "game.vars.rolls += 1" just works.
          const old = s.op === "=" ? undefined : getKey(o, key);
          setKey(o, key, apply(old === null && FREEFORM.has(o as object) ? 0 : old));
        }
        last = null;
      }
    } catch (err) {
      if (err instanceof ScriptError && !/^Line \d+:/.test(err.message)) throw new ScriptError(`Line ${s.line}: ${err.message}`);
      throw err;
    }
  }
  return last;
}

/** The first syntax error in a script, or null if it parses. */
export function checkScript(source: string): string | null {
  try {
    parse(source);
    return null;
  } catch (e) {
    if (e instanceof ScriptError) return e.message;
    throw e;
  }
}

/** Parses and runs a script against `globals` (e.g. { game, roll }), mutating them. Returns the last value. */
export function runScript(source: string, globals: Record<string, unknown>, hooks: Hooks = {}): unknown {
  for (const [name, v] of Object.entries(globals)) setRef(v, name);
  return execute(parse(source), [{ names: globals }], hooks);
}

/** Helper arguments with lists (coll.each.x) spread out, e.g. sum(G) or max(a, b). */
export const spread = (args: unknown[]): unknown[] => args.flatMap((a) => (a instanceof Broadcast || a instanceof Some ? a.values : [plain(a)]));

/** A script value as plain JSON for display. */
export function toPlain(v: unknown): unknown {
  if (v instanceof Collection) return v.items.map((i) => i.name);
  if (v instanceof Tags) return [...v.set];
  if (v instanceof Broadcast || v instanceof Some) return v.values.map(toPlain);
  if (v instanceof Method) return "(method)";
  if (v instanceof Watch) return toPlain(v.current);
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v ?? null;
}
