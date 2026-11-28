"use client";

import { useEffect, useRef, useState } from "react";
import { checkPlanClock } from "./actions";

/** Seconds left to plan (the last player still planning), ticking; at 0 it asks the server to settle it straight away. */
export default function PlanCountdown({ endsAt, compact = false }: { endsAt: number; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const asked = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  useEffect(() => {
    if (left === 0 && !asked.current) { asked.current = true; checkPlanClock().catch(() => {}); }
  }, [left]);
  if (compact) return <span className={`badge badge-sm ${left <= 10 ? "badge-error" : "badge-warning"}`} data-plan-countdown title="Seconds left to plan before they go without">{left} s</span>;
  return (
    <div role="timer" className={`alert py-2 text-sm ${left <= 10 ? "alert-error" : "alert-warning"}`} data-plan-countdown>
      <span className="font-semibold">{left} s</span>
      <span>Everyone else is ready. Finish your plan and press Ready, or you go without one this round.</span>
      <progress className="progress w-24" value={left} max={30} />
    </div>
  );
}
