import { inArea } from "@/lib/aoe";
import { getImprovisation, improviseRollSpec, setImproviseRolled } from "@/lib/improvise";
import { rolledTotal } from "@/lib/planRolls";
import { playImprovisation } from "./improvising";
import { igniteAreas, listHazards, getExposures, saveExposures, setLastingAreaFound, addLastingArea, listLastingAreas, getLastingArea } from "@/lib/db/areas";
import { asRoundTrap, type Hazard } from "@/lib/hazards";
import { markHazardSprung } from "./hazardSprung";
import { addTokenStatus, downTokens, getCharacterPlayer, getTokenMover, listTokens, moveToken, tokenLabels } from "@/lib/db/tokens";
import { clearRoundPlans, getPendingRound, getRoundPlan, setLastRoundLog, setPendingRound, setReplay } from "@/lib/db/rounds";
import { closeRollRequest, closeRollOffRequests, openRollOffRequest, requestRoll, saveRollResult, type RollAction } from "@/lib/db/rolls";
import { getEncounter, getEncounterWaiting, saveEncounter } from "@/lib/db/encounters";
import { getGameTime, setGameTime } from "@/lib/db/calendar";
import { isGridlessLevel, listStructures } from "@/lib/db/maps";
import { logSessionEvent } from "@/lib/db/sessions";
import { ROUND_SECONDS } from "@/lib/roundPlan";
import { fireTriggers } from "@/lib/game";
import { ContestedMove, SaveNeeded, resolveMovement, type Mover } from "@/lib/resolveRound";
import { withSeed } from "@/lib/dice";
import { attackRange, fightersOn, saveHp, saveRefit, tokenWho, useUpItem } from "@/lib/combat";
import { blockingSegments, movementBlockers } from "@/lib/visibility";
import { rollSpec, type RollSpec } from "@/lib/rolls";
import { afflictedLevels, listAfflictions, listAuraPasses, saveAfflictions, saveAuraPasses } from "@/lib/db/effects";
import { litOn } from "@/lib/sight";
import { tickAfflictions } from "@/lib/resolveRound";
import { saveRollFor, skillCheckFor, speedFps, effectiveMaxHp } from "@/lib/creatureChanges";
import { SEARCH_DC, SEARCH_RANGE } from "@/lib/playerActions";
import { allegianceOf, relation } from "@/lib/sides";
import { reveal as revealHidden } from "./hiding";
import type { Attribute, Attributes } from "@/lib/attributes";
import { saveTokenHealth, tokenHealth } from "@/lib/health";
import { lingers, modifiersOf, type Condition } from "@/lib/conditions";
import { rollDice } from "@/lib/dice";
import { addAffliction, addStrain } from "@/lib/db/effects";
import { clearTokenTargets, recordSightingAt } from "@/lib/db/tokens";
import { openConditionSaveRequest } from "@/lib/db/rolls";
import { getCondition } from "@/lib/db/effects";
import { listTraps, listMapTriggers, markTrapSprung, trapSeenBy } from "@/lib/db/traps";
import { seesSpot } from "@/lib/sight";
import { trapCentre, type Trap } from "@/lib/traps";
import { fireTrigger } from "./mapTriggers";
import { clearAssist, clearHidden, setHidden, listHidden, listAssists, setAssist, setLinkPrompt } from "@/lib/db/tokens";
import { getCharacter } from "@/lib/db/catalog";
import { getDoor, setDoorOpen } from "@/lib/db/maps";
import type { RoundTrap } from "@/lib/resolveRound";

/** A level's traps for a round, with the effects they put on filled in. */
const roundTraps = (levelId: number): RoundTrap[] => [
  ...listTraps(levelId).map((t) => ({ ...t, given: t.effects.flatMap((id) => getCondition(id) ?? []) })),
  ...(listLastingAreas(levelId) as Hazard[]).filter((h) => h.activation === "dormant" && !h.off && !h.spent).map(asRoundTrap), // dormant hazards spring like traps (negative ids)
];

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
      fps: speedFps(t.id, getTokenMover(t.id)?.movement ?? "{}"),
      attackRange: attackRange(t.id),
      equipment: tokenWho(t.id)?.equipment ?? {},
    }));
  const bystanders = tokens.filter((t) => !taking.has(t.id)).map((t) => ({ tokenId: t.id, name: labels.get(t.id) ?? t.name, at: { col: t.col, row: t.row } }));
  const fighters = fightersOn(levelId);
  const startDown = [...downTokens(levelId)]; // before the round (for the replay's opening frame)
  const lasting = listHazards(levelId); // lasting areas, and fire map effects (they burn)
  // Players' characters roll their own saves against conditions (the round waits for them).
  const rollers = new Set(tokens.filter((t) => t.character_id !== null && getCharacterPlayer(t.character_id) !== null).map((t) => t.id));
  let result: ReturnType<typeof resolveMovement>;
  try {
    result = withSeed(seed, () => resolveMovement(movers, bystanders, movementBlockers(listStructures(levelId)), isGridlessLevel(levelId), fighters, blockingSegments(listStructures(levelId)), lasting, decisions, listAfflictions(levelId), rollers, listAuraPasses(levelId), litOn(levelId), roundTraps(levelId), listMapTriggers(levelId), listStructures(levelId), new Map(listAssists(levelId).map((a) => [a.tokenId, { by: a.byToken, name: a.byName }])), listHidden(levelId), getExposures(levelId)));
  } catch (e) {
    if (e instanceof SaveNeeded) {
      // A player's character must save against a condition landing on it: they're asked to roll; the round waits.
      setPendingRound(levelId, { seed, decisions, save: e.save });
      const t = tokens.find((x) => x.id === e.save.tokenId), player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
      if (t?.character_id && player && !openConditionSaveRequest(t.id)) {
        requestRoll(player, t.character_id, helpedSpec(saveRollFor(t.id, e.save.attr, `${e.save.attr[0].toUpperCase()}${e.save.attr.slice(1)} save against ${e.save.condition} (DC ${e.save.dc})`), e.save.helpedBy), { kind: "conditionSave", levelId, tokenId: t.id, key: e.save.key });
      }
      return;
    }
    if (!(e instanceof ContestedMove)) throw e;
    setPendingRound(levelId, { seed, decisions, contest: e.contest });
    return;
  }
  setPendingRound(levelId, null);
  clearTokenTargets(levelId); // targets don't carry over to the next round (nor stay on someone who went down)
  closeRollOffRequests(); // the GM may have decided without waiting for them
  const { final, hp, log, frames, created, statuses, refits, story } = result;
  // The round took 6 s of game time: lasting areas left by it count from its end, and older ones may run out.
  const now = Math.round((getGameTime() + ROUND_SECONDS / 60) * 1e6) / 1e6; // rounded, so 0.1-minute steps add up exactly
  const newAreas: { id: number; sec: number }[] = [];
  for (const { minutes, sec, ...c } of created) { const id = addLastingArea(levelId, { ...c, ends: Math.round((now + minutes) * 1e6) / 1e6 }); if (sec !== undefined) newAreas.push({ id, sec }); }
  for (const st of statuses) addTokenStatus(levelId, st.tokenId, st.status, Math.round((now + st.minutes) * 1e6) / 1e6);
  setGameTime(now);
  for (const r of refits) saveRefit(r.tokenId, r.equipment, r.swap, r.before, r.put); // the swap stays after the round
  for (const u of result.itemsUsed) useUpItem(u.tokenId, u.item); // consumables used this round are gone
  saveExposures(levelId, result.exposure); // still burning, poisoned… (lingering areas)
  igniteAreas(result.ignited.filter((id) => id > 0));
  // Improvisations done this round play out, by the roll thrown with the plan (the GM's creatures: rolled now).
  for (const x of result.improvised) {
    const i = getImprovisation(x.id);
    if (i?.status !== "agreed") continue;
    const spec = improviseRollSpec(i);
    if (spec) {
      const r = x.dice?.length ? { total: rolledTotal(spec, x.dice).total, natural: x.dice[0] } : (() => { const t = rollSpec(spec); return { total: t.total, natural: t.parts[0]?.dice[0] ?? 0 }; })();
      setImproviseRolled(i.id, r);
    }
    playImprovisation(getImprovisation(i.id)!);
  } // flammable areas fire reached this round: burning from now on
  // Hidden areas someone ended the round in: found (they know it's there now).
  for (const l of lasting) if (l.visibility === "hidden" && !l.found && [...final.values()].some((p) => inArea(l.area, { x: p.col + 0.5, y: p.row + 0.5 }))) setLastingAreaFound(l.id);
  for (const [id, h] of hp) saveHp(id, h);
  saveAfflictions(levelId, result.afflictions); // effects put on, ticked, worn off or shaken off
  saveAuraPasses(levelId, result.passes); // who passed an aura's save and is still within it
  for (const s of result.strains) addStrain(s.tokenId, s.attribute, s.points); // strain outlasts the round (and the condition)
  // Spent (for them), and no secret any more to whoever saw it go off (from where they ended the round).
  for (const t of result.trapsSprung) {
    if (t.trapId < 0) { const h = getLastingArea(-t.trapId) as Hazard | undefined; if (h) markHazardSprung(levelId, h, t.tokenId); continue; } // a dormant hazard
    markTrapSprung(t.trapId, t.tokenId);
    const trap = listTraps(levelId).find((x) => x.id === t.trapId);
    if (trap) witnessTrap(levelId, trap, [t.tokenId]);
  }
  // Temporary health granted this round: the highest of what they have and what they got (it doesn't add up).
  for (const [id, n] of result.temps) {
    const h = tokenHealth(id);
    if (h && n > h.temporary) saveTokenHealth(id, { ...h, temporary: n });
  }
  // Players' characters saw from every spot they passed through, not just where they ended up (fog of war).
  for (const fr of frames) for (const [id, p] of Object.entries(fr.pos)) if (tokens.find((t) => t.id === Number(id))?.character_id) recordSightingAt(Number(id), p.col, p.row);
  for (const m of movers) {
    const end = final.get(m.tokenId)!;
    if (end.col !== m.start.col || end.row !== m.start.row) moveToken(m.tokenId, end.col, end.row);
  }
  // Map triggers that fired this round: their outcomes now, in the order they fired (doors, lights, remote traps, scripts…).
  for (const f of result.triggersFired) {
    const t = listMapTriggers(levelId).find((x) => x.id === f.triggerId);
    if (t) fireTrigger(levelId, t, f.tokenId);
  }
  // Who is still hidden (Hide): revealed ones are no longer, new ones are.
  for (const id of listHidden(levelId).keys()) clearHidden(id);
  for (const h of result.hiddenLeft) setHidden(h.tokenId, h.stealth);
  // Who hid this round and is still hidden: their Stealth now (players roll it; the server rolls for the GM's creatures).
  for (const h of result.hides) {
    if (!result.hiddenLeft.some((x) => x.tokenId === h.tokenId)) continue; // given away already
    const t = tokens.find((x) => x.id === h.tokenId), player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
    const who = tokenWho(h.tokenId);
    const base = skillCheckFor(h.tokenId, "stealth", (who?.attributes ?? {}) as Attributes);
    const spec = { ...base, label: `Hide: ${base.label}${h.hurried ? " (in a hurry: disadvantage)" : ""}`, ...(h.hurried ? { mode: base.mode === "advantage" ? ("normal" as const) : ("disadvantage" as const) } : {}) };
    if (t?.character_id && player) requestRoll(player, t.character_id, spec, { kind: "hide", levelId, tokenId: h.tokenId, inRound: true });
    else setHidden(h.tokenId, rollSpec(spec).total);
  }
  // Help (Assist) still to be used carries on; what was spent (or replaced) is gone.
  for (const a of listAssists(levelId)) clearAssist(a.tokenId);
  for (const a of result.assistsLeft) setAssist(a.tokenId, a.by, a.name);
  // Searches done this round: each player rolls Investigation now, from where they searched (with advantage if helped then).
  for (const s of result.searches) {
    const t = tokens.find((x) => x.id === s.tokenId), player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
    const c = t?.character_id ? getCharacter(t.character_id) : undefined;
    if (t && !player) { searchFor(levelId, t.id, s.at, s.helpedBy); continue; } // the GM's: the server rolls it
    if (!t || !c || !player) continue;
    const spec = skillCheckFor(t.id, "investigation", c.attributes);
    requestRoll(player, c.id, helpedSpec({ ...spec, label: `Search: ${spec.label}` }, s.helpedBy), { kind: "search", dc: SEARCH_DC, at: s.at });
  }
  // Levers / switches / objects worked this round (Interact): their triggers fire now.
  for (const w of result.thingsWorked) { const t = listMapTriggers(levelId).find((x) => x.id === w.triggerId); if (t) fireTrigger(levelId, t, w.tokenId); }
  // Doors worked this round (Interact): open or closed now, in the order it happened.
  for (const d of result.doorsWorked) { const door = getDoor(d.doorId); if (door && !door.locked) setDoorOpen(door.id, !door.open); }
  // Characters who came onto a level link: their player is asked whether to take it before planning again.
  // Asked once the replay shows them reaching it (the round is worked out ahead; the player sees it as it plays).
  const replayStarts = Date.now() + REPLAY_DELAY_MS;
  for (const l of result.linksReached) if (tokens.find((t) => t.id === l.tokenId)?.character_id) setLinkPrompt(l.tokenId, l.linkId, l.back, replayStarts + l.sec * 1000);
  const lines = log.length ? log : ["Nothing happened."];
  logSessionEvent(`Round ${enc.round}: ${lines.join(" ")}`);
  saveEncounter(levelId, { ...enc, round: enc.round + 1 });
  setLastRoundLog(levelId, [`Round ${enc.round}`, ...lines]);
  clearRoundPlans(levelId);
  // Everyone plays the round back together, a second at a time, starting once their screens have caught up.
  setReplay(levelId, { round: enc.round, starts: replayStarts, start: Object.fromEntries(movers.map((m) => [m.tokenId, m.start])), startDown, frames, story, newAreas }, lines);
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

/**
 * A Search by one of the GM's tokens (a creature, or a character with no player), after the round: the server rolls
 * Investigation (advantage if helped) and finds anyone hiding from it within 10 ft whose Stealth it beats.
 */
export function searchFor(levelId: number, tokenId: number, at: { col: number; row: number }, helpedBy?: string) {
  const total = rollSpec(helpedSpec(skillCheckFor(tokenId, "investigation", (tokenWho(tokenId)?.attributes ?? {}) as Attributes), helpedBy)).total;
  const tokens = listTokens(levelId), me = tokens.find((t) => t.id === tokenId), hidden = listHidden(levelId);
  if (!me) return;
  const found = tokens.filter((t) => hidden.has(t.id) && total > hidden.get(t.id)! && relation(allegianceOf(me), allegianceOf(t)) !== "friendly" && Math.hypot(t.col - at.col, t.row - at.row) <= SEARCH_RANGE + 0.5);
  const labels = tokenLabels(levelId);
  for (const f of found) revealHidden(levelId, f.id, `found by ${labels.get(tokenId)}'s search`);
  logSessionEvent(`${labels.get(tokenId) ?? "Someone"} searched (Investigation ${total})${found.length ? `: found ${found.map((f) => labels.get(f.id)).join(", ")}` : ": nothing"}.`);
}

/** A save a player rolls mid-round while helped (Assist): with advantage, saying who helped. */
function helpedSpec(spec: RollSpec, by?: string): RollSpec {
  return by ? { ...spec, mode: spec.mode === "disadvantage" ? "normal" : "advantage", label: `${spec.label} (helped by ${by})` } : spec;
}

/** The GM rolls the waiting condition save for its player (they're away, or slow). */
export function rollConditionSaveFor(levelId: number) {
  const pending = getPendingRound(levelId);
  if (!pending?.save) return;
  const { tokenId, attr, condition, dc, key } = pending.save;
  const req = openConditionSaveRequest(tokenId);
  const rolled = rollSpec(req?.spec ?? helpedSpec(saveRollFor(tokenId, attr, `${attr} save against ${condition} (DC ${dc})`), pending.save.helpedBy));
  if (req) {
    saveRollResult(req.id, { ...rolled, outcome: `Rolled ${rolled.total} (rolled by the GM).`, success: rolled.total >= dc });
    closeRollRequest(req.id, req.player_id);
  }
  recordConditionSave(levelId, key, rolled.total);
}

/** One check a cause asks of someone, for the roll prompt: "Agility vs DC 12 halves the damage". */
export type Check = { attr: Attribute; dc: number; decides: string };
export const effectCheck = (c: Condition): Check[] => (c.apply_save_attr ? [{ attr: c.apply_save_attr, dc: c.apply_save_dc ?? 12, decides: `${c.apply_save_outcome === "halves" ? "halves" : "keeps out"} ${c.name}` }] : []);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One d20 per interaction, out of combat (Q): every check a cause asks of one token is one throw. A player's character
 * is asked for it (one prompt listing what it decides; null back: settle when the roll comes in, with `rolled`); the
 * GM's creatures roll now. Back: each check's total by ability (the throw, with that ability's modifier in place of
 * the first check's).
 */
export function throwFor(levelId: number, tokenId: number, name: string, checks: Check[], action: RollAction, rolled?: number): ((attr: Attribute) => number) | null {
  if (!checks.length) return () => 0;
  const first = checks[0].attr, f = fightersOn(levelId).get(tokenId);
  const shifted = (total: number) => (attr: Attribute) => total - (f?.saveMod?.(first) ?? 0) + (f?.saveMod?.(attr) ?? 0);
  if (rolled !== undefined) return shifted(rolled);
  const tok = listTokens(levelId).find((t) => t.id === tokenId), player = tok?.character_id ? getCharacterPlayer(tok.character_id) : null;
  if (player && tok?.character_id) {
    requestRoll(player, tok.character_id, saveRollFor(tokenId, first, `${name}: ${checks.map((c) => `${cap(c.attr)} vs DC ${c.dc} ${c.decides}`).join(" · ")}`), action);
    return null;
  }
  return shifted(f ? f.save(first).total : 0);
}

/**
 * Effects landing on someone out of combat from one cause (an item used, an improvisation): their own saves as they
 * land are one throw (`throwFor`): a player's character is asked (`waiting`; it lands when the roll comes in, with
 * `rolled`), the GM's creatures roll now. What happened, a line each, for the log.
 */
export function landEffects(levelId: number, tokenId: number, source: string, effects: Condition[], rolled?: number): { lines: string[]; waiting: boolean; landed: { name: string; happened: string[] }[] } {
  if (!effects.length) return { lines: [], waiting: false, landed: [] };
  const totalOf = throwFor(levelId, tokenId, source, effects.flatMap(effectCheck), { kind: "landSave", levelId, tokenId, source, effects: effects.map((c) => c.id) }, rolled);
  if (!totalOf) return { lines: [`must roll to resist ${effects.map((c) => c.name).join(", ")}`], waiting: true, landed: [] };
  const landed: { name: string; happened: string[] }[] = [];
  const lines = effects.map((found) => {
    const { c, note } = landsOn(tokenId, found, totalOf);
    if (!c) return note;
    const happened = applyConditionNow(levelId, tokenId, c);
    landed.push({ name: c.name, happened });
    return `${note || c.name}${happened.length ? ` (${happened.join(", ")})` : ""}`;
  });
  return { lines, waiting: false, landed };
}

/**
 * An effect's own save as it lands, outside rounds (rolled by the server with their numbers): null if they resist it
 * outright, else the effect to put on (with half its rounds on a "halves" success), and a note for the GM's log.
 */
export function landsOn(tokenId: number, c: Condition, totalOf?: (attr: Attribute) => number): { c: Condition | null; note: string } {
  if (!c.apply_save_attr) return { c, note: "" };
  const dc = c.apply_save_dc ?? 12, total = totalOf ? totalOf(c.apply_save_attr) : rollSpec(saveRollFor(tokenId, c.apply_save_attr, `${c.apply_save_attr} save against ${c.name} (DC ${dc})`)).total;
  const vs = `${c.apply_save_attr} ${total} vs DC ${dc}`;
  if (total < dc) return { c, note: `fails to resist ${c.name} (${vs})` };
  if (c.apply_save_outcome !== "halves") return { c: null, note: `resists ${c.name} (${vs})` };
  return { c: { ...c, rounds: Math.max(1, Math.floor(c.rounds / 2)) }, note: `partly resists ${c.name} (${vs})` };
}

/**
 * A condition put on by hand (the GM's sheet), out of a round: its instant parts happen now (healing, damage,
 * temporary health) and, if there's more to it, it stays on them. Returns what happened, for the log.
 */
export function applyConditionNow(levelId: number, tokenId: number, c: Condition, area?: number): string[] {
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
      if (m.kind === "strain" && m.points) { const now = addStrain(tokenId, m.attribute, m.points); out.push(`${m.points > 0 ? `${m.points}` : `${-m.points} less`} ${m.attribute} strain (${now} now)`); }
      if (m.kind === "temphp") { const n = Math.max(0, rollDice(m.value)); if (n > next.temporary) next.temporary = n; out.push(`${n} temporary health`); }
    }
    if (next.current !== h.current || next.temporary !== h.temporary) saveTokenHealth(tokenId, next);
  }
  if (lingers(c) && !addAffliction(levelId, tokenId, c, null, area)) out.push(`already ${c.name.toLowerCase()}: no change`); // area: while in it
  return out;
}

/**
 * A trap went off: the characters who could see it (and those it caught) now know it's there; their players see it on
 * the map. Going off out of everyone's sight reveals it to no one (a Search still finds it).
 */
export function witnessTrap(levelId: number, trap: Trap, caught: number[] = []): void {
  const middle = trapCentre(trap.area);
  const saw = listTokens(levelId).filter((t) => t.character_id !== null && (caught.includes(t.id) || seesSpot(levelId, t.id, middle))).map((t) => t.id);
  if (saw.length) trapSeenBy(trap.id, saw);
}

