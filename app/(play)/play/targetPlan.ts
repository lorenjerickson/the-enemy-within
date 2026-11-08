"use client";

import { gmPlanStep } from "./gmActions";
import { planStep } from "./actions";
import type { TargetMode } from "./targetMode";

/** Plans the action being aimed: at one target, at the picked ones, or at an aimed spot (and, there, the picked ones). */
export function planTargeted(m: NonNullable<TargetMode>, sel: { target?: number; picks?: number[]; aim?: { col: number; row: number } }) {
  const step = {
    kind: "action" as const,
    action: m.action,
    ...(m.use !== undefined ? { use: m.use } : {}),
    ...(m.seconds ? { seconds: m.seconds } : {}),
    ...(sel.target !== undefined ? { target: sel.target } : {}),
    ...(sel.picks?.length ? { picks: sel.picks } : {}),
    ...(sel.aim ? { aim: sel.aim } : {}),
  };
  return m.tokenId !== null ? gmPlanStep(m.tokenId, step) : planStep(step);
}
