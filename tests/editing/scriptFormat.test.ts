import { test } from "node:test";
import assert from "node:assert/strict";
import { formatScript } from "@/lib/scriptFormat";
import { checkScript } from "@/lib/script";

const SCRIPTS = [
  "game.players.annis.health+=10",
  "IF a>b THEN x.conditions.add('grappled') ELSE y",
  "with game.players as P\n  with P.annis\n      IF attributes.might > 12\n         THEN health += roll('1d6')",
  "WITH game.players.each.health as H   # comment\n IF sum(H)<20 THEN game.vars.retreat = true",
  "x = -1 + -y\ngame.vars['a b'] = !done",
];

test("formatting is stable (formatting twice changes nothing) and keeps scripts parseable", () => {
  for (const s of SCRIPTS) {
    const once = formatScript(s);
    assert.equal(formatScript(once), once, s);
    assert.equal(checkScript(once), checkScript(s), `formatting changed whether it parses: ${s}`);
  }
});

test("operators get spaces, calls and properties don't", () => {
  assert.equal(formatScript("game.players.annis.health+=10"), "game.players.annis.health += 10");
  assert.equal(formatScript("x=roll( '1d6' )+mod(y)"), "x = roll('1d6') + mod(y)");
  assert.equal(formatScript("x = -1"), "x = -1");
  assert.equal(formatScript("i++"), "i++");
});

test("indentation becomes three spaces per level; comments are kept", () => {
  assert.equal(formatScript("IF a\n      THEN b  # why\n"), "IF a\n   THEN b  # why");
});
