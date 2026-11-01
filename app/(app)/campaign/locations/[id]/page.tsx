import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getLocation, listLevels } from "@/lib/db";
import { deleteLevel, submitLevel, submitLevelName } from "../actions";
import LocationForm from "../LocationForm";
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
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="tabs tabs-box tabs-sm">
            {levels.map((l) => (
              <Link
                key={l.id}
                role="tab"
                href={`/campaign/locations/${location.id}?level=${l.id}`}
                className={`tab ${l.id === level.id ? "tab-active" : ""}`}
              >
                {l.name}
              </Link>
            ))}
          </div>
          <form key={levels.length} action={submitLevel.bind(null, location.id)} className="flex gap-1">
            <input name="name" placeholder="New level name" className="input input-sm w-40" />
            <button className="btn btn-sm">+ Add level</button>
          </form>
        </div>
        <div className="flex items-center gap-2">
          <form key={`${level.id}:${level.name}`} action={submitLevelName.bind(null, location.id, level.id)} className="flex gap-1">
            <input name="name" defaultValue={level.name} required className="input input-sm w-48" aria-label="Level name" />
            <button className="btn btn-sm">Rename</button>
          </form>
          {levels.length > 1 && (
            <form action={deleteLevel.bind(null, location.id, level.id)}>
              <button className="btn btn-sm btn-ghost text-error">Remove level</button>
            </form>
          )}
        </div>
        <MapView key={level.id} locationId={location.id} levelId={level.id} hidden={level.hidden} background={level.background} />
      </div>
    </div>
  );
}
