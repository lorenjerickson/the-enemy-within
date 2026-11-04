import Link from "next/link";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getPartyStart } from "@/lib/db";

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
    </div>
  );
}
