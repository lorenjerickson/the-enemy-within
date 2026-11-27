import { test } from "node:test";
import assert from "node:assert/strict";
import { listEffectDefs, saveEffectDef, getEffectDef } from "@/lib/db/effects";
import { compileLifecycle } from "@/lib/effectGrammar";
import { DEFAULT_LIFECYCLE } from "@/lib/conditions";
import { answerLine, answersFromEffect, lifecycleFromAnswers, lifecyclePosted, questions } from "@/lib/effectWizard";

const timing = (e: Record<string, unknown>) => Object.fromEntries([...Object.keys(DEFAULT_LIFECYCLE), "duration"].map((k) => [k, e[k] ?? (DEFAULT_LIFECYCLE as Record<string, unknown>)[k]]));

test("every effect in the catalog opens with its timing as answers and saves back unchanged (lasting rounds)", () => {
  saveEffectDef(null, { name: "Webbed", description: "", modifiers: [], rounds: 3, apply_save_attr: "might", apply_save_dc: 15, save_attr: "might", save_dc: 15, save_when: "start", save_action: 1, saves_needed: 2, ends_on_damage: 1, reapply: "stack", stack_limit: 3 });
  const all = listEffectDefs().filter((e) => e.duration === "rounds");
  assert.ok(all.length > 5, "the built-ins are there");
  for (const e of all) {
    const a = answersFromEffect(e);
    assert.deepEqual(timing(lifecycleFromAnswers(a)), timing(e as never), e.name);
    assert.deepEqual(compileLifecycle(lifecyclePosted(a)).lifecycle, lifecycleFromAnswers(a), `${e.name}: what the server reads`);
  }
});

test("only an effect lasting rounds is asked about saves, endings and stacking; the others drop them", () => {
  const id = saveEffectDef(null, { name: "Keen edge", description: "", modifiers: [], duration: "equipped", apply_save_attr: "agility" });
  const a = answersFromEffect(getEffectDef(id)!);
  assert.deepEqual(questions(a), ["name", "duration", "rules"]);
  assert.equal(lifecycleFromAnswers({ ...a, resist: true }).apply_save_attr, "", "no save on something worn");
  assert.deepEqual(questions({ ...a, duration: "rounds" }), ["name", "duration", "rules", "resist", "shake", "ends", "again"]);
});

test("each answer has a short line", () => {
  const a = { ...answersFromEffect({ name: "Enervated", rounds: 3 }), resist: true, resistAttr: "fortitude" as const, resistDc: 12, shake: true, shakeAttr: "fortitude" as const, shakeDc: 12, shakeAction: true, endsOn: ["damage" as const], again: "stack" as const, stackLimit: 2 };
  assert.deepEqual(questions(a).map((q) => answerLine(q, a, () => "your speed is halved")), [
    ["Name", "Enervated"], ["Lasts", "3 rounds"], ["What it does", "—"], ["Resisted as it lands", "Fortitude DC 12: avoids it"],
    ["Shaken off", "Fortitude DC 12 at the end of each round, or with their action"], ["Also ends when", "they take damage"], ["Put on again", "Stacks (up to 2)"],
  ]);
});
