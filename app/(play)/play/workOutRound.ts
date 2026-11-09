import {
  addLastingArea, addTokenStatus, clearRoundPlans, closeRollRequest, closeRollOffRequests, downTokens, getCharacterPlayer, getEncounter, getEncounterWaiting,
  getGameTime, getPendingRound, getRoundPlan, getTokenMover, isGridlessLevel, listLastingAreas, listStructures, listTokens, logSessionEvent, moveToken,
  openRollOffRequest, requestRoll, saveEncounter, saveRollResult, setGameTime, setLastRoundLog, setPendingRound, setReplay, tokenLabels,
} from "@/lib/db";
import { ROUND_SECONDS } from "@/lib/roundPlan";
import { fireTriggers } from "@/lib/game";
import { ContestedMove, SaveNeeded, resolveMovement, type Mover } from "@/lib/resolveRound";
import { withSeed } from "@/lib/dice";
import { attackRange, fightersOn, saveHp, saveRefit, tokenWho } from "@/lib/combat";
import { blockingSegments, movementBlockers } from "@/lib/visibility";
import { rollSpec, type RollSpec } from "@/lib/rolls";
import { afflictedLevels, listAfflictions, saveAfflictions } from "@/lib/db";
import { tickAfflictions } from "@/lib/resolveRound";
import { saveRollFor, speedOf, effectiveMaxHp } from "@/lib/creatureChanges";
import { saveTokenHealth, tokenHealth } from "@/lib/health";
import { lingers, modifiersOf, type Condition } from "@/lib/conditions";
import { rollDice } from "@/lib/dice";
import { addAffliction } from "@/lib/db";
import { openConditionSaveRequest } from "@/lib/db";

/**
 * Game time passing out of an encounter: every 6 s is a round for effects (Poisoned…) on a level with no encounter
 * running (an encounter's rounds tick them as they're resolved).
 */
export function passTimeForEffects(minutes: number) {
  const rounds = Math.min(600, Math.floor(minutes * 10 + 1e-9));
  if (rounds <= 0) return;
  for (const levelId of afflictedLevels()) {
    if (getEncounter(levelId)) continue;
    const afflicted = listAfflictions(levelId), fighters = fightersOn(levelId), labels = tokenLabels(levelId);
    const hp = new Map([...fighters].map(([id, f]) => [id, f.hp])), start = new Map(hp);
    const down = new Set([...hp].filter(([, h]) => h <= 0).map(([id]) => id));
    const log: string[] = [];
    const nameOf = (id: number) => labels.get(id) ?? "someone";
    for (let i = 0; i < rounds && [...afflicted.values()].some((l) => l.length); i++) {
      tickAfflictions(afflicted, { hp, fighters, down, nameOf, log, sec: i + 1, hurt: () => 0 });
    }
    for (const [id, h] of hp) if (h !== start.get(id)) saveHp(id, h);
    saveAfflictions(levelId, afflicted);
    if (log.length) logSessionEvent(`Time passes: ${log.join(" ")}`);
  }
}

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
      walking: speedOf(t.id, getTokenMover(t.id)?.movement ?? "{}"),
      attackRange: attackRange(t.id),
      equipment: tokenWho(t.id)?.equipment ?? {},
    }));
  const bystanders = tokens.filter((t) => !taking.has(t.id)).map((t) => ({ tokenId: t.id, name: labels.get(t.id) ?? t.name, at: { col: t.col, row: t.row } }));
  const fighters = fightersOn(levelId);
  const startDown = [...downTokens(levelId)]; // before the round (for the replay's opening frame)
  const lasting = listLastingAreas(levelId);
  // Players' characters roll their own saves against conditions (the round waits for them).
  const rollers = new Set(tokens.filter((t) => t.character_id !== null && getCharacterPlayer(t.character_id) !== null).map((t) => t.id));
  let result: ReturnType<typeof resolveMovement>;
  try {
    result = withSeed(seed, () => resolveMovement(movers, bystanders, movementBlockers(listStructures(levelId)), isGridlessLevel(levelId), fighters, blockingSegments(listStructures(levelId)), lasting, decisions, listAfflictions(levelId), rollers));
  } catch (e) {
    if (e instanceof SaveNeeded) {
      // A player's character must save against a condition landing on it: they're asked to roll; the round waits.
      setPendingRound(levelId, { seed, decisions, save: e.save });
      const t = tokens.find((x) => x.id === e.save.tokenId), player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
      if (t?.character_id && player && !openConditionSaveRequest(t.id)) {
        requestRoll(player, t.character_id, saveRollFor(t.id, e.save.attr, `${e.save.attr[0].toUpperCase()}${e.save.attr.slice(1)} save against ${e.save.condition} (DC ${e.save.dc})`), { kind: "conditionSave", levelId, tokenId: t.id, key: e.save.key });
      }
      return;
    }
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
  for (const [id, h] of hp) saveHp(id, h);
  saveAfflictions(levelId, result.afflictions); // effects put on, ticked, worn off or shaken off
  // Temporary health granted this round: the highest of what they have and what they got (it doesn't add up).
  for (const [id, n] of result.temps) {
    const h = tokenHealth(id);
    if (h && n > h.temporary) saveTokenHealth(id, { ...h, temporary: n });
  }
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
  if (!pending?.contest) return;
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
  if (!pending?.rolloff || !pending.contest) return;
  const { a, b, key } = pending.contest;
  const ra = pending.rolloff[a.id], rb = pending.rolloff[b.id];
  if (ra == null || rb == null) return;
  logSessionEvent(`Roll-off for a contested spot: ${a.name} ${ra}, ${b.name} ${rb}${ra === rb ? " — a tie, rolling again" : ""}.`);
  if (ra === rb) return startRollOff(levelId);
  workOutRound(levelId, pending.seed, { ...pending.decisions, [key]: ra > rb ? a.id : b.id });
}

/** A player's (or, for them, the GM's) save against a condition lands: the round is worked out again with it. */
export function recordConditionSave(levelId: number, key: string, total: number) {
  const pending = getPendingRound(levelId);
  if (!pending?.save || pending.save.key !== key) return;
  logSessionEvent(`${pending.save.name} rolls ${total} to resist ${pending.save.condition} (DC ${pending.save.dc}).`);
  workOutRound(levelId, pending.seed, { ...pending.decisions, [key]: total });
}

/** The GM rolls the waiting condition save for its player (they're away, or slow). */
export function rollConditionSaveFor(levelId: number) {
  const pending = getPendingRound(levelId);
  if (!pending?.save) return;
  const { tokenId, attr, condition, dc, key } = pending.save;
  const req = openConditionSaveRequest(tokenId);
  const rolled = rollSpec(req?.spec ?? saveRollFor(tokenId, attr, `${attr} save against ${condition} (DC ${dc})`));
  if (req) {
    saveRollResult(req.id, { ...rolled, outcome: `Rolled ${rolled.total} (rolled by the GM).`, success: rolled.total >= dc });
    closeRollRequest(req.id, req.player_id);
  }
  recordConditionSave(levelId, key, rolled.total);
}

/**
 * A condition put on by hand (the GM's sheet), out of a round: its instant parts happen now (healing, damage,
 * temporary health) and, if there's more to it, it stays on them. Returns what happened, for the log.
 */
export function applyConditionNow(levelId: number, tokenId: number, c: Condition): string[] {
  const out: string[] = [];
  const h = tokenHealth(tokenId);
  if (h) {
    let next = { ...h };
    for (const m of modifiersOf(c)) {
      if (m.kind === "instant") {
        const n = Math.max(0, rollDice(m.value));
        if (m.heal) { const max = effectiveMaxHp(tokenId, h.maximum); const to = Math.min(max, next.current + n); out.push(`healed for ${to - next.current}`); next.current = to; }
        else { const fromTemp = Math.min(next.temporary, n); next = { ...next, temporary: next.temporary - fromTemp, current: Math.max(0, next.current - (n - fromTemp)) }; out.push(`${n} damage`); }
      }
      if (m.kind === "temphp") { const n = Math.max(0, rollDice(m.value)); if (n > next.temporary) next.temporary = n; out.push(`${n} temporary health`); }
    }
    if (next.current !== h.current || next.temporary !== h.temporary) saveTokenHealth(tokenId, next);
  }
  if (lingers(c)) addAffliction(levelId, tokenId, c, null);
  return out;
}
