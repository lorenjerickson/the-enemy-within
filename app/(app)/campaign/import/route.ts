import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { requireGm } from "@/lib/auth";
import { importCampaignFile } from "@/lib/campaignArchive";
import { DATA_DIR } from "@/lib/db";

/**
 * Replaces this server's campaign with an uploaded export. The .zip is the request body (not a form), streamed to
 * the data volume and imported from there, so a large export never has to fit in memory. Everyone is logged out
 * afterwards, since the user accounts come from the archive.
 */
export async function POST(request: Request) {
  await requireGm();
  if (new URL(request.url).searchParams.get("replace") !== "1" || !request.body) {
    return Response.json({ ok: false, error: "Send the export as the body, with ?replace=1 to confirm" }, { status: 400 });
  }
  const upload = path.join(DATA_DIR, `import-${Date.now()}.zip`);
  try {
    await pipeline(Readable.fromWeb(request.body as WebReadableStream), fs.createWriteStream(upload));
    const r = await importCampaignFile(upload);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  } finally {
    fs.rmSync(upload, { force: true });
  }
}
