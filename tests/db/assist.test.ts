import { test } from "node:test";
import assert from "node:assert/strict";
import { character, level } from "./seed";
import { assistOpenRequest, createUser, db, getOpenRollRequest, listAssists, placeCharacterToken, requestRoll, setAssist } from "@/lib/db";

const player = (username: string) => {
  createUser({ name: username, username, contact: "", role: "player" } as never, "pw");
  return db.prepare<[string], { id: number }>("SELECT id FROM users WHERE username = ?").get(username)!.id;
};
const p1 = player("p1"), p2 = player("p2"), p3 = player("p3");

const spec = (mode: "normal" | "disadvantage" = "normal") => ({ label: "Investigation", parts: [{ dice: "1d20", value: 0 }], mode }) as never;

test("a helped character's next roll request has advantage, says who helped, and uses the help up", () => {
  const lv = level(), milo = character("Milo"), tilly = character("Tilly");
  const m = placeCharacterToken(lv, milo, 0, 0), t = placeCharacterToken(lv, tilly, 1, 0);
  setAssist(m, t, "Tilly");
  requestRoll(p1, milo, spec(), { kind: "search" } as never);
  const r = getOpenRollRequest(p1)!;
  assert.equal(r.spec.mode, "advantage");
  assert.match(r.spec.label, /helped by Tilly/);
  assert.deepEqual(listAssists(lv), []);
  requestRoll(p1, milo, spec(), { kind: "search" } as never);
  assert.equal(getOpenRollRequest(p1)!.spec.mode, "normal", "only the next one");
});

test("help cancels disadvantage; initiative doesn't use it up", () => {
  const lv = level(), a = character("A"), b = character("B");
  const ta = placeCharacterToken(lv, a, 0, 0), tb = placeCharacterToken(lv, b, 1, 0);
  setAssist(ta, tb, "B");
  requestRoll(p2, a, spec(), { kind: "initiative", levelId: lv, tokenId: ta });
  assert.equal(getOpenRollRequest(p2)!.spec.mode, "normal");
  assert.equal(listAssists(lv).length, 1);
  requestRoll(p2, a, spec("disadvantage"), { kind: "search" } as never);
  assert.equal(getOpenRollRequest(p2)!.spec.mode, "normal");
});

test("help given while their roll is waiting (not rolled yet) applies to that roll", () => {
  const lv = level(), c = character("C"), d = character("D");
  const tc = placeCharacterToken(lv, c, 0, 0), td = placeCharacterToken(lv, d, 1, 0);
  requestRoll(p3, c, spec(), { kind: "search" } as never);
  setAssist(tc, td, "D");
  assert.equal(assistOpenRequest(tc), true);
  assert.equal(getOpenRollRequest(p3)!.spec.mode, "advantage");
  assert.match(getOpenRollRequest(p3)!.spec.label, /helped by D/);
  assert.deepEqual(listAssists(lv), []);
});
