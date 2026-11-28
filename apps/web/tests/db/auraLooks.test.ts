import { test } from "node:test";
import assert from "node:assert/strict";
import { creature, level } from "./seed";
import { saveEffectDef, setStandingEffects } from "@/lib/db/effects";
import { addCreatureToken } from "@/lib/db/tokens";
import { auraLooks } from "@/lib/auraSync";

test("an aura with a look is drawn round whoever gives it off (a circle of its radius following them); one without isn't", () => {
  const sick = saveEffectDef(null, { name: "Sickened", description: "", modifiers: [{ kind: "roll", roll: "attack", mode: "disadvantage" }], rounds: 1 });
  const stench = saveEffectDef(null, { name: "Stench", description: "", modifiers: [{ kind: "aura", condition: sick, radius: 10, who: "enemy", self: false, look: "poison" }], duration: "permanent" } as never);
  const quiet = saveEffectDef(null, { name: "Dread", description: "", modifiers: [{ kind: "aura", condition: sick, radius: 15, who: "enemy", self: false }], duration: "permanent" } as never);
  const ghoul = creature("Ghoul"), wight = creature("Wight");
  setStandingEffects({ creature_id: ghoul }, [stench]);
  setStandingEffects({ creature_id: wight }, [quiet]);
  const lv = level(), g = addCreatureToken(lv, ghoul, 4, 2);
  addCreatureToken(lv, wight, 8, 8);
  const looks = auraLooks(lv);
  assert.deepEqual(looks.map((l) => [l.look, l.area.origin, l.area.size]), [["poison", { x: 4.5, y: 2.5 }, 2]]);
  assert.deepEqual(auraLooks(lv, [g + 1]), [], "only round those they can see");
});
