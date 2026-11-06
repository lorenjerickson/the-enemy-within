import { getCurrentLevelId, getGmLevelId, listLevels, listLocations } from "@/lib/db";
import { loadLevel } from "./gmActions";

/** The GM's Locations tool: load any location's level on your map (players stay where they are), or go back to the party. */
export default function LocationsPanel() {
  const shown = getGmLevelId(), party = getCurrentLevelId();
  const locations = listLocations(); // already in order, parents before children
  return (
    <div className="space-y-3 text-sm" data-locations-panel>
      {shown !== party && party !== undefined && (
        <form action={loadLevel.bind(null, null)}>
          <button className="btn btn-primary btn-sm w-full">Back to the party</button>
        </form>
      )}
      <p className="text-xs opacity-60">Loads it on your map only; players stay where they are. Encounters and scripts work on the map you have loaded.</p>
      <ul className="space-y-2">
        {locations.map((l) => (
          <li key={l.id}>
            <div>
              <span className="font-semibold">{l.name}</span>
              {l.path && <span className="ml-1 text-xs opacity-60">in {l.path}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {listLevels(l.id).map((lv) => (
                <form key={lv.id} action={loadLevel.bind(null, lv.id)}>
                  <button data-load-level={lv.id} className={`btn btn-xs ${lv.id === shown ? "btn-primary" : ""}`}>
                    {lv.name}
                    {lv.id === party && <span className="badge badge-xs badge-success">party</span>}
                  </button>
                </form>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
