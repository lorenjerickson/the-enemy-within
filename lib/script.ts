/**
 * The game scripting language: a small, indentation-structured DSL that reads and changes game state.
 * Scripts are parsed and interpreted here; nothing is passed to JavaScript's eval, and only the
 * properties and methods below are reachable. See docs/scripting.md.
 */

// ---------- Values the interpreter understands besides plain data ----------

/**
 * Named records, reachable as coll['annis'], coll.annis, coll.find('annis'), coll.random or coll.all.<property>;
 * coll.add(name, count) when `adder` is given.
 */
export class Collection<T extends { id: number; name: string }> {
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
/** A callable: a helper like roll() or a method like conditions.add. */
export class Method {
  constructor(public fn: (...args: unknown[]) => unknown) {}
}
/** Objects whose keys scripts may create (game.vars); missing keys read as null. */
export const FREEFORM = new WeakSet<object>();

export class ScriptError extends Error {}

// ---------- Tokens ----------

type Tok = { t: "num" | "str" | "id" | "op" | "nl" | "indent" | "dedent" | "eof"; v: string; line: number };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(\+=|-=|\*=|\/=|==|!=|<=|>=|&&|\|\||\+\+|--|[-+*/%<>=!?:.,()[\]]))/y;

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
    if (eatKw("if")) {
      const c = expr();
      // THEN may follow on the same line, or start an indented line below the IF.
      let indented = false;
      if (peek().t === "nl" && toks[p + 1]?.t === "indent" && kw(toks[p + 2], "then")) {
        p += 2;
        indented = true;
      }
      if (!eatKw("then")) fail("expected THEN");
      const then = branch();
      let otherwise: Stmt[] | undefined;
      if (eatKw("else")) otherwise = branch();
      if (indented) {
        if (peek().t !== "dedent") fail("expected the end of the IF block");
        p++;
      }
      return { k: "if", c, then, else: otherwise, line };
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
    while (peek().t === "op" && ["==", "!=", "<", ">", "<=", ">="].includes(peek().v)) a = { k: "bin", op: next().v, a, b: sum() };
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

// ---------- Interpreter ----------

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
/** Identity fields of records. */
const READ_ONLY = new Set(["id", "name", "type"]);
const TAG_METHODS = ["add", "remove", "has"] as const;

type Scope = { names: Record<string, unknown> } | { with: unknown };

function describe(v: unknown): string {
  if (v instanceof Collection) return v.kind;
  if (v === null || v === undefined) return "nothing";
  return typeof v === "object" ? "this" : `${typeof v} ${JSON.stringify(v)}`;
}

function getKey(obj: unknown, key: string): unknown {
  if (FORBIDDEN.has(key)) throw new ScriptError(`"${key}" isn't allowed`);
  if (obj instanceof Broadcast) return new Broadcast(obj.values.map((v) => getKey(v, key)));
  if (obj instanceof Collection) {
    if (key === "all" || key === "each") return new Broadcast(obj.items);
    if (key === "random") {
      if (!obj.items.length) throw new ScriptError(`There are no ${obj.kind}s to pick from`);
      return obj.items[Math.floor(Math.random() * obj.items.length)];
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
  if (FREEFORM.has(obj)) {
    if (value !== null && !["number", "string", "boolean"].includes(typeof value)) throw new ScriptError(`game.vars can only hold numbers, text, true/false or null`);
  } else if (!Object.hasOwn(rec, key)) {
    throw new ScriptError(`There is no "${key}" to change`);
  } else if (value !== null && typeof value === "object") {
    throw new ScriptError(`"${key}" can't be replaced as a whole; change its parts${key === "position" ? " or use place()" : ""}`);
  } else if (typeof rec[key] !== typeof value) {
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
  if (typeof v !== "number") throw new ScriptError(`"${op}" needs numbers, got ${describe(v)}`);
  return v;
}

function binary(op: string, a: unknown, b: unknown): unknown {
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
      return e.op === "not" ? !v : -num(v, "-");
    }
    case "bin": {
      if (e.op === "and") return evaluate(e.a, scopes) && evaluate(e.b, scopes);
      if (e.op === "or") return evaluate(e.a, scopes) || evaluate(e.b, scopes);
      return binary(e.op, evaluate(e.a, scopes), evaluate(e.b, scopes));
    }
    case "tern":
      return evaluate(e.c, scopes) ? evaluate(e.a, scopes) : e.b ? evaluate(e.b, scopes) : null;
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

function execute(stmts: Stmt[], scopes: Scope[]): unknown {
  let last: unknown = null;
  for (const s of stmts) {
    try {
      if (s.k === "expr") last = evaluate(s.e, scopes);
      else if (s.k === "with") {
        const v = evaluate(s.e, scopes);
        last = execute(s.body, [...scopes, s.as ? { names: { [s.as]: v } } : { with: v }]);
      } else if (s.k === "if") {
        last = evaluate(s.c, scopes) ? execute(s.then, scopes) : s.else ? execute(s.else, scopes) : null;
      } else {
        const [obj, key] = assignTarget(s.target, scopes);
        const apply = (old: unknown) => {
          if (s.op === "++") return num(old, "++") + 1;
          if (s.op === "--") return num(old, "--") - 1;
          const v = evaluate(s.value!, scopes);
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
export function runScript(source: string, globals: Record<string, unknown>): unknown {
  return execute(parse(source), [{ names: globals }]);
}

/** Helper arguments with lists (coll.each.x) spread out, e.g. sum(G) or max(a, b). */
export const spread = (args: unknown[]): unknown[] => args.flatMap((a) => (a instanceof Broadcast ? a.values : [a]));

/** A script value as plain JSON for display. */
export function toPlain(v: unknown): unknown {
  if (v instanceof Collection) return v.items.map((i) => i.name);
  if (v instanceof Tags) return [...v.set];
  if (v instanceof Broadcast) return v.values.map(toPlain);
  if (v instanceof Method) return "(method)";
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v ?? null;
}
