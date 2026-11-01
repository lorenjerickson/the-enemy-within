import fs from "node:fs";
import path from "node:path";
import { CONTENT_TYPES, IMAGE_DIR } from "@/lib/images";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = path.basename((await params).file);
  const type = CONTENT_TYPES[path.extname(file).slice(1)];
  const full = path.join(IMAGE_DIR, file);
  if (!type || !fs.existsSync(full)) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(full), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
