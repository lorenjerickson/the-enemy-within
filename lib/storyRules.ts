import { tryGameScript, type ScriptResult } from "./game";
import { listPartyMembers } from "./db";
import { addJournalEntry, findDiscovery, getDiscovery, getObjective, objectiveRecipients, syncObjectiveJournals, type ObjectiveStatus } from "./story";

/**
 * A discovery is revealed to some of the party (by default all of it): its title and text are written into
 * their journals. The first time it's found, an objective it assigns becomes known and its "when found" script
 * runs. Returns the script's result, if it ran.
 */
export function revealDiscovery(id: number, characterIds?: number[]): ScriptResult | null {
  const d = getDiscovery(id);
  if (!d) return null;
  for (const c of characterIds ?? listPartyMembers().map((m) => m.id)) addJournalEntry(c, { discovery_id: id }, d.title, d.text);
  if (d.found) return null;
  findDiscovery(id);
  syncObjectiveJournals(); // the objective it assigns, now known
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
    const r = revealDiscovery(o.reward_discovery_id, objectiveRecipients(id));
    notes.push("The reward discovery was revealed to those it was for.");
    if (r) notes.push(r.ok ? `Its "when found" script ran: ${r.value}` : `Its "when found" script failed: ${r.error}`);
  }
  const script = status === "succeeded" ? o.reward_script : status === "failed" ? o.penalty_script : "";
  if (script.trim()) {
    const r = tryGameScript(script);
    notes.push(r.ok ? `${status === "succeeded" ? "Reward" : "Penalty"} script ran: ${r.value}` : `Script error: ${r.error}`);
  }
  return notes;
}
