import { test } from "node:test";
import assert from "node:assert/strict";
import { getVars } from "@/lib/db";
import { checkGameState, tryGameScript } from "@/lib/game";
import { deleteLibraryScript, findLibraryScript, listLibraryScripts, saveLibraryScript } from "@/lib/scriptLibrary";

test("library scripts: saved by name (unique, case aside), found by name, listed, deleted", () => {
  const a = saveLibraryScript(null, { name: " Open the vault ", description: "Opens it", source: "game.vars.x = 1" });
  assert.ok("id" in a);
  assert.equal(findLibraryScript("open THE vault")?.name, "Open the vault");
  assert.deepEqual(saveLibraryScript(null, { name: "open the vault", description: "", source: "" }), { error: "There's already a script called Open the vault" });
  assert.deepEqual(saveLibraryScript(null, { name: "  ", description: "", source: "" }), { error: "Give it a name" });
  const id = (a as { id: number }).id;
  assert.deepEqual(saveLibraryScript(id, { name: "Open the vault", description: "Opens it wide", source: "game.vars.x = 2" }), { id }, "saving itself under its own name is fine");
  saveLibraryScript(null, { name: "Alarm", description: "", source: "" });
  assert.deepEqual(listLibraryScripts().map((s) => s.name), ["Alarm", "Open the vault"]);
  deleteLibraryScript(id);
  assert.equal(findLibraryScript("open the vault"), undefined);
});


test("run('name') runs a library script there, with the same game: its changes are saved with the caller's", () => {
  saveLibraryScript(null, { name: "Ring the bell", description: "", source: "game.vars.bell = game.vars.bell + 1\ngame.vars.bell * 10" });
  saveLibraryScript(null, { name: "Twice", description: "", source: "run('ring the bell')\nrun('Ring the bell')" });
  assert.equal(tryGameScript("game.vars.bell = 0\nrun('twice')").ok, true);
  assert.equal(getVars().bell, 2);
  assert.deepEqual(checkGameState("run('ring the bell')"), { ok: true, value: 30 }, "its last value; a question saves nothing");
  assert.equal(getVars().bell, 2);
});

test("run(): an unknown name, a failing library script, or one calling itself is an error (and nothing is saved)", () => {
  const unknown = tryGameScript("run('nope')");
  assert.match(!unknown.ok ? unknown.error : "", /no script called 'nope'/);
  saveLibraryScript(null, { name: "Broken", description: "", source: "game.players.nobody.health = 0" });
  const broken = tryGameScript("game.vars.mark = 1\nrun('broken')");
  assert.match(!broken.ok ? broken.error : "", /In 'Broken'/);
  assert.notEqual(getVars().mark, 1);
  saveLibraryScript(null, { name: "Loop", description: "", source: "run('loop')" });
  const loop = tryGameScript("run('loop')");
  assert.match(!loop.ok ? loop.error : "", /10 deep/);
});
