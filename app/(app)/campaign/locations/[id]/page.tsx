import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getLocation, listLevels } from "@/lib/db";
import LocationForm, { LOCATION_FORM_ID } from "../LocationForm";
import LevelBar from "./LevelBar";
import LevelMap from "./LevelMap";

export default async function EditLocation({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ level?: string; tab?: string }>;
}) {
  await connection();
  await requireGm();
  const location = getLocation(Number((await params).id));
  if (!location) notFound();
  const levels = listLevels(location.id);
  const { level: levelParam, tab: tabParam } = await searchParams;
  const level = levels.find((l) => l.id === Number(levelParam)) ?? levels[0];
  // One tab per slice of a location's data; the map is where most of the work happens, so it's first.
  const tab = TABS.find((t) => t.id === tabParam)?.id ?? "map";

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-6 border-b border-base-300">
        <h2 className="text-xl font-semibold pb-2">{location.name}</h2>
        <div role="tablist" className="tabs tabs-border">
          {TABS.map((t) => (
            <Link key={t.id} role="tab" href={`/campaign/locations/${location.id}?tab=${t.id}`} className={`tab ${tab === t.id ? "tab-active" : ""}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {/* Saves the Details form from any tab; right-aligned with the editing surface. */}
        <button form={LOCATION_FORM_ID} className="btn btn-primary btn-sm ml-auto mb-2">Save location</button>
      </div>
      {/* Always rendered (hidden on other tabs) so the header's Save button works from any tab. */}
      <div className={tab === "details" ? "" : "hidden"}>
        <LocationForm initial={location} />
      </div>
      {tab === "details" ? null : (
      <div className="space-y-3">
        <div className="max-w-4xl">
          <LevelBar locationId={location.id} levels={levels.map(({ id, name }) => ({ id, name }))} currentId={level.id} />
        </div>
        <LevelMap locationId={location.id} level={level} levels={levels} />
      </div>
      )}
    </div>
  );
}

const TABS = [
  { id: "map", label: "Map" },
  { id: "details", label: "Details" },
] as const;
