import { getVars, listCharacters, listEffects, listLights, listLocations, listStructures, listTimers, listTokens } from "./db";
import type { ScriptNames } from "./scriptSchema";

/**
 * Real names for the script editor's autocomplete. With a map level (map button scripts), lights, effects,
 * doors and actors are that level's; without one there's no current location, so they're left out.
 */
export function scriptNames(levelId?: number): ScriptNames {
  const names: ScriptNames = {
    character: listCharacters().map((c) => c.name),
    location: listLocations().map((l) => l.name),
    timer: listTimers().map((t) => t.name),
    var: Object.keys(getVars()),
  };
  if (levelId !== undefined) {
    const tokens = listTokens(levelId);
    names.actor = tokens.map((t) => t.name);
    names.creature = tokens.filter((t) => t.creature_id).map((t) => t.name);
    names.light = listLights(levelId).map((l) => l.name);
    names.effect = listEffects(levelId).map((e) => e.name);
    names.door = listStructures(levelId).filter((s) => s.kind === "door").map((s) => s.name ?? `Door ${s.id}`);
  }
  // Each name once (several rats share a name).
  for (const k of Object.keys(names) as (keyof ScriptNames)[]) names[k] = [...new Set(names[k])];
  return names;
}
