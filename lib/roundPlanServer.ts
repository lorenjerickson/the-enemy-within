import { downTokens, listMapTriggers, setTokenTarget, getItem, listTokens, setPlanRolled, getEncounter, getRoundPlan, getTokenMover, isGridlessLevel, listStructures, saveRoundPlan, tokenLabels } from "@/lib/db";
import { snapHeight } from "@/lib/gravity";
import { FEET_PER_SQUARE, reachableSquares, shortestPath, squareKey } from "@/lib/movement";
import { CHASE_ACTIONS, DEFERRED_ACTIONS, DEFERRED_WHY, actionKind, type PlayerActionId } from "@/lib/playerActions";
import { ROUND_SECONDS, afterRefits, cannotAdd, onBelt, planEnd, stepKind, timeline, unavailable, type GearAction, type PlanStep, type Put, type Refit } from "@/lib/roundPlan";
import { agreedImprovisation, waitingOnTemplate } from "@/lib/improvise";
import { attackRange, gearActions, putOptions, refitOptions, tokenWho } from "@/lib/combat";
import { planRolls, withThrownDice } from "@/lib/planRolls";
import { seenFrom } from "@/lib/sight";
import { allegianceOf, fits, picksSeveral, relation } from "@/lib/sides";
import { movementBlockers } from "@/lib/visibility";
import { REACH, distanceToDoor } from "../app/(play)/play/reach";
import { interactablesNear } from "@/lib/triggers";
import { hidingPlaces } from "../app/(play)/play/hiding";
import { canShakeOff, restrictionsOn, speedFps } from "@/lib/creatureChanges";

/** Round planning for one token (a player's character or a GM creature), shared by players' and the GM's actions. */
export function tokenPlanner(tokenId: number) {
  const tok = getTokenMover(tokenId);
  if (!tok || !getEncounter(tok.level_id)) return null;
  if (downTokens(tok.level_id).has(tok.token_id)) return null; // down: no planning until revived
  const running = speedFps(tok.token_id, tok.movement, "running"); // Dash speed, feet per second
  return { tok, walking: speedFps(tok.token_id, tok.movement), running, ...getRoundPlan(tok.level_id, tok.token_id) }; // walking speed (feet per second) as boosted now
}
export type Planner = NonNullable<ReturnType<typeof tokenPlanner>>;

/** Their equipment as the plan so far leaves it (after any refit). */
export const plannedEquipment = (p: Planner) => afterRefits(tokenWho(p.tok.token_id)?.equipment ?? {}, p.plan);
/** Their gear actions as the plan so far leaves them: refits done, and what it put on their belt at hand. */
const plannedGear = (p: Planner) => gearActions(p.tok.token_id, plannedEquipment(p), { onBelt: onBelt(p.plan) });

export type StepRequest = { kind: "action"; action: PlayerActionId; target?: number; use?: number; aim?: { col: number; row: number }; seconds?: number; swap?: { slot: string; item: number }; put?: { item: number; slot?: string; from?: number; into: number }; picks?: number[]; door?: number; thing?: number; cover?: { col: number; row: number }; hurried?: boolean } | { kind: "move"; col: number; row: number; run?: boolean }; // run: a Dash

/** Adds a step: an action, or a move to a spot reachable from where the plan leaves them, in the time left. */
export function addPlanStep(p: Planner, step: StepRequest): string | null {
  if (p.rolled) return "The dice are rolled: the plan is set";
  if (p.ready) return "Ready already; undo that to change the plan";
  // A condition stopping that kind of step (Stunned: anything; Restrained: moving).
  const gearKind = step.kind === "action" && step.use !== undefined ? plannedGear(p).find((g) => g.id === Number(step.use))?.kind : undefined; // a gear reaction counts as the reaction (a bonus as the bonus action; a free one as nothing)
  const kind = step.kind === "move" ? "movement" : step.use !== undefined ? (gearKind ?? "action") : actionKind(step.action);
  const stopped = unavailable([], 0, kind, 0, restrictionsOn(p.tok.token_id, p.tok.level_id).forbid) ?? (step.kind === "move" && step.run ? unavailable([], 0, "action", 0, restrictionsOn(p.tok.token_id, p.tok.level_id).forbid) : null);
  if (stopped) return stopped;
  // Improvise: what the GM agreed goes into the plan as one step (its cost and time as the GM said; rolled for first).
  if (step.kind === "action" && step.action === "improvise") {
    const i = agreedImprovisation(p.tok.token_id);
    if (!i?.agreed) return "Nothing agreed with the GM yet";
    if (waitingOnTemplate(i)) return i.placed ? "Waiting for the GM to go ahead" : "Place it on the map first";
    if (p.plan.some((s) => s.kind === "action" && s.improv?.id === i.id)) return "It's in the plan already";
    const add: PlanStep = { kind: "action", action: "improvise", improv: { id: i.id, name: i.agreed.name, seconds: i.agreed.seconds, cost: i.agreed.cost } };
    const why = cannotAdd(p.plan, add, p.walking);
    if (why) return why;
    saveRoundPlan(p.tok.level_id, p.tok.token_id, [...p.plan, add], false);
    return null;
  }
  const run = step.kind === "move" && step.run ? p.running : undefined; // a Dash: at running speed
  if (run !== undefined && run <= 0) return "No running speed";
  if (step.kind === "action" && step.action === "shake" && !canShakeOff(p.tok.token_id, p.tok.level_id)) return "Nothing to shake off";
  if (step.kind === "action" && DEFERRED_ACTIONS.includes(step.action) && step.use === undefined) return DEFERRED_WHY;
  // Nothing chosen: it would do nothing (the panels pick a door / lever, or an item, first).
  if (step.kind === "action" && step.action === "interact" && step.door === undefined && step.thing === undefined) return "Pick a door or something within reach";
  if (step.kind === "action" && step.action === "use" && step.use === undefined) return "Pick what to use";
  // Hide: seen (by an enemy they can see, from where the plan leaves them), they must first slip into a blind spot they
  // can reach in the time left (a move), and then hide in a hurry; with no blind spot in reach, they can't.
  if (step.kind === "action" && step.action === "hide" && !step.hurried) {
    const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
    const places = hidingPlaces(p.tok.level_id, p.tok.token_id, from, timeline(p.plan, p.walking).left * p.walking);
    if (step.cover) {
      const spot = places.spots.find((c) => c.col === Math.round(Number(step.cover!.col)) && c.row === Math.round(Number(step.cover!.row)));
      if (!spot) return "That isn't a blind spot you can reach in time";
      const moved = addPlanStep(p, { kind: "move", col: spot.col, row: spot.row });
      if (moved) return moved;
      const fresh = tokenPlanner(p.tok.token_id);
      return fresh ? addPlanStep(fresh, { kind: "action", action: "hide", hurried: true }) : "They can't plan now";
    }
    if (places.seen) return places.spots.length ? "You're seen: pick a blind spot on the map" : "You're seen, and there's no cover within reach";
  }
  let add: PlanStep;
  if (step.kind === "move") {
    const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
    const feetLeft = timeline(p.plan, p.walking).left * (run ?? p.walking);
    const walls = movementBlockers(listStructures(p.tok.level_id));
    if (isGridlessLevel(p.tok.level_id)) {
      // Straight there, or by the shortest way round walls in the way (a move per leg).
      const to = { col: snapHeight(Number(step.col)), row: snapHeight(Number(step.row)) };
      const path = shortestPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls, () => true);
      if (!path) return "Something's in the way";
      if (Math.hypot(to.col - from.col, to.row - from.row) < 0.1) return "Already there";
      const legs = path.slice(1).map((pt, i) => {
        const a = path[i], end = i === path.length - 2 ? to : { col: snapHeight(pt.x - 0.5), row: snapHeight(pt.y - 0.5) };
        return { kind: "move" as const, to: end, feet: Math.round(Math.hypot(pt.x - a.x, pt.y - a.y) * FEET_PER_SQUARE * 10) / 10, ...(run ? { run } : {}) };
      });
      if (legs.reduce((sum, l) => sum + l.feet, 0) > feetLeft + 0.05) return "Can't get there in time";
      let plan = p.plan;
      for (const leg of legs) {
        const why = cannotAdd(plan, leg, p.walking);
        if (why) return why;
        plan = [...plan, leg];
      }
      saveRoundPlan(p.tok.level_id, p.tok.token_id, plan, false);
      return null;
    } else {
      const sq = reachableSquares(from, feetLeft / FEET_PER_SQUARE, walls).get(squareKey(Math.round(Number(step.col)), Math.round(Number(step.row))));
      if (!sq || !sq.steps) return "Can't get there in time";
      add = { kind: "move", to: { col: sq.col, row: sq.row }, feet: sq.steps * FEET_PER_SQUARE, ...(run ? { run } : {}) };
    }
  } else {
    const name = step.target !== undefined ? tokenLabels(p.tok.level_id).get(Number(step.target)) : undefined;
    // A gear action must be one this token actually has (an equipped item's, a profession's, or a creature's own).
    const use = step.use !== undefined ? plannedGear(p).find((g) => g.id === Number(step.use)) : undefined;
    if (step.use !== undefined && !use) return "That isn't one of their actions";
    // On themselves only when the action allows it (Healing Draught: themselves or others).
    if (step.target !== undefined && (!name || (Number(step.target) === p.tok.token_id && use?.targets !== "anyone"))) return "Pick someone else on this map";
    // Only someone they could see from where the plan has them by then (no aiming at, chasing or fleeing what's out of
    // sight); someone invisible in their line of sight can still be aimed at (a guess: disadvantage when it resolves).
    const sees = seenFrom(p.tok.level_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), p.tok.token_id, { unseenToo: true });
    const unseen = [...(step.target !== undefined ? [Number(step.target)] : []), ...(step.picks ?? []).map(Number)].find((id) => id !== p.tok.token_id && !sees.has(id));
    if (unseen !== undefined) return `They can't see ${tokenLabels(p.tok.level_id).get(unseen) ?? "them"} from there`;
    const { source: _source, ...gear } = use ?? { source: "" };
    // An area is aimed at a spot: a circle's centre must be within the action's range of where the plan leaves them.
    let aim: { col: number; row: number } | undefined;
    if (step.aim && use?.area) {
      aim = { col: Number(step.aim.col), row: Number(step.aim.row) };
      if (!Number.isFinite(aim.col) || !Number.isFinite(aim.row)) return "Aim it on the map";
      const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
      if (use.area.shape === "circle" && Math.hypot(aim.col - (from.col + 0.5), aim.row - (from.row + 0.5)) > use.range + 0.5) return `Out of range (${use.range * 5} ft)`;
    }
    // Evade / Pursue for a whole number of seconds (or, unset, the rest of the round).
    let seconds: number | undefined;
    if (CHASE_ACTIONS.includes(step.action) && step.seconds !== undefined && step.seconds !== null) {
      seconds = Number(step.seconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > ROUND_SECONDS) return "Pick how many seconds";
    }
    // Interact: a door within reach of where the plan leaves them (not a locked one: that needs picking, out of rounds).
    let door: { id: number; name: string; open: boolean } | undefined;
    let thing: { id: number; name: string } | undefined; // or a lever / switch / object (an interactable map trigger)
    if (step.action === "interact" && step.thing !== undefined) {
      const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
      const side = allegianceOf(listTokens(p.tok.level_id).find((t) => t.id === p.tok.token_id) ?? { character_id: null });
      thing = interactablesNear(listMapTriggers(p.tok.level_id), p.tok.token_id, side, { x: from.col + 0.5, y: from.row + 0.5 }, REACH).find((x) => x.id === Number(step.thing));
      if (!thing) return "That's out of reach from there";
    } else if (step.action === "interact") {
      const d = listStructures(p.tok.level_id).find((s) => s.id === Number(step.door) && s.kind === "door");
      if (!d) return "Pick a door within reach";
      const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
      if (distanceToDoor({ x: from.col + 0.5, y: from.row + 0.5 }, d) > REACH) return "That door is out of reach from there";
      if (d.locked) return "It's locked";
      door = { id: d.id, name: d.name ?? `Door ${d.id}`, open: !!d.open };
    }
    // Refit: something they carry that fits the slot, as their gear will be by then.
    let swap: Refit | undefined, put: Put | undefined;
    if (step.action === "refit" && step.put) {
      // Put away: something equipped into a worn container with room, or one thing from a pack onto the belt.
      const o = putOptions(p.tok.token_id, plannedEquipment(p), p.plan), r = step.put;
      if (r.slot) {
        const a = o.away.find((x) => x.slot === r.slot && x.item.id === Number(r.item));
        if (!a) return "Nothing there to put away";
        const into = a.into.find((c) => c.id === Number(r.into));
        if (!into) return a.into.length ? "Pick a container with room" : "No room in anything you wear";
        put = { item: a.item, slot: a.slot, into: { id: into.id, name: into.name }, belt: into.belt };
      } else {
        if (!o.belt) return "You're not wearing a belt";
        const f = o.fromPacks.find((x) => x.item.id === Number(r.item) && x.from.id === Number(r.from));
        if (!f) return "That isn't in your pack";
        if (!f.room || o.belt.id !== Number(r.into)) return `No room on ${o.belt.name}`;
        put = { item: f.item, from: f.from, into: o.belt, belt: true };
      }
    } else if (step.action === "refit") {
      const equipment = plannedEquipment(p);
      const option = refitOptions(p.tok.token_id, equipment).find((o) => o.slot === step.swap?.slot);
      const item = option?.items.find((i) => i.id === Number(step.swap?.item));
      if (!option || !item) return "Pick what to swap in";
      const other = option.slot === "main hand" ? "off hand" : option.slot === "off hand" ? "main hand" : undefined;
      const range = getItem(item.id)?.range_ft ?? 5;
      swap = {
        slot: option.slot, item: { id: item.id, name: item.name }, from: option.current,
        ...(item.hands === 2 && other && equipment[other] ? { clears: other } : {}),
        ...(option.slot === "main hand" ? { reach: Math.max(1, Math.round(range / 5)) } : {}),
      };
    }
    // Several targets (exactly / up to N), or which of those in its area it's meant for: each must fit who it's for.
    const tg = use?.targeting;
    let picks: { id: number; name: string }[] | undefined;
    if (tg && (step.picks?.length || (!use?.area && picksSeveral(tg)))) {
      const labels = tokenLabels(p.tok.level_id), tokens = listTokens(p.tok.level_id);
      const me = allegianceOf(tokens.find((t) => t.id === p.tok.token_id) ?? { character_id: null });
      const ids = [...new Set((step.picks ?? []).map(Number))];
      for (const id of ids) {
        const t = tokens.find((x) => x.id === id);
        if (!t || (id === p.tok.token_id && use?.targets !== "anyone")) return "Pick someone else on this map";
        if (id !== p.tok.token_id && !fits(tg.who, relation(me, allegianceOf(t)))) return `${labels.get(id)} isn't one of the ${tg.who === "enemy" ? "enemies" : "friendlies"}`;
      }
      if (!ids.length || ids.length > tg.n || (!use?.area && tg.count === "exactly" && ids.length !== tg.n)) return tg.count === "exactly" && !use?.area ? `Pick exactly ${tg.n}` : `Pick 1 to ${tg.n}`;
      picks = ids.map((id) => ({ id, name: labels.get(id) ?? "someone" }));
    }
    else if (tg?.who && step.target !== undefined && Number(step.target) !== p.tok.token_id) {
      const tokens = listTokens(p.tok.level_id), t = tokens.find((x) => x.id === Number(step.target));
      const me = allegianceOf(tokens.find((x) => x.id === p.tok.token_id) ?? { character_id: null });
      if (t && !fits(tg.who, relation(me, allegianceOf(t)))) return `${name} isn't one of the ${tg.who === "enemy" ? "enemies" : "friendlies"}`;
    }
    // Assist: someone else on their side.
    if (step.action === "assist") {
      const tokens = listTokens(p.tok.level_id), t = tokens.find((x) => x.id === Number(step.target));
      if (!t || t.id === p.tok.token_id) return "Pick someone else to help";
      if (relation(allegianceOf(tokens.find((x) => x.id === p.tok.token_id) ?? { character_id: null }), allegianceOf(t)) !== "friendly") return "Only someone on your side";
    }
    const first = picks && !aim ? picks[0] : undefined;
    add = { kind: "action", action: step.action, ...(seconds ? { seconds } : {}), ...(swap ? { swap } : {}), ...(put ? { put } : {}), ...(name && !aim ? { target: { id: Number(step.target), name } } : first ? { target: first } : {}), ...(use ? { use: gear as GearAction } : {}), ...(aim ? { aim } : {}), ...(picks ? { picks } : {}), ...(door ? { door } : {}), ...(thing ? { thing } : {}), ...(step.action === "hide" && step.hurried ? { hurried: true } : {}) };
  }
  const why = cannotAdd(p.plan, add, p.walking) ?? unavailable(p.plan, 0, stepKind(add), 0, restrictionsOn(p.tok.token_id, p.tok.level_id).forbid);
  if (why) return why;
  // Evade / Pursue / Follow: laid out as 1-second slices (each removable), for the seconds picked or the rest of the
  // round (whole seconds; a part second left over stays free).
  if (add.kind === "action" && CHASE_ACTIONS.includes(add.action)) {
    const n = add.seconds ?? Math.floor(timeline(p.plan, p.walking).left + 1e-9);
    if (n < 1) return "No time left this round";
    let plan = p.plan;
    for (let i = 0; i < n; i++) {
      const slice: PlanStep = { ...add, seconds: 1 };
      if (cannotAdd(plan, slice, p.walking)) break;
      plan = [...plan, slice];
    }
    saveRoundPlan(p.tok.level_id, p.tok.token_id, plan, false);
    if (add.target && add.target.id !== p.tok.token_id) setTokenTarget(p.tok.token_id, add.target.id);
    return null;
  }
  saveRoundPlan(p.tok.level_id, p.tok.token_id, [...p.plan, add], false);
  // Whoever it's aimed at (someone else) stays their selected target, this round and the next.
  if (add.kind === "action" && add.target && add.target.id !== p.tok.token_id) setTokenTarget(p.tok.token_id, add.target.id);
  return null;
}

/**
 * Takes one step out of the plan; the steps after it move up into its time. A move after a removed move now starts
 * from somewhere else, so it's measured again from there (by the shortest way; dropped if it can't get there), and
 * anything that no longer fits the round is dropped from the end.
 */
export function removePlanStep(p: Planner, index: number): string | null {
  if (p.rolled) return "The dice are rolled: the plan is set";
  if (p.ready) return "Ready already; undo that to change the plan";
  if (!Number.isInteger(index) || index < 0 || index >= p.plan.length) return "That step isn't in the plan";
  const removed = p.plan[index];
  // A chase's second taken out of the middle (anything planned after it): everything after it goes too.
  const interiorSlice = removed.kind === "action" && CHASE_ACTIONS.includes(removed.action) && index < p.plan.length - 1;
  const rest = interiorSlice ? p.plan.slice(0, index) : [...p.plan.slice(0, index), ...p.plan.slice(index + 1)];
  if (removed.kind === "move") {
    const j = rest.findIndex((s, k) => k >= index && s.kind === "move");
    if (j >= 0) rest.splice(j, 1, ...(remeasure(p, planEnd(rest.slice(0, j), { col: p.tok.col, row: p.tok.row }), (rest[j] as Extract<PlanStep, { kind: "move" }>).to) ?? []));
  }
  const plan: PlanStep[] = [];
  for (const s of rest) {
    if (cannotAdd(plan, s, p.walking)) break;
    plan.push(s);
  }
  saveRoundPlan(p.tok.level_id, p.tok.token_id, plan, false);
  return null;
}

/** A move from `from` to `to` as plan steps (legs round walls on a gridless map), or null if there's no way there. */
function remeasure(p: Planner, from: { col: number; row: number }, to: { col: number; row: number }): PlanStep[] | null {
  if (Math.hypot(to.col - from.col, to.row - from.row) < 0.1) return [];
  const walls = movementBlockers(listStructures(p.tok.level_id));
  if (isGridlessLevel(p.tok.level_id)) {
    const path = shortestPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls, () => true);
    if (!path) return null;
    return path.slice(1).map((pt, i) => {
      const a = path[i], end = i === path.length - 2 ? to : { col: snapHeight(pt.x - 0.5), row: snapHeight(pt.y - 0.5) };
      return { kind: "move" as const, to: end, feet: Math.round(Math.hypot(pt.x - a.x, pt.y - a.y) * FEET_PER_SQUARE * 10) / 10 };
    });
  }
  const sq = reachableSquares(from, (p.walking * ROUND_SECONDS * 2) / FEET_PER_SQUARE, walls).get(squareKey(to.col, to.row)); // anything further won't fit the round anyway
  return sq?.steps ? [{ kind: "move", to: { col: sq.col, row: sq.row }, feet: sq.steps * FEET_PER_SQUARE }] : null;
}

/** Ready (or not). A player whose plan has dice to roll rolls them first; the GM's plans are rolled by the server. */
export function setReady(p: Planner, ready: boolean, mustRoll = false): string | null {
  if (ready && mustRoll && p.rolled !== 2 && planRolls(p.tok.token_id, p.plan).length) return "Roll your dice first";
  saveRoundPlan(p.tok.level_id, p.tok.token_id, p.plan, !!ready);
  return null;
}

/** Roll: the player starts rolling their plan's dice (shown to everyone as rolling…); nothing to roll, nothing happens. */
export function startPlanRoll(p: Planner, rolling: boolean): void {
  if (p.rolled === 2 || p.ready) return;
  if (rolling && !planRolls(p.tok.token_id, p.plan).length) return;
  setPlanRolled(p.tok.level_id, p.tok.token_id, rolling ? 1 : 0);
}

/** The dice landed: they go onto the plan's steps, the plan is set, and they're ready. */
export function submitPlanRoll(p: Planner, thrown: number[][][]): string | null {
  if (p.rolled !== 1) return "Nothing to roll";
  const plan = withThrownDice(p.plan, planRolls(p.tok.token_id, p.plan), thrown);
  if (!plan) return "Those dice don't fit these rolls";
  setPlanRolled(p.tok.level_id, p.tok.token_id, 2, plan);
  saveRoundPlan(p.tok.level_id, p.tok.token_id, plan, true); // rolled = set, so they're ready (no second click)
  return null;
}

/** A token's plan laid out for showing: steps in time, seconds used, ready, where it leaves them and the feet they can still move. */
export function planView(tokenId: number) {
  const p = tokenPlanner(tokenId);
  if (!p) return null;
  const t = timeline(p.plan, p.walking);
  return {
    steps: t.steps.map((s) => ({ ...s.step, start: s.start, end: s.end })),
    used: t.used,
    ready: p.ready,
    rolled: p.rolled,
    from: planEnd(p.plan, { col: p.tok.col, row: p.tok.row }),
    feetLeft: t.left * p.walking,
    perSecond: p.walking, // feet a second at walking pace
    runPerSecond: p.running, // and running (Dash); 0: can't run
    gear: plannedGear(p), // their actions, with any refit planned so far done (and what it put on the belt)
    refits: refitOptions(tokenId, plannedEquipment(p)),
    puts: putOptions(tokenId, plannedEquipment(p), p.plan), // what Refit could put away / bring onto the belt
    attackRange: attackRange(tokenId, plannedEquipment(p)), // squares a plain Attack reaches (after any refit)
    sees: [...seenFrom(p.tok.level_id, planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), tokenId)], // who they could aim at from where the plan has them
    forbidden: restrictionsOn(tokenId, p.tok.level_id).forbid, // what conditions stop them doing (Stunned: everything)
    shakeable: canShakeOff(tokenId, p.tok.level_id), // a condition on them they can spend their action fighting off
    // Interact: doors and levers / switches / objects within reach of where the plan leaves them.
    ...(() => {
      const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row }), c = { x: from.col + 0.5, y: from.row + 0.5 };
      const side = allegianceOf(listTokens(p.tok.level_id).find((t) => t.id === tokenId) ?? { character_id: null });
      return {
        doors: listStructures(p.tok.level_id).filter((s) => s.kind === "door" && distanceToDoor(c, s) <= REACH).map((s) => ({ id: s.id, name: s.name ?? `Door ${s.id}`, open: !!s.open, locked: !!s.locked })),
        things: interactablesNear(listMapTriggers(p.tok.level_id), tokenId, side, c, REACH),
      };
    })(),
  };
}
