import {
  addLastingArea, addTokenStatus, clearRoundPlans, closeRollRequest, closeRollOffRequests, downTokens, getCharacterPlayer, getEncounter, getEncounterWaiting,
  getGameTime, getPendingRound, getRoundPlan, getTokenMover, isGridlessLevel, listLastingAreas, listStructures, listTokens, logSessionEvent, moveToken,
  openRollOffRequest, requestRoll, saveEncounter, saveRollResult, setGameTime, setLastRoundLog, setPendingRound, setReplay, tokenLabels,
} from "@/lib/db";
import { ROUND_SECONDS } from "@/lib/roundPlan";
import { fireTriggers } from "@/lib/game";
import { ContestedMove, resolveMovement, type Mover } from "@/lib/resolveRound";
import { withSeed } from "@/lib/dice";
import { attackRange, fightersOn, saveHp, saveRefit, tokenWho } from "@/lib/combat";
import { blockingSegments, movementBlockers } from "@/lib/visibility";
import { rollSpec, type RollSpec } from "@/lib/rolls";

// Resolving a round on the server (not server actions: the GM's and players' actions call these after their own checks).

/** Works the round out with these dice and the GM's calls so far, and applies it, unless it stops on a contested
 * move the GM hasn't settled yet (then it's kept pending for them, and nothing changes). */
export function workOutRound(levelId: number, seed: number, decisions: Record<string, number>) {
  const enc = getEncounter(levelId);
  if (!enc) return;
  const tokens = listTokens(levelId);
  const initiative = new Map(enc.order.map((o) => [o.token_id, o.initiative]));
  const labels = tokenLabels(levelId);
  const taking = new Set([...enc.order.map((o) => o.token_id), ...getEncounterWaiting(levelId)]);
  const movers: Mover[] = tokens
    .filter((t) => taking.has(t.id))
    .map((t) => ({
      tokenId: t.id,
      name: labels.get(t.id) ?? t.name,
      initiative: initiative.get(t.id) ?? -1000, // hasn't rolled: loses every tie
      start: { col: t.col, row: t.row },
      plan: getRoundPlan(levelId, t.id).plan,
      walking: JSON.parse(getTokenMover(t.id)?.movement ?? "{}").walking ?? 0,
      attackRange: attackRange(t.id),
      equipment: tokenWho(t.id)?.equipment ?? {},
    }));
  const bystanders = tokens.filter((t) => !taking.has(t.id)).map((t) => ({ tokenId: t.id, name: labels.get(t.id) ?? t.name, at: { col: t.col, row: t.row } }));
  const fighters = fightersOn(levelId);
  const startDown = [...downTokens(levelId)]; // before the round (for the replay's opening frame)
  const lasting = listLastingAreas(levelId);
  let result: ReturnType<typeof resolveMovement>;
  try {
    result = withSeed(seed, () => resolveMovement(movers, bystanders, movementBlockers(listStructures(levelId)), isGridlessLevel(levelId), fighters, blockingSegments(listStructures(levelId)), lasting, decisions));
  } catch (e) {
    if (!(e instanceof ContestedMove)) throw e;
    setPendingRound(levelId, { seed, decisions, contest: e.contest });
    return;
  }
  setPendingRound(levelId, null);
  closeRollOffRequests(); // the GM may have decided without waiting for them
  const { final, hp, log, frames, created, statuses, refits, story } = result;
  // The round took 6 s of game time: lasting areas left by it count from its end, and older ones may run out.
  const now = Math.round((getGameTime() + ROUND_SECONDS / 60) * 1e6) / 1e6; // rounded, so 0.1-minute steps add up exactly
  for (const { minutes, ...c } of created) addLastingArea(levelId, { ...c, ends: Math.round((now + minutes) * 1e6) / 1e6 });
  for (const st of statuses) addTokenStatus(levelId, st.tokenId, st.status, Math.round((now + st.minutes) * 1e6) / 1e6);
  setGameTime(now);
  for (const r of refits) saveRefit(r.tokenId, r.equipment, r.swap, r.before); // the swap stays after the round
  for (const [id, h] of hp) saveHp(id, h); // also keeps health rolled for the first time
  for (const m of movers) {
    const end = final.get(m.tokenId)!;
    if (end.col !== m.start.col || end.row !== m.start.row) moveToken(m.tokenId, end.col, end.row);
  }
  const lines = log.length ? log : ["Nothing happened."];
  logSessionEvent(`Round ${enc.round}: ${lines.join(" ")}`);
  saveEncounter(levelId, { ...enc, round: enc.round + 1 });
  setLastRoundLog(levelId, [`Round ${enc.round}`, ...lines]);
  clearRoundPlans(levelId);
  // Everyone plays the round back together, a second at a time, starting once their screens have caught up.
  setReplay(levelId, { round: enc.round, starts: Date.now() + REPLAY_DELAY_MS, start: Object.fromEntries(movers.map((m) => [m.tokenId, m.start])), startDown, frames, story });
  fireTriggers(); // game time moved on (e.g. ON timer.expired)
}

/** How long after resolving the playback starts (players' screens refresh every 3 s). */
const REPLAY_DELAY_MS = 3500;

/** A roll-off for a contested spot: a plain d20. */
const ROLL_OFF: RollSpec = { label: "Roll off for the contested spot", parts: [{ formula: "1d20", source: "Roll-off" }], mode: "normal" };

/** Starts (or, after a tie, restarts) the roll-off on the pending contest: players are asked to roll, the GM's creatures roll now. */
export function startRollOff(levelId: number) {
  const pending = getPendingRound(levelId);
  if (!pending) return;
  const rolloff: Record<number, number | null> = {};
  for (const { id } of [pending.contest.a, pending.contest.b]) {
    const t = listTokens(levelId).find((x) => x.id === id);
    const player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
    if (t?.character_id && player) {
      requestRoll(player, t.character_id, ROLL_OFF, { kind: "rolloff", levelId, tokenId: id });
      rolloff[id] = null;
    } else rolloff[id] = rollSpec(ROLL_OFF).total;
  }
  setPendingRound(levelId, { ...pending, rolloff });
  settleRollOff(levelId);
}

/** A roll-off roll lands (a player's, or one the GM made for them). */
export function recordRollOff(levelId: number, tokenId: number, total: number) {
  const pending = getPendingRound(levelId);
  if (!pending?.rolloff || pending.rolloff[tokenId] !== null) return;
  setPendingRound(levelId, { ...pending, rolloff: { ...pending.rolloff, [tokenId]: total } });
  settleRollOff(levelId);
}

/** The GM rolls a player's roll-off for them. */
export function rollOffFor(levelId: number, tokenId: number, byGm: boolean) {
  const pending = getPendingRound(levelId);
  if (!pending?.rolloff || pending.rolloff[tokenId] !== null) return;
  const req = openRollOffRequest(tokenId);
  const rolled = rollSpec(req?.spec ?? ROLL_OFF);
  if (req) {
    saveRollResult(req.id, { ...rolled, outcome: `Rolled ${rolled.total}${byGm ? " (rolled by the GM)" : ""}.`, success: true });
    closeRollRequest(req.id, req.player_id);
  }
  recordRollOff(levelId, tokenId, rolled.total);
}

/** Once both have rolled: the higher gets the spot and the round is worked out again; a tie rolls again. */
function settleRollOff(levelId: number) {
  const pending = getPendingRound(levelId);
  if (!pending?.rolloff) return;
  const { a, b, key } = pending.contest;
  const ra = pending.rolloff[a.id], rb = pending.rolloff[b.id];
  if (ra == null || rb == null) return;
  logSessionEvent(`Roll-off for a contested spot: ${a.name} ${ra}, ${b.name} ${rb}${ra === rb ? " — a tie, rolling again" : ""}.`);
  if (ra === rb) return startRollOff(levelId);
  workOutRound(levelId, pending.seed, { ...pending.decisions, [key]: ra > rb ? a.id : b.id });
}
