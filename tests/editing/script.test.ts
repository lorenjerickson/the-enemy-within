import { test } from "node:test";
import assert from "node:assert/strict";
import { Collection, FREEFORM, Health, Method, PromptNeeded, ScriptError, Tags, checkScript, promptHelpers, runScript, spread, toPlain, type TriggerDef } from "@/lib/script";

type P = { id: number; name: string; health: Health; attributes: { might: number }; conditions: Tags };
const person = (id: number, name: string, hp: number, might = 10): P => ({ id, name, health: new Health(hp, 25, 0), attributes: { might }, conditions: new Tags(new Set()) });

function world() {
  const players = new Collection<P>("character", [person(1, "Annis", 20, 14), person(2, "Bram", 7, 8)]);
  const vars: Record<string, unknown> = {};
  FREEFORM.add(vars);
  const game = { players, characters: players, vars };
  const helpers = {
    sum: new Method((...a) => spread(a).reduce((s: number, n) => s + Number(n), 0)),
    max: new Method((...a) => Math.max(...spread(a).map(Number))),
    roll: new Method(() => 4),
  };
  return { game, players, vars, run: (src: string, extra: Record<string, unknown> = {}, hooks = {}) => runScript(src, { game, ...helpers, ...extra }, hooks) };
}

test("reading and assigning properties, by name or by index", () => {
  const w = world();
  assert.equal(w.run("game.players.annis.attributes.might"), 14);
  assert.equal(w.run("game.players['bram'].attributes.might"), 8);
  w.run("game.players.annis.attributes.might = 16");
  assert.equal(w.players.items[0].attributes.might, 16);
});

test("compound assignment and arithmetic follow precedence", () => {
  const w = world();
  w.run("game.players.annis.attributes.might += 2 * 3 - 1");
  assert.equal(w.players.items[0].attributes.might, 19);
  w.run("game.players.annis.attributes.might -= 4\ngame.players.annis.attributes.might++");
  assert.equal(w.players.items[0].attributes.might, 16);
  assert.equal(w.run("(1 + 2) * 3 % 4"), 1);
});

test("health: a loss comes off temporary first; .current sets exactly", () => {
  const w = world();
  w.players.items[0].health.temporary = 3;
  w.run("game.players.annis.health -= 5");
  assert.deepEqual({ ...w.players.items[0].health }, { current: 18, maximum: 25, temporary: 0 });
  w.run("game.players.annis.health.current = 4");
  assert.equal(w.players.items[0].health.current, 4);
  w.run("game.players.annis.health = game.players.annis.health.maximum");
  assert.equal(w.players.items[0].health.current, 25);
  assert.equal(w.run("game.players.bram.health < 10"), true);
});

test(".each reads a list and writes to every item", () => {
  const w = world();
  assert.deepEqual(toPlain(w.run("game.players.each.health.current")), [20, 7]);
  w.run("game.players.all.health += 5");
  assert.deepEqual(w.players.items.map((p) => p.health.current), [25, 12]);
  assert.equal(w.run("sum(game.players.each.health.current)"), 37);
  w.run("game.players.each.health.current = game.players.each.health.maximum");
  assert.deepEqual(w.players.items.map((p) => p.health.current), [25, 25]);
});

test("IF / THEN / ELSE, one line and as blocks", () => {
  const w = world();
  w.run("IF game.players.bram.health < 10 THEN game.vars.weak = 'bram' ELSE game.vars.weak = 'none'");
  assert.equal(w.vars.weak, "bram");
  w.run(["if game.players.annis.attributes.might > 12", "   then game.vars.strong = true", "   else game.vars.strong = false"].join("\n"));
  assert.equal(w.vars.strong, true);
  w.run("game.players.annis.attributes.might > 12 ? game.players.annis.conditions.add('proud') : game.players.annis.conditions.add('meek')");
  assert.equal(w.run("game.players.annis.conditions.has('proud')"), true);
});

test("a ternary's branches can assign", { todo: "\"a ? x = 1 : x = 2\" fails with 'can only assign to a property' (the ternary is an expression; docs only show a method call in it)" }, () => {
  const w = world();
  w.run("game.players.annis.attributes.might > 20 ? game.vars.t = 1 : game.vars.t = 2");
  assert.equal(w.vars.t, 2);
});

test("WITH … AS names a thing; WITH alone makes its properties bare names", () => {
  const w = world();
  w.run(["WITH game.players AS P", "   WITH P.annis", "      health -= 2", "      attributes.might = 9"].join("\n"));
  assert.equal(w.players.items[0].health.current, 18);
  assert.equal(w.players.items[0].attributes.might, 9);
});

test("WITH coll.each AS X runs its block once per item", () => {
  const w = world();
  w.vars.n = 0;
  w.run(["WITH game.players.each AS X", "   IF X.attributes.might > 10 THEN X.health += 1", "   game.vars.n += 1"].join("\n"));
  assert.equal(w.vars.n, 2);
  assert.deepEqual(w.players.items.map((p) => p.health.current), [21, 7]);
});

test("conditions: add, has, remove, count", () => {
  const w = world();
  w.run("game.players.annis.conditions.add('grappled')");
  assert.equal(w.run("game.players.annis.conditions.has('grappled')"), true);
  assert.equal(w.run("game.players.annis.conditions.count"), 1);
  w.run("game.players.annis.conditions.remove('grappled')");
  assert.equal(w.run("game.players.annis.conditions.has('grappled')"), false);
});

test("collections: count, find, missing names are errors", () => {
  const w = world();
  assert.equal(w.run("game.players.count"), 2);
  assert.equal(toPlain(w.run("game.players.find('Bram').name")), "Bram");
  assert.throws(() => w.run("game.players.zed.health"), ScriptError);
});

test("game.vars: anything can be set; unset reads as null, and += starts from 0", () => {
  const w = world();
  assert.equal(w.run("game.vars.nothing"), null);
  w.run("game.vars.count += 3");
  assert.equal(w.vars.count, 3);
  w.run("game.vars.label = 'go'");
  assert.equal(w.run("game.vars.label == 'go' and not false"), true);
});

test("comments and keywords in any case", () => {
  const w = world();
  w.run("# a comment\ngame.vars.x = 1 // trailing\nif TRUE then game.vars.y = 2");
  assert.equal(w.vars.x, 1);
  assert.equal(w.vars.y, 2);
});

test("only what's exposed is reachable: no JavaScript escape hatches", () => {
  const w = world();
  for (const src of ["game.constructor", "game.players.items.constructor.constructor('return 1')()", "game.__proto__", "process"]) {
    assert.throws(() => w.run(src), ScriptError, src);
  }
});

test("errors carry the line number; checkScript catches syntax errors without running", () => {
  const w = world();
  assert.throws(() => w.run("game.vars.a = 1\ngame.nope.b = 2"), /Line 2/);
  assert.equal(checkScript("game.vars.a = 1"), null);
  assert.match(checkScript("game.vars.a = ")!, /./);
  assert.match(checkScript("IF THEN")!, /./);
});

test("ON … DO saves a trigger instead of running it", () => {
  const w = world();
  const made: TriggerDef[] = [];
  w.run(["WITH game.players.bram.health AS H", "   ON H.changed DO", "      game.vars.fired = true"].join("\n"), {}, { onTrigger: (t: TriggerDef) => made.push(t) });
  assert.equal(made.length, 1);
  assert.equal(w.vars.fired, undefined);
  assert.match(made[0].action, /game\.vars\.fired = true/);
  assert.ok(made[0].prelude.some((l) => /WITH game\.players\['Bram'\]\.health AS H/i.test(l)), made[0].prelude.join(" | "));
  assert.throws(() => w.run("ON true DO game.vars.x = 1"), ScriptError, "without a trigger hook ON is an error");
});

test("select() asks once per run and replays the answers", () => {
  const w = world();
  assert.throws(() => w.run("select(game.players, 'Who?').health -= 1", promptHelpers([])), PromptNeeded);
  w.run("select(game.players, 'Who?').health -= 1", promptHelpers([[2]]));
  assert.equal(w.players.items[1].health.current, 6);
  w.run(["WITH select(game.players, 'Who?') AS A", "   A.health -= 1"].join("\n"), promptHelpers([[1, 2]]));
  assert.deepEqual(w.players.items.map((p) => p.health.current), [19, 5]);
  assert.throws(() => w.run("select(game.players, 'Who?')", promptHelpers()), /needs someone to answer/);
});

test("ask() gets a typed answer, the same one when asked again", () => {
  const w = world();
  w.run(["WITH game.players.each AS X", "   X.health += ask('Heal by', 'number')"].join("\n"), promptHelpers([3]));
  assert.deepEqual(w.players.items.map((p) => p.health.current), [23, 10]);
  assert.throws(() => w.run("ask('Name', 'text')", promptHelpers([])), (e: unknown) => e instanceof PromptNeeded && e.prompt.kind === "input");
});
