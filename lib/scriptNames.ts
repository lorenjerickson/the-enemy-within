import { getVars, listCharacters, listEffects, listLights, listLocations, listStructures, listTimers, listTokens } from "./db";
import type { ScriptNames } from "./scriptSchema";
import { listObjectives } from "./story";
import { listLibraryScripts } from "./scriptLibrary";

/**
 * Real names for the script editor's autocomplete. With a map level (map button scripts), lights, effects,
 * doors and actors are that level's; without one there's no current location, so they're left out.
 */
export function scriptNames(levelId?: number): ScriptNames {
  const names: ScriptNames = {
    character: listCharacters().map((c) => c.name),
    location: listLocations().map((l) => l.name),
    timer: listTimers().map((t) => t.name),
    objective: listObjectives().map((o) => o.title),
    var: Object.keys(getVars()),
    script: listLibraryScripts().map((s) => s.name), // run('…')
  };
  names.about = Object.fromEntries(listLibraryScripts().filter((s) => s.description).map((s) => [s.name, s.description]));
  if (levelId !== undefined) {
    const tokens = listTokens(levelId);
    names.actor = tokens.map((t) => t.name);
    names.creature = tokens.filter((t) => t.creature_id).map((t) => t.name);
    names.light = listLights(levelId).map((l) => l.name);
    names.effect = listEffects(levelId).map((e) => e.name);
    names.door = listStructures(levelId).filter((s) => s.kind === "door").map((s) => s.name ?? `Door ${s.id}`);
  }
  // Each name once (several rats share a name).
  for (const k of Object.keys(names) as Exclude<keyof ScriptNames, "about">[]) if (Array.isArray(names[k])) names[k] = [...new Set(names[k])];
  return names;
}
