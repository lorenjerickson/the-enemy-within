import { getPartyPlacement, getPartyStart, listEffects, listCharacters, listControls, listLights, listNotes, listAmbientSounds, listPositionalSounds, listAssets, listCreatures, listStructures, listTiles, listTokens, type MapLevel } from "@/lib/db";
import { scriptNames } from "@/lib/scriptNames";
import MapView from "./MapView";
import type { DockTool } from "../../../../(play)/play/PlayDock";

/** One map level with everything on it, editable: used by the location editor and the GM's session view. */
export default function LevelMap({
  locationId,
  level,
  levels,
  readOnly = false,
  dock,
}: {
  locationId: number;
  level: MapLevel;
  levels: MapLevel[];
  readOnly?: boolean;
  dock?: { side: "left" | "right"; tools: DockTool[]; initial?: string | null }; // in a session: full screen, with this dock
}) {
  // A player's view gets nothing GM-only (notes, controls, scripts, sounds, the creature list).
  const gm = !readOnly;
  const start = getPartyStart();
  const placement = getPartyPlacement();
  return (
    <MapView readOnly={readOnly} dockSide={dock?.side} dockTools={dock?.tools} dockInitial={dock?.initial} key={level.id} locationId={locationId} levelId={level.id} hidden={level.hidden} background={level.background} mapImage={level.mapImage} grid={level.grid} templateColors={level.templateColors}
      tileAssets={gm ? listAssets({ type: "image", usage: "tile" }) : []}
      tiles={listTiles(level.id)}
      structures={listStructures(level.id)}
      tokens={listTokens(level.id)}
      sounds={gm ? listAmbientSounds(level.id) : []}
      positional={gm ? listPositionalSounds(level.id) : []}
      illumination={level.illumination}
      figureHeight={level.figure_height}
      lights={listLights(level.id)}
      notes={gm ? listNotes(level.id) : []}
      effects={listEffects(level.id)}
      scriptNames={gm ? scriptNames(level.id) : {}}
      controls={gm ? listControls(level.id) : []}
      audioAssets={gm ? listAssets({ type: "audio", usage: "ambient" }) : []}
      creatures={!gm ? [] : [
        ...listCharacters().map(({ id, name, type, image, token_overhead, token_side, height }) => ({ kind: "character" as const, id, name, type, image, token_overhead, token_side, height })),
        ...listCreatures().map(({ id, name, type, image, token_overhead, token_side, height }) => ({ kind: "creature" as const, id, name, type, image, token_overhead, token_side, height })),
      ]}
      toPlace={gm && placement && placement.start.level_id === level.id ? placement.unplaced : []}
      partyStart={start && start.level_id === level.id ? { x: start.x, y: start.y, w: start.w, h: start.h } : null}
      partyStartElsewhere={start && start.level_id !== level.id ? `${start.location} › ${start.level}` : null}
      otherLevels={levels.filter((l) => l.id !== level.id).map(({ id, name }) => ({ id, name }))}
    />
  );
}
