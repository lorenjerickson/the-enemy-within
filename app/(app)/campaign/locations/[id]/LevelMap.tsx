import { getPartyPlacement, getPartyStart, listEffects, listCharacters, listControls, listLights, listNotes, listAmbientSounds, listPositionalSounds, listAssets, listCreatures, listStructures, listTiles, listTokens, type MapLevel } from "@/lib/db";
import { scriptNames } from "@/lib/scriptNames";
import MapView from "./MapView";

/** One map level with everything on it, editable: used by the location editor and the GM's session view. */
export default function LevelMap({ locationId, level, levels }: { locationId: number; level: MapLevel; levels: MapLevel[] }) {
  const start = getPartyStart();
  const placement = getPartyPlacement();
  return (
    <MapView key={level.id} locationId={locationId} levelId={level.id} hidden={level.hidden} background={level.background} mapImage={level.mapImage} grid={level.grid} templateColors={level.templateColors}
      tileAssets={listAssets({ type: "image", usage: "tile" })}
      tiles={listTiles(level.id)}
      structures={listStructures(level.id)}
      tokens={listTokens(level.id)}
      sounds={listAmbientSounds(level.id)}
      positional={listPositionalSounds(level.id)}
      illumination={level.illumination}
      figureHeight={level.figure_height}
      lights={listLights(level.id)}
      notes={listNotes(level.id)}
      effects={listEffects(level.id)}
      scriptNames={scriptNames(level.id)}
      controls={listControls(level.id)}
      audioAssets={listAssets({ type: "audio", usage: "ambient" })}
      creatures={[
        ...listCharacters().map(({ id, name, type, image, token_overhead, token_side, height }) => ({ kind: "character" as const, id, name, type, image, token_overhead, token_side, height })),
        ...listCreatures().map(({ id, name, type, image, token_overhead, token_side, height }) => ({ kind: "creature" as const, id, name, type, image, token_overhead, token_side, height })),
      ]}
      toPlace={placement && placement.start.level_id === level.id ? placement.unplaced : []}
      partyStart={start && start.level_id === level.id ? { x: start.x, y: start.y, w: start.w, h: start.h } : null}
      partyStartElsewhere={start && start.level_id !== level.id ? `${start.location} › ${start.level}` : null}
      otherLevels={levels.filter((l) => l.id !== level.id).map(({ id, name }) => ({ id, name }))}
    />
  );
}
