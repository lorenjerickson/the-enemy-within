"use client";

import { useEffect } from "react";

/**
 * Browser timing (TIMING=1; productization Phase 0, lib/timing.ts): every server action call and every page refresh
 * timed from the request leaving the browser to its whole response arriving, sent in batches to /api/timing as the
 * "browser" boundary. Server actions are named by their id (the server notes which name each id is); refreshes by path.
 */
export default function TimingProbe() {
  useEffect(() => {
    const w = window as typeof window & { __timingProbe?: boolean };
    if (w.__timingProbe) return;
    w.__timingProbe = true;
    const send = window.fetch.bind(window);
    let batch: { name: string; ms: number }[] = [];
    const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);
    window.fetch = async (input, init) => {
      const action = header(init, "Next-Action"), rsc = header(init, "RSC");
      if (!action && !rsc) return send(input, init);
      const t0 = performance.now(), res = await send(input, init);
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const name = action ? `action:${action}` : `refresh:${new URL(path, location.href).pathname}`;
      res.clone().arrayBuffer().then(() => batch.push({ name, ms: performance.now() - t0 }), () => {});
      return res;
    };
    const flush = () => {
      if (!batch.length) return;
      const body = JSON.stringify(batch.splice(0, 500));
      send("/api/timing", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    };
    const timer = setInterval(flush, 10_000);
    window.addEventListener("pagehide", flush);
    return () => { clearInterval(timer); window.removeEventListener("pagehide", flush); };
  }, []);
  return null;
}
