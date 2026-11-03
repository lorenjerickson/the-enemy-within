import { tryGameScript, type ScriptResult } from "./game";
import { findDiscovery, getDiscovery, getObjective, type ObjectiveStatus } from "./story";

/**
 * The party finds a discovery: it's marked found (and an objective it assigns becomes known), and its
 * "when found" script runs, e.g. to start a timer. Finding it again does nothing.
 * Returns the script's result, if it had one and ran.
 */
export function revealDiscovery(id: number): ScriptResult | null {
  const d = getDiscovery(id);
  if (!d || d.found) return null;
  findDiscovery(id);
  return d.on_found.trim() ? tryGameScript(d.on_found) : null;
}

/**
 * What follows an objective being settled (by the GM, or by a script): succeeding runs the reward script and the
 * party finds the reward discovery; failing runs the penalty script. Returns notes on what happened.
 */
export function objectiveSettled(id: number, status: ObjectiveStatus): string[] {
  const o = getObjective(id);
  if (!o) return [];
  const notes: string[] = [];
  if (status === "succeeded" && o.reward_discovery_id) {
    const r = revealDiscovery(o.reward_discovery_id);
    notes.push("The party found the reward discovery.");
    if (r) notes.push(r.ok ? `Its "when found" script ran: ${r.value}` : `Its "when found" script failed: ${r.error}`);
  }
  const script = status === "succeeded" ? o.reward_script : status === "failed" ? o.penalty_script : "";
  if (script.trim()) {
    const r = tryGameScript(script);
    notes.push(r.ok ? `${status === "succeeded" ? "Reward" : "Penalty"} script ran: ${r.value}` : `Script error: ${r.error}`);
  }
  return notes;
}
