"use client";

import { useEffect } from "react";

/**
 * Browser timing (TIMING=1; productization Phase 0, lib/timing.ts): every server action call and every page refresh,
 * from the request leaving the browser to its whole response arriving, sent in batches to /api/timing as the
 * "browser" boundary. The browser's own resource timings give the durations (refreshes are the `_rsc` requests); a
 * light hook on fetch only notes which server action each POST was (by its id; the server notes each id's name).
 */
export default function TimingProbe() {
  useEffect(() => {
    const w = window as typeof window & { __timingProbe?: boolean };
    if (w.__timingProbe || typeof PerformanceObserver === "undefined") return;
    w.__timingProbe = true;
    const send = window.fetch.bind(window);
    const actions: { id: string; at: number }[] = []; // server action calls not yet matched to a timing
    window.fetch = (input, init) => {
      const id = new Headers(init?.headers).get("next-action");
      if (id) actions.push({ id, at: performance.now() });
      return send(input, init);
    };
    const batch: { name: string; ms: number }[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (e.initiatorType !== "fetch") continue;
        const url = new URL(e.name, location.href);
        if (url.origin !== location.origin || url.pathname === "/api/timing") continue;
        let name: string;
        if (url.searchParams.has("_rsc")) name = `refresh:${url.pathname}`;
        else {
          const i = actions.findIndex((a) => Math.abs(a.at - e.startTime) < 100); // the action that started this request
          name = i >= 0 ? `action:${actions.splice(i, 1)[0].id}` : `fetch:${url.pathname}`;
        }
        batch.push({ name, ms: e.responseEnd - e.startTime });
      }
      while (actions.length && actions[0].at < performance.now() - 60_000) actions.shift(); // never matched: forgotten
    });
    observer.observe({ type: "resource", buffered: false });
    const flush = () => {
      performance.clearResourceTimings(); // the browser keeps only so many: keep room for new ones
      if (!batch.length) return;
      const body = JSON.stringify(batch.splice(0, 500));
      send("/api/timing", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    };
    const timer = setInterval(flush, 10_000);
    window.addEventListener("pagehide", flush);
    return () => { clearInterval(timer); observer.disconnect(); window.removeEventListener("pagehide", flush); };
  }, []);
  return null;
}
