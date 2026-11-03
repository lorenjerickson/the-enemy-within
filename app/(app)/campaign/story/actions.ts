"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireGm } from "@/lib/auth";
import { checkScript } from "@/lib/script";
import { checkGameState, fireTriggers } from "@/lib/game";
import { objectiveSettled, revealDiscovery } from "@/lib/storyRules";
import {
  DISCOVERY_KINDS, OBJECTIVE_STATUSES, RELATIONS, deleteDiscovery, deleteObjective, getDiscovery, getObjective, saveDiscovery,
  saveObjective, setLinks, setObjectiveCharacters, setObjectiveStatus, type DiscoveryKind, type ObjectiveStatus, type Relation,
} from "@/lib/story";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const id = (f: FormData, k: string) => Number(f.get(k)) || null;
const days = (f: FormData, k: string) => (text(f, k) === "" ? null : Math.max(0, Number(text(f, k)) || 0));

export async function submitDiscovery(discoveryId: number | null, formData: FormData) {
  await requireGm();
  const kind = text(formData, "kind") as DiscoveryKind;
  if (!DISCOVERY_KINDS.includes(kind)) throw new Error("Invalid discovery kind");
  // Owner is "location:3", "character:2", "item:5" or empty.
  const [ownerType, ownerId] = text(formData, "owner").split(":");
  const owner = (t: string) => (ownerType === t ? Number(ownerId) || null : null);
  const dc = text(formData, "reveal_dc");
  const onFound = text(formData, "on_found");
  const scriptError = checkScript(onFound);
  if (scriptError) throw new Error(`When found script: ${scriptError}`);
  const wasFound = discoveryId !== null && !!getDiscovery(discoveryId)?.found;
  const found = formData.get("found") === "on";
  const saved = saveDiscovery(discoveryId, {
    title: text(formData, "title") || "Untitled discovery",
    text: text(formData, "text"),
    kind,
    location_id: owner("location"),
    character_id: owner("character"),
    item_id: owner("item"),
    objective_id: id(formData, "objective_id"),
    found: found && wasFound ? 1 : 0, // newly found is applied below, so the "when found" script runs
    reveal: text(formData, "reveal"),
    reveal_skill: text(formData, "reveal_skill") || null,
    reveal_dc: dc === "" ? null : Math.round(Number(dc)) || null,
    on_found: onFound,
  });
  // Links: a "link:<otherId>" field per other discovery, set to a relation or empty.
  const links = [...formData.entries()].flatMap(([k, v]) =>
    k.startsWith("link:") && RELATIONS.includes(String(v) as Relation) ? [{ other_id: Number(k.slice(5)), relation: String(v) as Relation }] : []
  );
  setLinks(saved, links);
  if (found && !wasFound) {
    const r = revealDiscovery(saved); // also makes an objective it assigns known to the party
    if (r && !r.ok) throw new Error(`Saved and found, but its "when found" script failed: ${r.error}`);
  }
  revalidatePath("/campaign/story");
  redirect("/campaign/story?tab=discoveries");
}

export async function removeDiscovery(discoveryId: number) {
  await requireGm();
  deleteDiscovery(discoveryId);
  redirect("/campaign/story?tab=discoveries");
}

export async function submitObjective(objectiveId: number | null, formData: FormData) {
  await requireGm();
  const LABELS: Record<string, string> = {
    reward_script: "Reward script", penalty_script: "Penalty script", success_check: "Success condition", failure_check: "Failure condition",
  };
  for (const [k, label] of Object.entries(LABELS)) {
    const error = checkScript(text(formData, k));
    if (error) throw new Error(`${label}: ${error}`);
  }
  const saved = saveObjective(objectiveId, {
    title: text(formData, "title") || "Untitled objective",
    description: text(formData, "description"),
    success: text(formData, "success"),
    success_within_days: days(formData, "success_within_days"),
    success_check: text(formData, "success_check"),
    failure: text(formData, "failure"),
    failure_check: text(formData, "failure_check"),
    reward: text(formData, "reward"),
    reward_discovery_id: id(formData, "reward_discovery_id"),
    reward_script: text(formData, "reward_script"),
    penalty: text(formData, "penalty"),
    penalty_after_days: days(formData, "penalty_after_days"),
    penalty_script: text(formData, "penalty_script"),
    revealed: formData.get("revealed") === "on" ? 1 : 0,
    details_revealed: formData.get("details_revealed") === "on" ? 1 : 0,
  });
  setObjectiveCharacters(saved, formData.getAll("characters").map(Number).filter(Boolean));
  revalidatePath("/campaign/story");
  redirect("/campaign/story?tab=objectives");
}

export async function removeObjective(objectiveId: number) {
  await requireGm();
  deleteObjective(objectiveId);
  redirect("/campaign/story?tab=objectives");
}

/** Evaluates an objective's success and failure checks against the game state (nothing is changed). */
export async function checkObjective(objectiveId: number): Promise<string> {
  await requireGm();
  const o = getObjective(objectiveId);
  if (!o) throw new Error("Unknown objective");
  const describe = (label: string, source: string) => {
    if (!source.trim()) return `${label}: no condition.`;
    const r = checkGameState(source);
    return r.ok ? `${label}: ${r.value ? "met" : "not met"} (${JSON.stringify(r.value)}).` : `${label}: ${r.error}`;
  };
  return `${describe("Success", o.success_check)} ${describe("Failure", o.failure_check)}`;
}

/**
 * The GM settles an objective. Succeeding runs the reward script and the party finds the reward discovery;
 * failing runs the penalty script. Returns what happened, for the GM.
 */
export async function settleObjective(objectiveId: number, status: ObjectiveStatus): Promise<string> {
  await requireGm();
  if (!OBJECTIVE_STATUSES.includes(status)) throw new Error("Invalid status");
  const o = getObjective(objectiveId);
  if (!o) throw new Error("Unknown objective");
  if (o.status === status) return `Already ${status}.`;
  setObjectiveStatus(objectiveId, status);
  const notes: string[] = [`Marked ${status}.`, ...objectiveSettled(objectiveId, status)];
  fireTriggers(); // e.g. ON game.objectives['x'].status = 'failed' DO …
  revalidatePath(`/campaign/story/objectives/${objectiveId}`);
  revalidatePath("/campaign/story");
  return notes.join(" ");
}
