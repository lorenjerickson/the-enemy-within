import { test } from "node:test";
import assert from "node:assert/strict";
import { character } from "./seed";
import { addProfessionModifier, deleteRank, getCharacterRank, laterRanks, linkAdvancement, listCharacterProfessionIds, moveRank, rankChain, saveProfession, saveProfessionGroup, setCharacterRank, startingRanks } from "@/lib/db";
import { professionStatuses } from "@/lib/creatureChanges";

function lawEnforcement() {
  const g = saveProfessionGroup(null, { name: "Law Enforcement", description: "" });
  const cop = saveProfession(null, { name: "Beat Cop", description: "", group_id: g });
  const det = saveProfession(null, { name: "Detective", description: "", group_id: g });
  const eye = saveProfession(null, { name: "Private Eye", description: "", group_id: g });
  const sgt = saveProfession(null, { name: "Sergeant", description: "", group_id: g });
  linkAdvancement(cop, det);
  linkAdvancement(det, eye);
  linkAdvancement(cop, sgt);
  return { g, cop, det, eye, sgt };
}

test("ranks form a progression: starting ranks, the chain before a rank, the ranks after it", () => {
  const r = lawEnforcement();
  assert.deepEqual(startingRanks(r.g).map((p) => p.id), [r.cop]);
  assert.deepEqual(rankChain(r.eye), [r.cop, r.det, r.eye]);
  assert.deepEqual(laterRanks(r.cop).sort(), [r.det, r.eye, r.sgt].sort());
  linkAdvancement(r.det, r.det);
  assert.deepEqual(rankChain(r.det), [r.cop, r.det], "a rank can't advance to itself");
});

test("a character holds every rank up to theirs, and their modifiers add up", () => {
  const r = lawEnforcement();
  addProfessionModifier({ profession_id: r.cop, target: "defense", value: "1" });
  addProfessionModifier({ profession_id: r.det, target: "skill:investigation", value: "+2" });
  addProfessionModifier({ profession_id: r.det, target: "attack", value: "0" });
  const id = character("Holmes");
  setCharacterRank(id, r.det);
  assert.deepEqual(listCharacterProfessionIds(id).sort(), [r.cop, r.det].sort());
  const st = professionStatuses(id);
  assert.deepEqual(st.flatMap((s) => s.boosts), [{ target: "defense", value: "+1" }, { target: "skill:investigation", value: "+2" }], "zero modifiers are left out");
  assert.deepEqual(professionStatuses(null), []);
});

test("moving a rank takes the ranks after it along; it can't go after itself", () => {
  const r = lawEnforcement();
  moveRank(r.det, r.sgt, r.g);
  assert.deepEqual(rankChain(r.eye), [r.cop, r.sgt, r.det, r.eye]);
  assert.throws(() => moveRank(r.sgt, r.eye, r.g), /after itself/);
  const g2 = saveProfessionGroup(null, { name: "Private sector", description: "" });
  moveRank(r.det, null, g2);
  assert.deepEqual(startingRanks(g2).map((p) => p.id), [r.det]);
  assert.deepEqual(rankChain(r.eye), [r.det, r.eye], "came along to the new profession");
});

test("deleting a rank joins its next ranks to its parent and moves its characters down a rank", () => {
  const r = lawEnforcement();
  const id = character("Lestrade");
  setCharacterRank(id, r.det);
  deleteRank(r.det);
  assert.deepEqual(rankChain(r.eye), [r.cop, r.eye]);
  assert.equal(getCharacterRank(id), r.cop);
});
