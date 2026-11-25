import { test } from "node:test";
import assert from "node:assert/strict";
import { DAMAGE_TYPES } from "@/lib/actions";
import { lookOf } from "@/lib/combat";
import { EFFECT_KINDS, EFFECT_LABELS } from "@/lib/effects";

test("each damage type has an area look; the physical ones (and none) fall back to fog", () => {
  const looks = Object.fromEntries(DAMAGE_TYPES.map((d) => [d, lookOf(d)]));
  assert.deepEqual(looks, {
    acid: "acid", bludgeoning: "fog", cold: "snow", fire: "fire", force: "force", lightning: "lightning", necrotic: "necrotic",
    piercing: "fog", poison: "poison", psychic: "psychic", radiant: "radiant", slashing: "fog", thunder: "wind",
  });
  for (const k of EFFECT_KINDS) assert.ok(EFFECT_LABELS[k], k);
});
