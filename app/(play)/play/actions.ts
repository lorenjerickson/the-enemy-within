"use server";

import { applyConditionNow, recordConditionSave, recordRollOff } from "./workOutRound";
import { gearActions, useUpItem } from "@/lib/combat";
import type { Condition } from "@/lib/conditions";
import { saveRollFor, skillCheckFor, speedOf } from "@/lib/creatureChanges";
import { setTokenTarget } from "@/lib/db";
import { seenFrom } from "@/lib/sight";
import { planEnd } from "@/lib/roundPlan";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addPing, listPings, type Ping, closeRollRequest, settleInitiative, getDoor, getOpenGameSession, getOpenRollRequest, getPlayerToken,
  logSessionEvent, requestRoll, saveRollResult, setDoorLocked, listSecrets, setSecretRevealed, listStructures, isGridlessLevel, isPortraitLevel, walkToken, getEncounter, listSightings, moveToken, moveTokenToLevel, getLinkPrompt, clearLinkPrompt, setStandingOrder, clearStandingOrder, listTokens, addTokenWalk, listTokenWalks, tokenLabels, getEncounterWaiting, setEncounterWaiting, saveEncounter, getRoundPlan, saveRoundPlan, listMapFx } from "@/lib/db";
import { addPlanStep, setReady, startPlanRoll, submitPlanRoll, tokenPlanner, removePlanStep, type StepRequest } from "@/lib/roundPlanServer";
import { syncAurasOn } from "@/lib/auraSync";
import { snapHeight } from "@/lib/gravity";
import { blockingSegments, insidePolygon, movementBlockers, visibilityPolygon, type Point } from "@/lib/visibility";
import { FEET_PER_SQUARE, clearPath, reachableSquares, shortestPath, squareKey, squareRoute } from "@/lib/movement";
import { revealDiscovery } from "@/lib/storyRules";
import { SEARCH_DC, SEARCH_RANGE } from "@/lib/playerActions";
import { listTraps, setTrapFound } from "@/lib/db";
import { distanceToTrap } from "@/lib/traps";
import { arrivalSpot, inLink } from "@/lib/levelLinks";
import { moveFollowers, walkRoute } from "./walk";
import { walkLength } from "@/lib/standing";
import type { Attributes } from "@/lib/attributes";
import { rollSpec, scoreRoll } from "@/lib/rolls";
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
  const spec = skillCheckFor(me.token_id, "sleight of hand", JSON.parse(me.attributes) as Attributes);
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
  const spec = skillCheckFor(me.token_id, "investigation", JSON.parse(me.attributes) as Attributes);
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
    // Traps in range they beat the find DC of (each trap has its own).
    const traps = me ? listTraps(me.level_id).filter((t) => !t.found && scored.total >= t.find_dc && distanceToTrap(t.area, { x: me.col + 0.5, y: me.row + 0.5 }) <= SEARCH_RANGE + 0.5) : [];
    for (const t of traps) setTrapFound(t.id, true);
    const names = [...found.map((s) => (s.text ? `${s.name} (${s.text})` : s.name)), ...traps.map((t) => `a trap (${t.name})`)];
    if (traps.length) success = true;
    // Failing and finding nothing read the same, so a failed roll doesn't give away that something's there.
    outcome = names.length ? `You find: ${names.join("; ")}` : "You search but find nothing.";
    logSessionEvent(`${me?.name ?? user.name} searched (${scored.total} vs DC ${a.dc}): ${names.length ? `found ${[...found.map((s) => s.name), ...traps.map((t) => `trap ${t.name}`)].join(", ")}` : success ? "nothing there" : "failed"}`);
  }
  if (a.kind === "initiative") {
    // Into the turn order, highest first (a re-roll replaces an earlier one).
    settleInitiative(a.levelId, a.tokenId, scored.total);
    success = true;
    outcome = `Initiative ${scored.total}.`;
    logSessionEvent(`${getPlayerToken(user.id)?.name ?? user.name} rolled ${scored.total} for initiative.`);
  }
  if (a.kind === "conditionSave") {
    success = true;
    outcome = `You rolled ${scored.total}.`;
    saveRollResult(req.id, { ...scored, outcome, success });
    recordConditionSave(a.levelId, a.key, scored.total);
    revalidatePath("/play");
    return {};
  }
  if (a.kind === "rolloff") {
    success = true;
    outcome = `You rolled ${scored.total}.`;
    saveRollResult(req.id, { ...scored, outcome, success }); // first: settling may ask them to roll again (a tie)
    recordRollOff(a.levelId, a.tokenId, scored.total);
    revalidatePath("/play");
    return {};
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

/** Walks out of encounters on a level since the last one this map saw (polled each second, with pings): `mine` ones
 * this screen already played. */
export async function walksSince(levelId: number, afterId: number) {
  const user = await requireUser();
  return listTokenWalks(Number(levelId), Number(afterId)).map((w) => ({ id: w.id, tokenId: w.token_id, route: w.route, mine: w.user_id === user.id }));
}

/** Effects scripts played on a level since the last one this map saw (polled each second, with pings). */
export async function fxSince(levelId: number, afterId: number) {
  await requireUser();
  return listMapFx(Number(levelId), Number(afterId));
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
  const left = Math.max(0, speedOf(me.token_id, me.movement) - me.moved);
  const walls = movementBlockers(listStructures(me.level_id));
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
export async function freeMove(gx: number, gy: number): Promise<{ route?: Point[]; stopped?: boolean; error?: string; trap?: string; link?: { id: number; to: string }; followers?: { tokenId: number; route: Point[] }[] }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  if (isPortraitLevel(me.level_id)) return { error: "Not on side-on maps yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, movement is limited" };
  const sight = blockingSegments(listStructures(me.level_id)); // what they could see past
  const walls = movementBlockers(listStructures(me.level_id)); // what they can walk past (windows block)
  const here = { x: me.col + 0.5, y: me.row + 0.5 };
  // What they've seen: from where they stand now and everywhere they've stood on this level. Each spot's view is
  // worked out only when needed, nearest first, and kept (a route asks about many points; most are seen from nearby).
  const spots = [here, ...listSightings(user.id, me.level_id)];
  const views: (Point[] | undefined)[] = [];
  const viewFrom = (i: number) => (views[i] ??= visibilityPolygon(spots[i], 500, sight));
  const revealed = (p: Point) =>
    spots
      .map((s, i) => [i, Math.hypot(s.x - p.x, s.y - p.y)] as const)
      .sort((a, b) => a[1] - b[1])
      .some(([i]) => insidePolygon(p, viewFrom(i)));
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

  clearStandingOrder(me.token_id); // moving on their own ends following / pursuing / evading
  const { walked, stopped, told, link } = walkRoute(me.level_id, me.token_id, route);
  const followers = walked.length > 1 ? moveFollowers(me.level_id, me.token_id, walkLength(walked, isGridlessLevel(me.level_id))) : []; // those following / pursuing / evading them
  for (const w of [{ tokenId: me.token_id, route: walked }, ...followers]) if (w.route.length > 1) addTokenWalk(me.level_id, w.tokenId, w.route, user.id); // everyone else's map plays them
  revalidatePath("/play");
  return { route: walked, stopped, followers, ...(told.length ? { trap: told.join(" ") } : {}), ...(link ? { link } : {}) };
}

/**
 * The player answers the level link prompt: taking it moves their token to the level it leads to (onto the link
 * there that leads back, else the same spot); declining steps them back off it to `back` (where they came from).
 */
export async function takeLevelLink(linkId: number, go: boolean, back: Point): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  const asked = getLinkPrompt(me.token_id); // after a round (in an encounter); outside one, straight after the step
  if (getEncounter(me.level_id) && asked?.id !== Number(linkId)) return { error: "In an encounter, movement is limited" };
  const link = listStructures(me.level_id).find((s) => s.id === Number(linkId) && s.kind === "staircase");
  const here = { x: me.col, y: me.row };
  if (!link || link.target_level_id === null || !inLink(link, here)) return { error: "You're not on a way to another level" };
  clearLinkPrompt(me.token_id);
  if (go) {
    const to = arrivalSpot(me.level_id, here, listStructures(link.target_level_id));
    moveTokenToLevel(me.token_id, link.target_level_id, to.x, to.y);
    logSessionEvent(`${me.name} went to ${link.target_name ?? "another level"}`);
    syncAurasOn(me.level_id);
    syncAurasOn(link.target_level_id);
  } else {
    const b = asked ? asked.back : { x: Number(back?.x), y: Number(back?.y) }; // after a round: where the server noted they came from
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || (!asked && Math.hypot(b.x - here.x, b.y - here.y) > 1.5) || inLink(link, b)) return { error: "Can't step back there" };
    moveToken(me.token_id, b.x, b.y);
  }
  revalidatePath("/play");
  return {};
}

/**
 * Out of an encounter: the player's character follows, pursues or evades someone they can see, moving whenever that
 * one moves, until they move on their own, stop it, or an encounter starts. `mode` null stops it.
 */
export async function setStanding(mode: "follow" | "pursue" | "evade" | null, targetId?: number): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  if (mode === null) {
    clearStandingOrder(me.token_id);
  } else {
    if (!["follow", "pursue", "evade"].includes(mode)) return { error: "Unknown order" };
    if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
    const id = Number(targetId);
    if (id === me.token_id || !listTokens(me.level_id).some((t) => t.id === id)) return { error: "They're not here" };
    if (!seenFrom(me.level_id, { col: me.col, row: me.row }, me.token_id).has(id)) return { error: "You can't see them" };
    setStandingOrder(me.token_id, id, mode);
  }
  revalidatePath("/play");
  return {};
}

/**
 * Use, out of an encounter: one of their items' actions (anything they carry, packs too) happens straight away, on
 * themselves or someone they can see within its reach: its effects land (healing at once; a save as it lands, rolled by
 * the server) and a consumable is used up. Attacks and areas need an encounter.
 */
export async function useItemNow(actionId: number, targetId?: number): Promise<{ error?: string; told?: string }> {
  const user = await requireUser();
  if (user.role !== "player" || !getOpenGameSession()?.began_at) return { error: "Only during a session" };
  const me = getPlayerToken(user.id);
  if (!me) return { error: "You're not on the map yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  const g = gearActions(me.token_id, undefined, { packs: true }).find((x) => x.id === Number(actionId) && x.item);
  if (!g?.item) return { error: "You don't have that" };
  if (g.damage || g.area) return { error: "Only in an encounter" };
  const labels = tokenLabels(me.level_id);
  const target = g.self || targetId === undefined || Number(targetId) === me.token_id ? me.token_id : Number(targetId);
  if (target === me.token_id && g.targets === "others") return { error: "Pick someone else" };
  if (target !== me.token_id) {
    const t = listTokens(me.level_id).find((x) => x.id === target);
    if (!t) return { error: "They're not here" };
    if (!seenFrom(me.level_id, { col: me.col, row: me.row }, me.token_id).has(target)) return { error: "You can't see them" };
    const gap = isGridlessLevel(me.level_id) ? Math.hypot(t.col - me.col, t.row - me.row) : Math.max(Math.abs(t.col - me.col), Math.abs(t.row - me.row));
    if (gap > g.range + 0.05) return { error: `Out of reach (${g.range * FEET_PER_SQUARE} ft)` };
  }
  const told: string[] = [];
  const land = (who: number, list: Condition[]) => {
    for (const c of list) {
      if (c.apply_save_attr) {
        const dc = c.apply_save_dc ?? 12, total = rollSpec(saveRollFor(who, c.apply_save_attr, `${c.apply_save_attr} save against ${c.name} (DC ${dc})`)).total;
        if (total >= dc && c.apply_save_outcome !== "halves") { told.push(`${labels.get(who) ?? "they"} resists ${c.name} (${total} vs DC ${dc})`); continue; }
      }
      const happened = applyConditionNow(me.level_id, who, c);
      told.push(`${labels.get(who) ?? "they"}: ${c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`);
    }
  };
  land(me.token_id, g.statuses?.self?.conditions ?? []);
  land(target, g.statuses?.target?.conditions ?? []);
  const usedUp = useUpItem(me.token_id, g.item);
  const line = `${me.name} uses ${g.name}${target !== me.token_id ? ` on ${labels.get(target)}` : ""}: ${told.join("; ") || "no effect"}${usedUp ? " (used up)" : ""}`;
  logSessionEvent(line);
  revalidatePath("/play");
  return { told: line };
}

/** The player's character's planner in a running encounter. */
function planner(userId: number) {
  const me = getPlayerToken(userId);
  return me ? tokenPlanner(me.token_id) : null;
}

/** The player picks who's their target (clicking a token on the map): someone else they can see from where their plan has them. */
export async function selectTarget(tokenId: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  if (!p) return { error: "Not in an encounter" };
  const id = Number(tokenId);
  if (id === p.tok.token_id) return {};
  if (!seenFrom(p.tok.level_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), p.tok.token_id).has(id)) return { error: "You can't see them from there" };
  setTokenTarget(p.tok.token_id, id);
  revalidatePath("/play");
  return {};
}

/** Round planning: add an action, or a move to a square (reachable from where the plan leaves them, in the time left). */
export async function planStep(step: StepRequest): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  if (!p) return { error: "Not in an encounter" };
  const asked = getLinkPrompt(getPlayerToken(user.id)!.token_id);
  if (asked) return { error: `First say whether you'll take the way to ${asked.to}` };
  const error = addPlanStep(p, step);
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Takes the last step off the plan (and un-readies). */
/** Takes a step out of the player's plan (the ones after it move up). */
export async function removeStep(index: number): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  const error = p ? removePlanStep(p, Number(index)) : "Nothing planned";
  revalidatePath("/play");
  return error ? { error } : {};
}

export async function setPlanReady(ready: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  const error = p ? setReady(p, ready, true) : null;
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Roll (or cancel before throwing): the plan's dice prompt opens, and everyone sees them rolling. */
export async function rollPlan(rolling: boolean): Promise<void> {
  const user = await requireUser();
  const p = planner(user.id);
  if (p) startPlanRoll(p, rolling);
  revalidatePath("/play");
}

/** The plan's dice have landed (per roll, per part): checked and kept on the plan, which is then set. */
export async function submitPlanDice(thrown: number[][][]): Promise<{ error?: string }> {
  const user = await requireUser();
  const p = planner(user.id);
  const error = p ? submitPlanRoll(p, thrown) : "Not in an encounter";
  revalidatePath("/play");
  return error ? { error } : {};
}
