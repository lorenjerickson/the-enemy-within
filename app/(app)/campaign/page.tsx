import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getPartyStart } from "@/lib/db";
import CampaignImport from "./CampaignImport";

export default async function CampaignOverview() {
  await connection();
  await requireGm();
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
        <CampaignImport />
        <p className="text-xs opacity-60">Importing replaces this server's campaign and player accounts and logs everyone out; log in again with an account from the export.</p>
      </section>
    </div>
  );
}
