"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addPing, listPings, type Ping, characterModifiers, closeRollRequest, getDoor, getOpenGameSession, getOpenRollRequest, getPlayerToken,
  logSessionEvent, requestRoll, saveRollResult, setDoorLocked, listSecrets, setSecretRevealed, listStructures, isGridlessLevel, isPortraitLevel, walkToken, getEncounter, listSightings, moveToken, getEncounterWaiting, setEncounterWaiting, saveEncounter, getRoundPlan, saveRoundPlan,
} from "@/lib/db";
import { cannotAdd, planEnd, timeline, type PlanStep } from "@/lib/roundPlan";
import type { PlayerActionId } from "@/lib/playerActions";
import { fireTriggers } from "@/lib/game";
import { snapHeight } from "@/lib/gravity";
import { blockingSegments, insidePolygon, visibilityPolygon, type Point } from "@/lib/visibility";
import { FEET_PER_SQUARE, clearPath, reachableSquares, shortestPath, squareKey, squareRoute } from "@/lib/movement";
import { revealDiscovery } from "@/lib/storyRules";
import { SEARCH_DC, SEARCH_RANGE } from "@/lib/playerActions";
import type { Attributes } from "@/lib/attributes";
import { scoreRoll, skillCheck } from "@/lib/rolls";
import { REACH, distanceToDoor } from "./reach";

/** A player asks to pick a locked door next to their character: they're prompted to roll sleight of hand against its DC. */
export async function pickLock(doorId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  const door = getDoor(Number(doorId));
  if (!me || !door || door.level_id !== me.level_id) return { error: "That door isn't here" };
  if (!door.locked) return { error: "It isn't locked" };
  if (distanceToDoor({ x: me.col + 0.5, y: me.row + 0.5 }, door) > REACH) return { error: "You're too far away" };
  const spec = skillCheck("sleight of hand", JSON.parse(me.attributes) as Attributes, characterModifiers(me.character_id, "skill:sleight of hand"));
  spec.label = `Pick the lock on ${door.name ?? `Door ${door.id}`}: ${spec.label}`;
  requestRoll(user.id, me.character_id, spec, { kind: "pickLock", doorId: door.id, dc: door.lock_dc });
  revalidatePath("/play");
  return {};
}

/** Search: the player is prompted for an Investigation check (DC 14); success reveals hidden things within 10 ft. */
export async function search(): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  const spec = skillCheck("investigation", JSON.parse(me.attributes) as Attributes, characterModifiers(me.character_id, "skill:investigation"));
  spec.label = `Search: ${spec.label}`;
  requestRoll(user.id, me.character_id, spec, { kind: "search", dc: SEARCH_DC });
  revalidatePath("/play");
  return {};
}

/** The player's dice have landed: check they fit the roll, score it, and settle what it was for. */
export async function submitRoll(requestId: number, thrown: number[][]): Promise<{ error?: string }> {
  const user = await requireUser();
  const req = getOpenRollRequest(user.id);
  if (!req || req.id !== Number(requestId) || req.result) return { error: "Nothing to roll" };
  const scored = scoreRoll(req.spec, thrown);
  if (!scored) return { error: "Those dice don't fit this roll" };
  let success = false, outcome = "";
  const a = req.action;
  if (a.kind === "pickLock") {
    const door = getDoor(a.doorId);
    const name = door?.name ?? `Door ${a.doorId}`;
    success = scored.total >= a.dc;
    if (success && door?.locked) setDoorLocked(door.id, false);
    outcome = success ? `The lock on ${name} clicks open.` : `The lock on ${name} won't give.`;
    logSessionEvent(`${getPlayerToken(user.id)?.name ?? user.name} ${success ? "picked the lock on" : "failed to pick the lock on"} ${name} (${scored.total} vs DC ${a.dc})`);
    outcome += ` (${scored.total} vs ${a.dc})`;
  }
  if (a.kind === "search") {
    const me = getPlayerToken(user.id);
    success = scored.total >= a.dc;
    const found = success && me
      ? listSecrets(me.level_id).filter((s) => !s.revealed && Math.hypot(s.x - (me.col + 0.5), s.y - (me.row + 0.5)) <= SEARCH_RANGE + 0.5)
      : [];
    for (const s of found) {
      setSecretRevealed(s.id, true);
      if (s.discovery_id) revealDiscovery(s.discovery_id); // into the party's journals
    }
    // Failing and finding nothing read the same, so a failed roll doesn't give away that something's there.
    outcome = found.length ? `You find: ${found.map((s) => (s.text ? `${s.name} (${s.text})` : s.name)).join("; ")}` : "You search but find nothing.";
    logSessionEvent(`${me?.name ?? user.name} searched (${scored.total} vs DC ${a.dc}): ${found.length ? `found ${found.map((s) => s.name).join(", ")}` : success ? "nothing there" : "failed"}`);
  }
  if (a.kind === "initiative") {
    // Into the turn order, highest first (a re-roll replaces an earlier one).
    const enc = getEncounter(a.levelId);
    if (enc) {
      const order = [...enc.order.filter((o) => o.token_id !== a.tokenId), { token_id: a.tokenId, initiative: scored.total }].sort((x, y) => y.initiative - x.initiative);
      saveEncounter(a.levelId, { ...enc, order });
      setEncounterWaiting(a.levelId, getEncounterWaiting(a.levelId).filter((id) => id !== a.tokenId));
    }
    success = true;
    outcome = `Initiative ${scored.total}.`;
    logSessionEvent(`${getPlayerToken(user.id)?.name ?? user.name} rolled ${scored.total} for initiative.`);
  }
  saveRollResult(req.id, { ...scored, outcome, success });
  revalidatePath("/play");
  return {};
}

export async function closeRoll(requestId: number): Promise<void> {
  const user = await requireUser();
  closeRollRequest(Number(requestId), user.id);
  revalidatePath("/play");
}

/** Points at a spot on the map for everyone in the session. */
export async function sendPing(levelId: number, x: number, y: number): Promise<void> {
  const user = await requireUser();
  if (!getOpenGameSession()?.began_at) return;
  addPing(Number(levelId), Number(x), Number(y), user);
}

/** Recent pings on this level after `afterId` (the caller's own are marked, as it has already shown them). */
export async function pingsSince(levelId: number, afterId: number): Promise<(Ping & { mine: boolean })[]> {
  const user = await requireUser();
  return listPings(Number(levelId), Number(afterId)).map((p) => ({ ...p, mine: p.user_id === user.id }));
}

/**
 * Move: the player's character walks to (col, row) if their movement left reaches it: on grid maps a square in
 * reach (costing 5 ft per step on the shortest route), on gridless maps a point in a clear straight line.
 */
export async function moveMyToken(col: number, row: number): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  if (isPortraitLevel(me.level_id)) return { error: "Not on side-on maps yet" };
  if (!getEncounter(me.level_id)) return { error: "Out of an encounter, movement is free" };
  const left = Math.max(0, (JSON.parse(me.movement).walking ?? 0) - me.moved);
  const walls = blockingSegments(listStructures(me.level_id));
  let feet: number;
  if (isGridlessLevel(me.level_id)) {
    const from = { x: me.col + 0.5, y: me.row + 0.5 }, to = { x: Number(col) + 0.5, y: Number(row) + 0.5 };
    feet = Math.round(Math.hypot(to.x - from.x, to.y - from.y) * FEET_PER_SQUARE * 10) / 10;
    if (feet > left + 0.05) return { error: "Too far" };
    if (!clearPath(from, to, walls)) return { error: "Something's in the way" };
  } else {
    const c = Math.round(Number(col)), r = Math.round(Number(row));
    const square = reachableSquares({ col: me.col, row: me.row }, left / FEET_PER_SQUARE, walls).get(squareKey(c, r));
    if (!square) return { error: "You can't reach that square" };
    feet = square.steps * FEET_PER_SQUARE;
    col = c;
    row = r;
  }
  if (feet <= 0) return {};
  walkToken(me.token_id, Number(col), Number(row), feet);
  revalidatePath("/play");
  return {};
}

/**
 * Free movement (outside encounters): the player's character walks to any spot they've seen that they can get to,
 * by the shortest route, without spending movement. It walks step by step and stops early where a map event
 * happens (a trigger goes off). Returns the route walked (token corners, grid units) so the map can play it.
 */
export async function freeMove(gx: number, gy: number): Promise<{ route?: Point[]; stopped?: boolean; error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  if (isPortraitLevel(me.level_id)) return { error: "Not on side-on maps yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, movement is limited" };
  const walls = blockingSegments(listStructures(me.level_id));
  const here = { x: me.col + 0.5, y: me.row + 0.5 };
  // What they've seen: from where they stand now and everywhere they've stood on this level.
  const seen = [here, ...listSightings(user.id, me.level_id)].map((p) => visibilityPolygon(p, 500, walls));
  const revealed = (p: Point) => seen.some((poly) => insidePolygon(p, poly));
  const target = { x: Number(gx), y: Number(gy) };

  let route: Point[]; // token corners (col, row) to step through, start first
  if (isGridlessLevel(me.level_id)) {
    if (!revealed(target)) return { error: "You haven't seen that spot" };
    const path = shortestPath(here, target, walls, revealed);
    if (!path) return { error: "You can't get there" };
    // Step about one unit (5 ft) at a time along the path, so map events can stop the walk on the way.
    route = [{ x: me.col, y: me.row }];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let s = 1; s <= n; s++) route.push({ x: snapHeight(a.x + ((b.x - a.x) * s) / n - 0.5), y: snapHeight(a.y + ((b.y - a.y) * s) / n - 0.5) });
    }
  } else {
    const goal = { col: Math.floor(target.x), row: Math.floor(target.y) };
    if (!revealed({ x: goal.col + 0.5, y: goal.row + 0.5 })) return { error: "You haven't seen that spot" };
    const squares = squareRoute({ col: me.col, row: me.row }, goal, walls, (c, r) => revealed({ x: c + 0.5, y: r + 0.5 }));
    if (!squares) return { error: "You can't get there" };
    route = squares.map((s) => ({ x: s.col, y: s.row }));
  }

  const walked: Point[] = [route[0]];
  let stopped = false;
  for (const step of route.slice(1)) {
    moveToken(me.token_id, step.x, step.y); // also remembers what they saw from here
    walked.push(step);
    if (fireTriggers().length) {
      stopped = true; // the player isn't told which trigger (that's the GM's script)
      break;
    }
  }
  revalidatePath("/play");
  return { route: walked, stopped };
}

/** The player's character in a running encounter, with its plan for this round. */
function planner(userId: number) {
  const me = getPlayerToken(userId);
  if (!me || !getEncounter(me.level_id)) return null;
  return { me, walking: JSON.parse(me.movement).walking ?? 0, ...getRoundPlan(me.level_id, me.token_id) };
}

/** Round planning: add an action, or a move to a square (reachable from where the plan leaves them, in the time left). */
export async function planStep(step: { kind: "action"; action: PlayerActionId } | { kind: "move"; col: number; row: number }): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  if (!p) return { error: "Not in an encounter" };
  if (p.ready) return { error: "You're ready; undo that to change your plan" };
  let add: PlanStep;
  if (step.kind === "move") {
    const from = planEnd(p.plan, { col: p.me.col, row: p.me.row });
    const feetLeft = (timeline(p.plan, p.walking).left * p.walking) / 6;
    const walls = blockingSegments(listStructures(p.me.level_id));
    if (isGridlessLevel(p.me.level_id)) {
      const to = { col: snapHeight(Number(step.col)), row: snapHeight(Number(step.row)) };
      const feet = Math.round(Math.hypot(to.col - from.col, to.row - from.row) * FEET_PER_SQUARE * 10) / 10;
      if (feet > feetLeft + 0.05 || !clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls)) return { error: "You can't get there in time" };
      add = { kind: "move", to, feet };
    } else {
      const sq = reachableSquares(from, feetLeft / FEET_PER_SQUARE, walls).get(squareKey(Math.round(Number(step.col)), Math.round(Number(step.row))));
      if (!sq || !sq.steps) return { error: "You can't get there in time" };
      add = { kind: "move", to: { col: sq.col, row: sq.row }, feet: sq.steps * FEET_PER_SQUARE };
    }
  } else {
    add = { kind: "action", action: step.action };
  }
  const why = cannotAdd(p.plan, add, p.walking);
  if (why) return { error: why };
  saveRoundPlan(p.me.level_id, p.me.token_id, [...p.plan, add], false);
  revalidatePath("/play");
  return {};
}

/** Takes the last step off the plan (and un-readies). */
export async function undoStep(): Promise<void> {
  const user = await requireUser();
  const p = planner(user.id);
  if (p) saveRoundPlan(p.me.level_id, p.me.token_id, p.plan.slice(0, -1), false);
  revalidatePath("/play");
}

export async function setPlanReady(ready: boolean): Promise<void> {
  const user = await requireUser();
  const p = planner(user.id);
  if (p) saveRoundPlan(p.me.level_id, p.me.token_id, p.plan, !!ready);
  revalidatePath("/play");
}
