import { requireGm } from "@/lib/auth";
import { exportCampaign } from "@/lib/campaignArchive";

/** Downloads the whole campaign (not session data) as a .zip, for importing on another server. */
export async function GET() {
  await requireGm();
  const zip = exportCampaign();
  const day = new Date().toISOString().slice(0, 10);
  return new Response(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="the-enemy-within-campaign-${day}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
