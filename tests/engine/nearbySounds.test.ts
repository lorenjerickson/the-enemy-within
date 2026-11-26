import { test } from "node:test";
import assert from "node:assert/strict";
import { loudnessAt } from "@/lib/loudness";

test("a placed sound is loudest at its centre and silent beyond its reach", () => {
  const forge = { id: 1, url: "", x: 10, y: 10, radius: 4, volume: 0.8 };
  assert.equal(loudnessAt(forge, { x: 10, y: 10 }), 0.8);
  assert.equal(loudnessAt(forge, { x: 12, y: 10 }), 0.4);
  assert.equal(loudnessAt(forge, { x: 15, y: 10 }), 0);
});
