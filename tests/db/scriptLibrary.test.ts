import { test } from "node:test";
import assert from "node:assert/strict";
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
