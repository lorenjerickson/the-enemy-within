import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getLocation, listLights, listNotes, listAmbientSounds, listPositionalSounds, listAssets, listCreatures, listLevels, listStructures, listTiles, listTokens } from "@/lib/db";
import LocationForm from "../LocationForm";
import LevelBar from "./LevelBar";
import MapView from "./MapView";

export default async function EditLocation({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ level?: string }>;
}) {
  await connection();
  await requireGm();
  const location = getLocation(Number((await params).id));
  if (!location) notFound();
  const levels = listLevels(location.id);
  const levelId = Number((await searchParams).level);
  const level = levels.find((l) => l.id === levelId) ?? levels[0];

  return (
    <div className="space-y-8">
      <LocationForm initial={location} />
      <div className="max-w-4xl space-y-3">
        <h3 className="font-semibold">Map</h3>
        <LevelBar locationId={location.id} levels={levels.map(({ id, name }) => ({ id, name }))} currentId={level.id} />
        <MapView key={level.id} locationId={location.id} levelId={level.id} hidden={level.hidden} background={level.background} mapImage={level.mapImage} grid={level.grid} templateColors={level.templateColors}
          tileAssets={listAssets({ type: "image", usage: "tile" })}
          tiles={listTiles(level.id)}
          structures={listStructures(level.id)}
          tokens={listTokens(level.id)}
          sounds={listAmbientSounds(level.id)}
          positional={listPositionalSounds(level.id)}
          illumination={level.illumination}
          lights={listLights(level.id)}
          notes={listNotes(level.id)}
          audioAssets={listAssets({ type: "audio", usage: "ambient" })}
          creatures={listCreatures().map(({ id, name, type, image }) => ({ id, name, type, image }))}
          otherLevels={levels.filter((l) => l.id !== level.id).map(({ id, name }) => ({ id, name }))}
        />
      </div>
    </div>
  );
}
