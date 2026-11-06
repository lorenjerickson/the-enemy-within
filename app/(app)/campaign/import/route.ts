import { requireGm } from "@/lib/auth";
import { importCampaign } from "@/lib/campaignArchive";

/**
 * Replaces this server's campaign with an uploaded export (a form post with `archive` and the `replace` box ticked).
 * Everyone is logged out afterwards, since the user accounts come from the archive.
 */
export async function POST(request: Request) {
  await requireGm();
  const form = await request.formData();
  const file = form.get("archive");
  const back = (q: string) => new Response(null, { status: 303, headers: { Location: q } });
  if (!(file instanceof File) || !file.size) return back("/campaign?import=missing");
  if (form.get("replace") !== "on") return back("/campaign?import=unconfirmed");
  try {
    const r = importCampaign(new Uint8Array(await file.arrayBuffer()));
    return back(`/login?imported=${r.rows}-${r.files}`);
  } catch (e) {
    return back(`/campaign?import=${encodeURIComponent((e as Error).message)}`);
  }
}
