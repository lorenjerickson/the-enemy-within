import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getPartyStart } from "@/lib/db";

export default async function CampaignOverview({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  await connection();
  await requireGm();
  const importError = (await searchParams).import;
  const start = getPartyStart();
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Overview</h2>
      <div className="text-sm" data-party-start>
        <span className="font-semibold">Party starts at: </span>
        {start ? (
          <Link className="link" href={`/campaign/locations/${start.location_id}?level=${start.level_id}`}>
            {start.location} › {start.level}
          </Link>
        ) : (
          <span className="opacity-60">not set — open a location's map, Tokens layer, and mark the start area.</span>
        )}
      </div>
      <section className="space-y-2 rounded-box bg-base-200 p-4 text-sm max-w-2xl" data-campaign-archive>
        <h3 className="font-semibold">Move the campaign to another server</h3>
        <p className="opacity-70">
          Export downloads everything except session data (game nights and their log, pings, rolls in progress, round
          plans, encounters): locations and maps, characters, creatures, items, professions, story, scripts and triggers,
          player accounts, and all uploaded images and sounds. Import it on the other server.
        </p>
        <a href="/campaign/export" className="btn btn-sm btn-primary" download>Export campaign (.zip)</a>
        <form action="/campaign/import" method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2 pt-2">
          <input type="file" name="archive" accept=".zip,application/zip" required className="file-input file-input-sm" />
          <label className="flex items-center gap-1">
            <input type="checkbox" name="replace" required className="checkbox checkbox-sm" />
            Replace everything on this server with it
          </label>
          <button className="btn btn-sm btn-warning">Import</button>
        </form>
        {importError && <p className="text-error">Import failed: {importError === "unconfirmed" ? "tick the box to confirm" : importError === "missing" ? "choose an export file" : importError}</p>}
        <p className="text-xs opacity-60">Importing replaces this server's campaign and player accounts and logs everyone out; log in again with an account from the export.</p>
      </section>
    </div>
  );
}
