import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain JS script
import { cycles, graph, reaches } from "../../scripts/coupling.mjs";

// Rule modules that mustn't reach the database (directly or through anything they import at runtime): the start of
// the shared engine (docs/productization.md). Backlog U adds to this list as rules move out of lib/db.ts; never remove.
const PURE = [
  "lib/actionCard.ts", "lib/actionSummary.ts", "lib/actionWizard.ts", "lib/actions.ts", "lib/effectWizard.ts", "lib/ambientPlayer.ts", "lib/aoe.ts", "lib/attributes.ts",
  "lib/auras.ts", "lib/builtinConditions.ts", "lib/calendar.ts", "lib/containers.ts", "lib/conditions.ts", "lib/creatureTypes.ts", "lib/dice.ts", "lib/effectGrammar.ts",
  "lib/effectOptions.ts", "lib/effects.ts", "lib/fighter.ts", "lib/encounter.ts", "lib/exposure.ts", "lib/gravity.ts", "lib/hiding.ts", "lib/itemTypes.ts",
  "lib/levelLinks.ts", "lib/light.ts", "lib/loudness.ts", "lib/mail.ts", "lib/maps.ts", "lib/modifiers.ts", "lib/movement.ts", "lib/playerActions.ts",
  "lib/replayView.ts", "lib/resolveRound.ts", "lib/rolls.ts", "lib/roundPlan.ts", "lib/roundStory.ts", "lib/script.ts", "lib/scriptFormat.ts",
  "lib/scriptPrompt.ts", "lib/scriptSchema.ts", "lib/seedEffects.ts", "lib/sides.ts", "lib/soundPrefs.ts", "lib/speed.ts", "lib/standing.ts",
  "lib/status.ts", "lib/templates.ts", "lib/tokenArt.ts", "lib/traps.ts", "lib/triggers.ts", "lib/vfx.ts", "lib/visibility.ts", "lib/walkHold.ts",
  "lib/wallSnap.ts",
];

test("rule modules never reach the database", () => {
  const mods = graph();
  for (const m of PURE) {
    assert.ok(mods.has(m), `${m} exists`);
    assert.ok(!reaches(mods, m).has("lib/db/connection.ts"), `${m} reaches the database`);
  }
});

test("import cycles don't grow (2 today: game/storyRules, and the play folder's round modules)", () => {
  assert.ok(cycles(graph()).length <= 2);
});

test("lib/db/* storage modules never import the migrations (they run at start-up, after every module has loaded)", () => {
  const mods = graph();
  for (const [name, m] of mods) if (name.startsWith("lib/db/") && name !== "lib/db/migrations.ts") assert.ok(!m.runtime.includes("lib/db/migrations.ts"), `${name} imports lib/db/migrations.ts`);
});
