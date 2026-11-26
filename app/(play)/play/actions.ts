"use server";

import { applyConditionNow, recordConditionSave, recordRollOff } from "./workOutRound";
import { gearActions, useUpItem } from "@/lib/combat";
import type { Condition } from "@/lib/conditions";
import { saveRollFor, skillCheckFor, speedFps } from "@/lib/creatureChanges";
import { setTokenTarget } from "@/lib/db";
import { seenFrom } from "@/lib/sight";
import { ROUND_SECONDS, planEnd, timeline } from "@/lib/roundPlan";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getTokenActor, type ActorToken, type RollAction, type User } from "@/lib/db";
import {
  addPing, listPings, type Ping, closeRollRequest, settleInitiative, getDoor, getOpenGameSession, getOpenRollRequest, getPlayerToken,
  logSessionEvent, requestRoll, saveRollResult, setDoorLocked, listSecrets, setSecretRevealed, listStructures, isGridlessLevel, isPortraitLevel, walkToken, getEncounter, listSightings, moveToken, moveTokenToLevel, getLinkPrompt, clearLinkPrompt, setStandingOrder, clearStandingOrder, listTokens, addTokenWalk, listTokenWalks, tokenLabels, getGmLevelId, setDoorOpen, listMapTriggers, setAssist, assistOpenRequest, listHidden, setHidden, getEncounterWaiting, setEncounterWaiting, saveEncounter, getRoundPlan, saveRoundPlan, listMapFx } from "@/lib/db";
import { addPlanStep, setReady, startPlanRoll, submitPlanRoll, tokenPlanner, removePlanStep, moveStepEnd, type StepRequest } from "@/lib/roundPlanServer";
import { syncAurasOn } from "@/lib/auraSync";
import { snapHeight } from "@/lib/gravity";
import { blockingSegments, insidePolygon, movementBlockers, visibilityPolygon, type Point } from "@/lib/visibility";
import { FEET_PER_SQUARE, clearPath, reachableSquares, shortestPath, squareKey, squareRoute } from "@/lib/movement";
import { revealDiscovery } from "@/lib/storyRules";
import { SEARCH_DC, SEARCH_RANGE } from "@/lib/playerActions";
import { listTraps, setTrapFound } from "@/lib/db";
import { distanceToTrap } from "@/lib/traps";
import { interactablesNear } from "@/lib/triggers";
import { fireTrigger } from "./mapTriggers";
import { allegianceOf, relation } from "@/lib/sides";
import { arrivalSpot, inLink } from "@/lib/levelLinks";
import { walkRoute, walkWithFollowers } from "./walk";
import { planClock } from "./planClock";
import { hidingPlaces, reveal, settleHide } from "./hiding";
import type { Attributes } from "@/lib/attributes";
import { rollSpec, scoreRoll, type RollSpec } from "@/lib/rolls";
import { REACH, distanceToDoor } from "./reach";
import { catchInArea } from "./areas";
import { agreedImprovisation, askImprovise, dropImprovisation, openImprovisation, seenImprovisationResult, setImprovisePlaced, templateOf } from "@/lib/improvise";
import { improvisationRolled } from "./improvising";
import { getLastingArea, listHazards, listLastingAreas, setLastingAreaFound } from "@/lib/db";
import { inArea, type LastingArea } from "@/lib/aoe";

/** Whether a Search from `p` reaches an area: within 10 ft of it (inside it, or near its middle or edge). */
const caughtByNear = (l: LastingArea, p: { x: number; y: number }) => inArea(l.area, p) || Math.hypot(p.x - l.area.origin.x, p.y - l.area.origin.y) <= l.area.size + SEARCH_RANGE + 0.5;

/**
 * Who's acting, and their token: a player's own character; the GM playing an absent player's, or a creature of theirs.
 * The GM only watching a present player can't do anything (error).
 */
async function acting(): Promise<{ user: User; me: ActorToken | undefined; error?: string }> {
  const user = await requireUser();
  if (!getOpenGameSession()?.began_at) return { user, me: undefined, error: "Only during a session" };
  if (user.watching) return { user, me: undefined, error: `You're watching ${user.name}: only they can do that` };
  if (user.role === "player") return { user, me: getPlayerToken(user.id) };
  if (user.actingToken) return { user, me: getTokenActor(user.actingToken) };
  return { user, me: undefined, error: "Pick someone on the map to act as" };
}

/** A player asks to pick a locked door next to their character: they're prompted to roll sleight of hand against its DC. */
export async function pickLock(doorId: number): Promise<{ error?: string; told?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  const door = getDoor(Number(doorId));
  if (!me || !door || door.level_id !== me.level_id) return { error: "That door isn't here" };
  if (!door.locked) return { error: "It isn't locked" };
  if (distanceToDoor({ x: me.col + 0.5, y: me.row + 0.5 }, door) > REACH) return { error: "You're too far away" };
  const spec = skillCheckFor(me.token_id, "sleight of hand", JSON.parse(me.attributes) as Attributes);
  spec.label = `Pick the lock on ${door.name ?? `Door ${door.id}`}: ${spec.label}`;
  const told = check(user.id, me, spec, { kind: "pickLock", doorId: door.id, dc: door.lock_dc });
  revalidatePath("/play");
  return told ? { told } : {};
}

/** Interact, out of an encounter: the player opens or closes a door within reach (a locked one has to be picked first). */
export async function interactDoor(doorId: number): Promise<{ error?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  const door = getDoor(Number(doorId));
  if (!me || !door || door.level_id !== me.level_id) return { error: "That door isn't here" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  if (distanceToDoor({ x: me.col + 0.5, y: me.row + 0.5 }, door) > REACH) return { error: "You're too far away" };
  if (door.locked) return { error: "It's locked" };
  setDoorOpen(door.id, !door.open);
  logSessionEvent(`${me.name} ${door.open ? "closed" : "opened"} ${door.name ?? `Door ${door.id}`}.`);
  revalidatePath("/play");
  return {};
}

/** Interact, out of an encounter: the player works a lever, switch or object within reach (an interactable map trigger): it fires now. */
export async function interactThing(triggerId: number): Promise<{ error?: string; told?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  const side = allegianceOf(listTokens(me.level_id).find((t) => t.id === me.token_id) ?? { character_id: me.character_id });
  const near = interactablesNear(listMapTriggers(me.level_id), me.token_id, side, { x: me.col + 0.5, y: me.row + 0.5 }, REACH);
  const t = listMapTriggers(me.level_id).find((x) => x.id === Number(triggerId));
  if (!t || !near.some((n) => n.id === t.id)) return { error: "That's out of reach" };
  const fired = fireTrigger(me.level_id, t, me.token_id);
  revalidatePath("/play");
  return { told: [`You work ${t.name}.`, ...(fired.told.get(me.token_id) ?? [])].join(" ") };
}

/** Assist, out of an encounter: the player helps someone on their side within 5 ft whom they can see: advantage on that one's next roll. */
export async function assistNow(targetId: number): Promise<{ error?: string; told?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  const tokens = listTokens(me.level_id), t = tokens.find((x) => x.id === Number(targetId));
  if (!t || t.id === me.token_id) return { error: "Pick someone else" };
  const mine = tokens.find((x) => x.id === me.token_id);
  if (relation(allegianceOf(mine ?? { character_id: me.character_id }), allegianceOf(t)) !== "friendly") return { error: "Only someone on your side" };
  if (!seenFrom(me.level_id, { col: me.col, row: me.row }, me.token_id).has(t.id)) return { error: "You can't see them" };
  const gap = isGridlessLevel(me.level_id) ? Math.hypot(t.col - me.col, t.row - me.row) : Math.max(Math.abs(t.col - me.col), Math.abs(t.row - me.row));
  if (gap > 1.05) return { error: "Get within 5 ft of them" };
  const name = tokenLabels(me.level_id).get(t.id) ?? "them";
  setAssist(t.id, me.token_id, me.name);
  reveal(me.level_id, me.token_id, "helped someone"); // acting on someone gives a hidden one away
  const now = assistOpenRequest(t.id); // a roll they're about to make (not rolled yet) gets it straight away
  logSessionEvent(`${me.name} helps ${name}: advantage on ${now ? "the roll they're making" : "their next roll"}.`);
  revalidatePath("/play");
  return { told: `You help ${name}: ${now ? "the roll they're making" : "their next roll"} has advantage.` };
}

/**
 * Hide, out of an encounter, step one: whether an enemy they can see sees them now, and (if so) the blind spots they
 * could reach with a round's walking. Unseen: they're asked for the Stealth roll straight away.
 */
export async function startHide(): Promise<{ error?: string; told?: string; seen?: boolean; spots?: { col: number; row: number }[] }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  const places = hidingPlaces(me.level_id, me.token_id, { col: me.col, row: me.row }, speedFps(me.token_id, me.movement) * ROUND_SECONDS);
  const told = places.seen ? null : askStealth(user.id, me, false);
  revalidatePath("/play");
  return { ...places, ...(told ? { told } : {}) };
}

/** Hide, out of an encounter, step two (they were seen): they walk to a blind spot they picked, then roll Stealth with disadvantage. */
export async function hideAt(col: number, row: number): Promise<{ error?: string; told?: string; route?: Point[] }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (getEncounter(me.level_id)) return { error: "In an encounter, plan it for the round instead" };
  const places = hidingPlaces(me.level_id, me.token_id, { col: me.col, row: me.row }, speedFps(me.token_id, me.movement) * ROUND_SECONDS);
  const goal = places.spots.find((c) => c.col === Math.round(Number(col)) && c.row === Math.round(Number(row)));
  if (!goal) return { error: "That isn't a blind spot you can reach" };
  const squares = squareRoute({ col: Math.round(me.col), row: Math.round(me.row) }, goal, movementBlockers(listStructures(me.level_id)), () => true);
  if (!squares) return { error: "You can't get there" };
  clearStandingOrder(me.token_id);
  const w = walkRoute(me.level_id, me.token_id, squares.map((s) => ({ x: s.col, y: s.row })));
  if (w.walked.length > 1) addTokenWalk(me.level_id, me.token_id, w.walked, user.id, speedFps(me.token_id, me.movement) || 5);
  const told = w.stopped ? null : askStealth(user.id, { ...me, col: goal.col, row: goal.row }, true);
  revalidatePath("/play");
  return { route: w.walked, ...(told ? { told } : {}), ...(w.stopped ? { error: "Something stops you on the way" } : {}) };
}

/**
 * A check someone makes: a player's character asks its player to roll (null: the result comes with their dice); a
 * creature the GM plays rolls automatically, and how it went comes back straight away.
 */
function check(playerId: number, me: ActorToken, spec: RollSpec, action: RollAction): string | null {
  if (me.character_id !== null) {
    requestRoll(playerId, me.character_id, spec, action);
    return null;
  }
  const rolled = rollSpec(spec);
  return `${spec.label}: ${rolled.total}. ${settleRoll(me.name, me, action, rolled).outcome}`;
}

function askStealth(playerId: number, me: ActorToken, disadvantage: boolean): string | null {
  const spec = skillCheckFor(me.token_id, "stealth", JSON.parse(me.attributes) as Attributes);
  return check(playerId, me, { ...spec, label: `Hide: ${spec.label}${disadvantage ? " (in a hurry: disadvantage)" : ""}`, ...(disadvantage ? { mode: spec.mode === "advantage" ? "normal" : "disadvantage" } : {}) }, { kind: "hide", levelId: me.level_id, tokenId: me.token_id });
}

/** Search: the player is prompted for an Investigation check (DC 14); success reveals hidden things within 10 ft. */
export async function search(): Promise<{ error?: string; told?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  const spec = skillCheckFor(me.token_id, "investigation", JSON.parse(me.attributes) as Attributes);
  spec.label = `Search: ${spec.label}`;
  const told = check(user.id, me, spec, { kind: "search", dc: SEARCH_DC });
  revalidatePath("/play");
  return told ? { told } : {};
}

/** The player's dice have landed: check they fit the roll, score it, and settle what it was for. */
export async function submitRoll(requestId: number, thrown: number[][]): Promise<{ error?: string }> {
  const user = await requireUser();
  if (user.watching) return { error: `You're watching ${user.name}: only they can roll` };
  const req = getOpenRollRequest(user.id);
  if (!req || req.id !== Number(requestId) || req.result) return { error: "Nothing to roll" };
  const scored = scoreRoll(req.spec, thrown);
  if (!scored) return { error: "Those dice don't fit this roll" };
  const a = req.action;
  if (a.kind === "conditionSave") {
    saveRollResult(req.id, { ...scored, outcome: `You rolled ${scored.total}.`, success: true });
    recordConditionSave(a.levelId, a.key, scored.total);
    revalidatePath("/play");
    return {};
  }
  if (a.kind === "rolloff") {
    saveRollResult(req.id, { ...scored, outcome: `You rolled ${scored.total}.`, success: true }); // first: settling may ask them to roll again (a tie)
    recordRollOff(a.levelId, a.tokenId, scored.total);
    revalidatePath("/play");
    return {};
  }
  const { success, outcome } = settleRoll(user.name, user.role === "player" ? getPlayerToken(user.id) : user.actingToken ? getTokenActor(user.actingToken) : undefined, a, scored);
  saveRollResult(req.id, { ...scored, outcome, success });
  revalidatePath("/play");
  return {};
}

/**
 * What a check came to (pick a lock, Search, Hide, initiative): settles it and says how it went. Rolled by a player
 * (their dice) or for a creature the GM plays (automatically). me: whoever made it.
 */
function settleRoll(who: string, me0: ActorToken | undefined, a: RollAction, scored: { total: number; parts?: { dice: number[] }[] }): { success: boolean; outcome: string } {
  let success = false, outcome = "";
  if (a.kind === "pickLock") {
    const door = getDoor(a.doorId);
    const name = door?.name ?? `Door ${a.doorId}`;
    success = scored.total >= a.dc;
    if (success && door?.locked) setDoorLocked(door.id, false);
    outcome = success ? `The lock on ${name} clicks open.` : `The lock on ${name} won't give.`;
    logSessionEvent(`${me0?.name ?? who} ${success ? "picked the lock on" : "failed to pick the lock on"} ${name} (${scored.total} vs DC ${a.dc})`);
    outcome += ` (${scored.total} vs ${a.dc})`;
  }
  if (a.kind === "search") {
    const me = me0 && (a.at ? { ...me0, col: a.at.col, row: a.at.row } : me0); // a Search in a round: from where they stood when it finished
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
    // Hidden areas (a pocket of gas) in range whose find DC they beat.
    const areas = me ? listLastingAreas(me.level_id).filter((l) => l.visibility === "hidden" && !l.found && scored.total >= (l.findDc ?? 14) && caughtByNear(l, { x: me.col + 0.5, y: me.row + 0.5 })) : [];
    for (const l of areas) setLastingAreaFound(l.id);
    // Anyone hiding from them within 10 ft whose Stealth they beat (Hide).
    const tokens = me ? listTokens(me.level_id) : [], mine = me && tokens.find((t) => t.id === me.token_id), hiddenNow = me ? listHidden(me.level_id) : new Map<number, number>();
    const hiders = me && mine ? tokens.filter((t) => hiddenNow.has(t.id) && scored.total > hiddenNow.get(t.id)! && relation(allegianceOf(mine), allegianceOf(t)) !== "friendly" && Math.hypot(t.col - me.col, t.row - me.row) <= SEARCH_RANGE + 0.5) : [];
    for (const h of hiders) reveal(me!.level_id, h.id, `found by ${me!.name}'s search`);
    const labelsNow = me ? tokenLabels(me.level_id) : new Map<number, string>();
    const names = [...found.map((s) => (s.text ? `${s.name} (${s.text})` : s.name)), ...traps.map((t) => `a trap (${t.name})`), ...areas.map((l) => l.name), ...hiders.map((h) => `${labelsNow.get(h.id) ?? "someone"}, hiding`)];
    if (hiders.length) success = true;
    if (traps.length || areas.length) success = true;
    // Failing and finding nothing read the same, so a failed roll doesn't give away that something's there.
    outcome = names.length ? `You find: ${names.join("; ")}` : "You search but find nothing.";
    logSessionEvent(`${me?.name ?? who} searched (${scored.total} vs DC ${a.dc}): ${names.length ? `found ${[...found.map((s) => s.name), ...traps.map((t) => `trap ${t.name}`)].join(", ")}` : success ? "nothing there" : "failed"}`);
  }
  if (a.kind === "hide" && a.inRound) {
    // Hidden already (in the round): the roll sets how hard they are to find, if they haven't been given away since.
    success = listHidden(a.levelId).has(a.tokenId);
    if (success) setHidden(a.tokenId, scored.total);
    outcome = success ? "You're hidden." : "You were given away before you could settle in.";
  } else if (a.kind === "hide") {
    const r = settleHide(a.levelId, a.tokenId, scored.total);
    success = r.hidden;
    outcome = r.told;
  }
  if (a.kind === "improvise") {
    // An improvisation's roll: kept; whether it worked shows when it plays out (out of combat: now).
    success = true;
    outcome = improvisationRolled(a.id, { total: scored.total, natural: scored.parts?.[0]?.dice[0] ?? 0 });
  }
  if (a.kind === "areaSave") {
    // A lasting area they walked into (out of combat): it lands now, with their save.
    const l = getLastingArea(a.areaId) ?? listHazards(a.levelId).find((x) => x.id === a.areaId);
    success = !!l && scored.total >= l.dc;
    outcome = l ? catchInArea(a.levelId, l, a.tokenId, a.leaving, a.staying, scored.total) : "It's gone.";
  }
  if (a.kind === "initiative") {
    // Into the turn order, highest first (a re-roll replaces an earlier one).
    settleInitiative(a.levelId, a.tokenId, scored.total);
    success = true;
    outcome = `Initiative ${scored.total}.`;
    logSessionEvent(`${me0?.name ?? who} rolled ${scored.total} for initiative.`);
  }
  return { success, outcome };
}

export async function closeRoll(requestId: number): Promise<void> {
  const user = await requireUser();
  if (user.watching) return;
  closeRollRequest(Number(requestId), user.id);
  revalidatePath("/play");
}

/** Points at a spot on the map for everyone in the session. */
export async function sendPing(levelId: number, x: number, y: number): Promise<void> {
  const user = await requireUser();
  if (!getOpenGameSession()?.began_at || user.watching) return;
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
  return listTokenWalks(Number(levelId), Number(afterId)).map((w) => ({ id: w.id, tokenId: w.token_id, route: w.route, fps: w.fps, ...(w.times ? { times: w.times } : {}), mine: w.user_id === user.id }));
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
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (isPortraitLevel(me.level_id)) return { error: "Not on side-on maps yet" };
  if (!getEncounter(me.level_id)) return { error: "Out of an encounter, movement is free" };
  const left = Math.max(0, speedFps(me.token_id, me.movement) * ROUND_SECONDS - me.moved); // feet left this round
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
export async function freeMove(gx: number, gy: number, run = false): Promise<{ route?: Point[]; fps?: number; stopped?: boolean; error?: string; trap?: string; link?: { id: number; to: string }; followers?: { tokenId: number; route: Point[]; times: number[] }[] }> {
  const { user, me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  const fps = speedFps(me.token_id, me.movement, run ? "running" : "walking"); // walking or running, feet per second
  if (fps <= 0) return { error: run ? "You can't run" : "You can't move" };
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
  // They walk, and those following / pursuing / evading them move alongside, second by second at their own speeds.
  const { leader, walks } = walkWithFollowers(me.level_id, me.token_id, route, fps);
  const { walked, stopped, told, link } = leader;
  for (const w of walks) addTokenWalk(me.level_id, w.tokenId, w.route, user.id, fps, w.times); // everyone else's map plays them, in real time
  const followers = walks.filter((w) => w.tokenId !== me.token_id);
  revalidatePath("/play");
  return { route: walked, fps, stopped, followers, ...(told.length ? { trap: told.join(" ") } : {}), ...(link ? { link } : {}) };
}

/**
 * The player answers the level link prompt: taking it moves their token to the level it leads to (onto the link
 * there that leads back, else the same spot); declining steps them back off it to `back` (where they came from).
 */
export async function takeLevelLink(linkId: number, go: boolean, back: Point): Promise<{ error?: string }> {
  const { user, me, error } = await acting();
  if (error) return { error };
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
  const { user, me, error } = await acting();
  if (error) return { error };
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
  const { user, me, error } = await acting();
  if (error) return { error };
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
  if (target !== me.token_id) reveal(me.level_id, me.token_id, `used ${g.name} on someone`); // acting on someone gives a hidden one away
  const line = `${me.name} uses ${g.name}${target !== me.token_id ? ` on ${labels.get(target)}` : ""}: ${told.join("; ") || "no effect"}${usedUp ? " (used up)" : ""}`;
  logSessionEvent(line);
  revalidatePath("/play");
  return { told: line };
}

/** Planning Hide in a round: seen (from where the plan leaves them, by an enemy they can see)? and the blind spots in reach in the time left. */
export async function hidePlanOptions(): Promise<{ error?: string; seen?: boolean; spots?: { col: number; row: number }[] }> {
  const p = await planner();
  if (!p) return { error: "Not in an encounter" };
  return hidingPlaces(p.tok.level_id, p.tok.token_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), timeline(p.plan, p.walking).left * p.walking);
}

/** A screen's planning countdown reached 0: settle it now (the last player goes without a plan) rather than on the next refresh. */
export async function checkPlanClock(): Promise<void> {
  const user = await requireUser();
  const levelId = user.role === "gm" ? getGmLevelId() : getPlayerToken(user.id)?.level_id;
  if (levelId !== undefined) planClock(levelId);
  revalidatePath("/play");
}

/** The acting token's planner in a running encounter (none while the GM only watches). */
async function planner() {
  const { me, error } = await acting();
  return !error && me ? tokenPlanner(me.token_id) : null;
}

/** The player picks who's their target (clicking a token on the map): someone else they can see from where their plan has them; null lets it go. */
export async function selectTarget(tokenId: number | null): Promise<{ error?: string }> {
  const p = await planner();
  if (!p) return { error: "Not in an encounter" };
  if (tokenId === null) { setTokenTarget(p.tok.token_id, null); revalidatePath("/play"); return {}; }
  const id = Number(tokenId);
  if (id === p.tok.token_id) return {};
  if (!seenFrom(p.tok.level_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), p.tok.token_id).has(id)) return { error: "You can't see them from there" };
  setTokenTarget(p.tok.token_id, id);
  revalidatePath("/play");
  return {};
}

/** Round planning: add an action, or a move to a square (reachable from where the plan leaves them, in the time left). */
export async function planStep(step: StepRequest): Promise<{ error?: string }> {
  const p = await planner();
  if (!p) return { error: "Not in an encounter" };
  const asked = getLinkPrompt(p.tok.token_id);
  if (asked) return { error: `First say whether you'll take the way to ${asked.to}` };
  const error = addPlanStep(p, step);
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Takes the last step off the plan (and un-readies). */
/** Takes a step out of the player's plan (the ones after it move up). */
/** A planned move's end dragged on the map: the move is that much shorter or longer (later steps kept, if they still fit). */
export async function dragMoveEnd(index: number, col: number, row: number): Promise<{ error?: string }> {
  const p = await planner();
  const error = p ? moveStepEnd(p, Number(index), { col: Number(col), row: Number(row) }) : "Nothing planned";
  revalidatePath("/play");
  return error ? { error } : {};
}

export async function removeStep(index: number): Promise<{ error?: string }> {
  const p = await planner();
  const error = p ? removePlanStep(p, Number(index)) : "Nothing planned";
  revalidatePath("/play");
  return error ? { error } : {};
}

export async function setPlanReady(ready: boolean): Promise<{ error?: string }> {
  const p = await planner();
  const error = p ? setReady(p, ready, (await requireUser()).role === "player") : null; // a player rolls their plan's dice; the GM's creatures' roll themselves
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Roll (or cancel before throwing): the plan's dice prompt opens, and everyone sees them rolling. */
export async function rollPlan(rolling: boolean): Promise<void> {
  const p = await planner();
  if (p) startPlanRoll(p, rolling);
  revalidatePath("/play");
}

/** The plan's dice have landed (per roll, per part): checked and kept on the plan, which is then set. */
export async function submitPlanDice(thrown: number[][][]): Promise<{ error?: string }> {
  const p = await planner();
  const error = p ? submitPlanRoll(p, thrown) : "Not in an encounter";
  revalidatePath("/play");
  return error ? { error } : {};
}

/** Improvise: the acting token asks the GM to do something the rules don't cover (a line of intent); the GM is told. */
export async function improvise(intent: string): Promise<{ error?: string }> {
  const { me, error } = await acting();
  if (error) return { error };
  if (!me) return { error: "You're not on the map yet" };
  if (!String(intent ?? "").trim()) return { error: "Say what you want to do" };
  askImprovise(me.level_id, me.token_id, String(intent));
  logSessionEvent(`💡 ${me.name} wants to improvise: ${String(intent).trim()}`);
  revalidatePath("/play");
  return {};
}

/** Takes back an improvisation not yet settled. */
export async function cancelImprovise(): Promise<void> {
  const { me, error } = await acting();
  const open = !error && me ? openImprovisation(me.token_id) : undefined;
  if (open) dropImprovisation(open.id);
  revalidatePath("/play");
}

/** The player has seen how their improvisation went. */
export async function seenImprovise(id: number): Promise<void> {
  await requireUser();
  seenImprovisationResult(Number(id));
  revalidatePath("/play");
}

/** Puts their improvisation's template down where they clicked (again, until the GM goes ahead). */
export async function placeImprovise(x: number, y: number): Promise<{ error?: string }> {
  const { me, error } = await acting();
  if (error) return { error };
  const i = me ? agreedImprovisation(me.token_id) : undefined;
  if (!i || !templateOf(i)) return { error: "Nothing to place" };
  if (i.agreed?.go) return { error: "The GM has gone ahead with it" };
  setImprovisePlaced(i.id, { x: Number(x), y: Number(y) });
  revalidatePath("/play");
  return {};
}
