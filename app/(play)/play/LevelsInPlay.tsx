import { getGmLevelId, listLevels, listLocations } from "@/lib/db/maps";
import { listPlayerPlaces } from "@/lib/db/tokens";
import { getEncounter, listEncounterLevels } from "@/lib/db/encounters";
import { loadLevel } from "./gmActions";

/**
 * The party split across levels: one button per level that has player characters or an encounter on it, to switch the
 * GM's map there (each level's encounter carries on by itself). Shown only when there's more than one.
 */
export default function LevelsInPlay() {
  const shown = getGmLevelId();
  const withPlayers = listPlayerPlaces().flatMap((p) => (p.level_id === null ? [] : [p.level_id]));
  const withFights = listEncounterLevels();
  const ids = [...new Set([...withPlayers, ...withFights])];
  if (ids.length < 2) return null;
  const levels = listLocations().flatMap((l) => listLevels(l.id).map((lv) => ({ ...lv, place: l.name })));
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-levels-in-play>
      <span className="font-semibold opacity-80">Levels in play:</span>
      {ids.map((id) => {
        const lv = levels.find((x) => x.id === id), enc = getEncounter(id), here = withPlayers.filter((x) => x === id).length;
        return (
          <form key={id} action={loadLevel.bind(null, id)}>
            <button className={`btn btn-xs ${id === shown ? "btn-primary" : ""}`} title={`${lv?.place ?? ""} › ${lv?.name ?? ""}`}>
              {lv?.name ?? `Level ${id}`}
              {enc && <span className="badge badge-xs badge-warning">round {enc.round}</span>}
              {here > 0 && <span className="badge badge-xs">{here}</span>}
            </button>
          </form>
        );
      })}
    </div>
  );
}
