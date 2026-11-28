import { record, timingOn } from "@/lib/timing";

/** Browsers' timing samples (TIMING=1; app/TimingProbe.tsx): recorded as the "browser" boundary. */
export async function POST(req: Request): Promise<Response> {
  if (!timingOn()) return new Response(null, { status: 204 });
  const body = (await req.json().catch(() => [])) as unknown;
  for (const s of Array.isArray(body) ? body.slice(0, 500) : []) {
    const { name, ms } = (s ?? {}) as { name?: unknown; ms?: unknown };
    if (typeof name === "string" && name.length <= 200 && typeof ms === "number" && ms >= 0 && ms < 600_000) record("browser", name, ms);
  }
  return new Response(null, { status: 204 });
}
