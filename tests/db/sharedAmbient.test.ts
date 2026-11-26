import { test } from "node:test";
import assert from "node:assert/strict";
import { level } from "./seed";
import { addAmbientSound, getLevelAmbient, listAmbientSounds, setLevelAmbient } from "@/lib/db";

test("what the GM plays is shared: a new play is a new rev, a volume change isn't, stop plays nothing", () => {
  const lv = level("Hall");
  assert.equal(getLevelAmbient(lv), null);
  addAmbientSound(lv, "Rain");
  const sound = listAmbientSounds(lv)[0];
  setLevelAmbient(lv, { soundId: sound.id, volume: 0.5 });
  const a = getLevelAmbient(lv)!;
  assert.equal(a.volume, 0.5);
  setLevelAmbient(lv, { soundId: sound.id, volume: 0.8 }, true);
  assert.equal(getLevelAmbient(lv)!.rev, a.rev, "volume only: same play");
  assert.equal(getLevelAmbient(lv)!.volume, 0.8);
  setLevelAmbient(lv, null);
  const stopped = getLevelAmbient(lv)!;
  assert.ok(stopped.rev > a.rev);
  assert.deepEqual([stopped.loop, stopped.layer, stopped.once], [[], [], null]);
});
