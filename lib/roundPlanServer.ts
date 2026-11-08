import { downTokens, getItem, listTokens, setPlanRolled, getEncounter, getRoundPlan, getTokenMover, isGridlessLevel, listStructures, saveRoundPlan, tokenLabels } from "@/lib/db";
import { snapHeight } from "@/lib/gravity";
import { FEET_PER_SQUARE, reachableSquares, shortestPath, squareKey } from "@/lib/movement";
import { CHASE_ACTIONS, type PlayerActionId } from "@/lib/playerActions";
import { ROUND_SECONDS, afterRefits, cannotAdd, planEnd, timeline, type GearAction, type PlanStep, type Refit } from "@/lib/roundPlan";
import { attackRange, gearActions, refitOptions, tokenWho } from "@/lib/combat";
import { planRolls, withThrownDice } from "@/lib/planRolls";
import { allegianceOf, fits, relation } from "@/lib/sides";
import { movementBlockers } from "@/lib/visibility";

/** Round planning for one token (a player's character or a GM creature), shared by players' and the GM's actions. */
export function tokenPlanner(tokenId: number) {
  const tok = getTokenMover(tokenId);
  if (!tok || !getEncounter(tok.level_id)) return null;
  if (downTokens(tok.level_id).has(tok.token_id)) return null; // down: no planning until revived
  return { tok, walking: (JSON.parse(tok.movement).walking as number) ?? 0, ...getRoundPlan(tok.level_id, tok.token_id) };
}
export type Planner = NonNullable<ReturnType<typeof tokenPlanner>>;

/** Their equipment as the plan so far leaves it (after any refit). */
export const plannedEquipment = (p: Planner) => afterRefits(tokenWho(p.tok.token_id)?.equipment ?? {}, p.plan);

export type StepRequest = { kind: "action"; action: PlayerActionId; target?: number; use?: number; aim?: { col: number; row: number }; seconds?: number; swap?: { slot: string; item: number }; picks?: number[] } | { kind: "move"; col: number; row: number };

/** Adds a step: an action, or a move to a spot reachable from where the plan leaves them, in the time left. */
export function addPlanStep(p: Planner, step: StepRequest): string | null {
  if (p.rolled) return "The dice are rolled: the plan is set";
  if (p.ready) return "Ready already; undo that to change the plan";
  let add: PlanStep;
  if (step.kind === "move") {
    const from = planEnd(p.plan, { col: p.tok.col, row: p.tok.row });
    const feetLeft = (timeline(p.plan, p.walking).left * p.walking) / 6;
    const walls = movementBlockers(listStructures(p.tok.level_id));
    if (isGridlessLevel(p.tok.level_id)) {
      // Straight there, or by the shortest way round walls in the way (a move per leg).
      const to = { col: snapHeight(Number(step.col)), row: snapHeight(Number(step.row)) };
      const path = shortestPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls, () => true);
      if (!path) return "Something's in the way";
      if (Math.hypot(to.col - from.col, to.row - from.row) < 0.1) return "Already there";
      const legs = path.slice(1).map((pt, i) => {
        const a = path[i], end = i === path.length - 2 ? to : { col: snapHeight(pt.x - 0.5), row: snapHeight(pt.y - 0.5) };
        return { kind: "move" as const, to: end, feet: Math.round(Math.hypot(pt.x - a.x, pt.y - a.y) * FEET_PER_SQUARE * 10) / 10 };
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
      add = { kind: "move", to: { col: sq.col, row: sq.row }, feet: sq.steps * FEET_PER_SQUARE };
    }
  } else {
    const name = step.target !== undefined ? tokenLabels(p.tok.level_id).get(Number(step.target)) : undefined;
    // A gear action must be one this token actually has (an equipped item's, a profession's, or a creature's own).
    const use = step.use !== undefined ? gearActions(p.tok.token_id, plannedEquipment(p)).find((g) => g.id === Number(step.use)) : undefined;
    if (step.use !== undefined && !use) return "That isn't one of their actions";
    // On themselves only when the action allows it (Healing Draught: themselves or others).
    if (step.target !== undefined && (!name || (Number(step.target) === p.tok.token_id && use?.targets !== "anyone"))) return "Pick someone else on this map";
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
    // Refit: something they carry that fits the slot, as their gear will be by then.
    let swap: Refit | undefined;
    if (step.action === "refit") {
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
    if (tg && (step.picks?.length || (!use?.area && (tg.count === "exactly" || tg.count === "upto")))) {
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
    const first = picks && !aim ? picks[0] : undefined;
    add = { kind: "action", action: step.action, ...(seconds ? { seconds } : {}), ...(swap ? { swap } : {}), ...(name && !aim ? { target: { id: Number(step.target), name } } : first ? { target: first } : {}), ...(use ? { use: gear as GearAction } : {}), ...(aim ? { aim } : {}), ...(picks ? { picks } : {}) };
  }
  const why = cannotAdd(p.plan, add, p.walking);
  if (why) return why;
  saveRoundPlan(p.tok.level_id, p.tok.token_id, [...p.plan, add], false);
  return null;
}

export const undoPlanStep = (p: Planner) => { if (!p.rolled) saveRoundPlan(p.tok.level_id, p.tok.token_id, p.plan.slice(0, -1), false); };

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

/** The dice landed: they go onto the plan's steps, and the plan is set. */
export function submitPlanRoll(p: Planner, thrown: number[][][]): string | null {
  if (p.rolled !== 1) return "Nothing to roll";
  const plan = withThrownDice(p.plan, planRolls(p.tok.token_id, p.plan), thrown);
  if (!plan) return "Those dice don't fit these rolls";
  setPlanRolled(p.tok.level_id, p.tok.token_id, 2, plan);
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
    feetLeft: (t.left * p.walking) / 6,
    perSecond: p.walking / 6, // feet a second at walking pace
    gear: gearActions(tokenId, plannedEquipment(p)), // their actions, with any refit planned so far done
    refits: refitOptions(tokenId, plannedEquipment(p)),
    attackRange: attackRange(tokenId, plannedEquipment(p)), // squares a plain Attack reaches (after any refit)
  };
}
