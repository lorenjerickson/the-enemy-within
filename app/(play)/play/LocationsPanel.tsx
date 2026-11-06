import { getCurrentLevelId, getGmLevelId, getPlayerTokenLevelId, listLevels, listLocations, listPlayerPlaces } from "@/lib/db";
import { loadLevel } from "./gmActions";

/**
 * The GM's Locations tool: where each player's token is, and activating a location's level on the GM's map.
 * Players always see the map their own token is on, so anyone with a token in the active location sees it too
 * (including tokens placed there later); everyone else stays where they are.
 */
export default function LocationsPanel() {
  const shown = getGmLevelId(), party = getCurrentLevelId();
  const locations = listLocations(); // already in order, parents before children
  return (
    <div className="space-y-3 text-sm" data-locations-panel>
      <div className="space-y-1" data-player-places>
        <div className="font-semibold">Players</div>
        <ul className="space-y-1">
          {[...Map.groupBy(listPlayerPlaces(), (p) => p.character)].map(([character, places]) => {
            const seeing = getPlayerTokenLevelId(places[0].player_id);
            return (
              <li key={character} className="rounded bg-base-100/60 px-2 py-1">
                <span className="font-semibold">{character}</span> <span className="text-xs opacity-60">({places[0].player})</span>
                <ul>
                  {places.map((p) =>
                    p.level_id === null ? (
                      <li key="none" className="text-xs opacity-80">not placed on any map</li>
                    ) : (
                      <li key={p.level_id} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 opacity-80">{p.location} › {p.level}</span>
                        {p.level_id === seeing && <span className="badge badge-xs badge-success">sees this</span>}
                        {p.level_id === shown ? (
                          <span className="badge badge-xs badge-primary">active</span>
                        ) : (
                          <form action={loadLevel.bind(null, p.level_id)}>
                            <button className="btn btn-xs">Activate</button>
                          </form>
                        )}
                      </li>
                    )
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
      {shown !== party && party !== undefined && (
        <form action={loadLevel.bind(null, null)}>
          <button className="btn btn-sm w-full">Activate the party&apos;s location</button>
        </form>
      )}
      <div className="font-semibold">Activate a location</div>
      <p className="text-xs opacity-60">Players whose tokens are there see it; place a player&apos;s token there (Tokens layer) to bring them along. Encounters and scripts work on the active location.</p>
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
                  <button data-load-level={lv.id} title={lv.id === shown ? "Active" : "Activate"} className={`btn btn-xs ${lv.id === shown ? "btn-primary" : ""}`}>
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
