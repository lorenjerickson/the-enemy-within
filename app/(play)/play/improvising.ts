/**
 * An improvisation playing out (out of combat when the GM accepts it; in a round when its planned step finishes): its
 * roll decides success or failure, and the matching outcome happens. What the improviser (and anyone it lands on) is told.
 */
import { addLastingArea, getLastingArea, spreadFire } from "@/lib/db/areas";
import { getGameTime } from "@/lib/db/calendar";
import { getCharacterPlayer, listTokens, tokenLabels } from "@/lib/db/tokens";
import { getCondition } from "@/lib/db/effects";
import { getEncounter } from "@/lib/db/encounters";
import { logSessionEvent } from "@/lib/db/sessions";
import { requestRoll } from "@/lib/db/rolls";
import { rollSpec } from "@/lib/rolls";
import { finishImprovisation, getImprovisation, improviseRollSpec, waitingOnTemplate, rollSucceeds, setImproviseRolled, shifted, templateArea, type Improvisation, type ImproviseOutcome } from "@/lib/improvise";
import { runGameScript } from "@/lib/game";
import { ScriptError } from "@/lib/script";
import { fireTrigger } from "./mapTriggers";
import { catchInArea } from "./areas";
import { UNTIL_REMOVED, inArea } from "@/lib/aoe";
import { rollDice } from "@/lib/dice";
import { applyConditionNow, landsOn } from "./workOutRound";

/** One outcome, now, by `tokenId` (the improviser). What each token is told. */
export function playOutcome(levelId: number, o: ImproviseOutcome, tokenId: number, name: string, placed?: { x: number; y: number }, crit = false): Map<number, string[]> {
  const told = new Map<number, string[]>(), tell = (id: number, s: string) => told.set(id, [...(told.get(id) ?? []), s]);
  if (o.kind === "narrative") { if (o.text.trim()) tell(tokenId, o.text.trim()); }
  else if (o.kind === "script") {
    try { runGameScript(o.script, levelId); } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      logSessionEvent(`💡 ${name}: its script failed (${e.message}).`);
    }
  } else if (o.kind === "map") {
    const f = fireTrigger(levelId, { id: 0, name, area: { shape: "rect", x: 0, y: 0, w: 0, h: 0 }, springs: [], who: "", often: "always", outcomes: o.outcomes, sprung: [] }, null);
    for (const [id, lines] of f.told) for (const l of lines) tell(id, l);
  } else if (o.kind === "area") {
    // Place an area: where it was put (a critical failure: the d8 shifts it to a compass point, by its own size).
    const me = listTokens(levelId).find((t) => t.id === tokenId), from = me ? { x: me.col + 0.5, y: me.row + 0.5 } : { x: 0, y: 0 };
    let at = placed ?? from;
    if (crit) {
      const d8 = Math.max(1, rollDice("1d8"));
      at = shifted(at, o.template, d8);
      tell(tokenId, `It goes astray, to the ${["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][d8 - 1]}.`);
    }
    const { minutes, effectIds, ...s } = o.settings;
    const id = addLastingArea(levelId, {
      ...s, name: s.name || name, area: templateArea(o.template, at, from), drawn: true,
      conditions: (effectIds ?? []).flatMap((e) => { const c = getCondition(e); return c ? [c] : []; }),
      ends: minutes > 0 ? Math.round((getGameTime() + minutes) * 1e6) / 1e6 : UNTIL_REMOVED,
    });
    // Like an area switched on: whoever is in it now is caught (coming in), and fire spreads.
    const l = getLastingArea(id);
    if (l && (l.fires ?? []).some((f) => f !== "leave")) for (const t of listTokens(levelId)) if (inArea(l.area, { x: t.col + 0.5, y: t.row + 0.5 })) tell(t.id, catchInArea(levelId, l, t.id));
    spreadFire(levelId);
  } else if (o.kind === "effect") {
    const found = getCondition(o.effect), on = o.on === "self" ? tokenId : o.target;
    const landed = found && on !== undefined ? landsOn(on, found) : null; // the effect's own save as it lands
    const c = landed?.c;
    if (found && !c && on !== undefined) tell(on, `You shake off ${found.name.toLowerCase()}.`);
    if (c && on !== undefined && listTokens(levelId).some((t) => t.id === on)) {
      const happened = applyConditionNow(levelId, on, c);
      tell(on, `${on === tokenId ? "You're" : `${tokenLabels(levelId).get(tokenId) ?? "Someone"} leaves you`} ${c.name.toLowerCase()}${happened.length ? ` (${happened.join(", ")})` : ""}.`);
    }
  }
  return told;
}

/** The improvisation plays out: success or failure by its roll, that outcome, and it's done. What each token is told. */
export function playImprovisation(i: Improvisation): Map<number, string[]> {
  const a = i.agreed;
  if (!a) return new Map();
  const ok = rollSucceeds(a.roll, i.rolled);
  const verdict = !a.roll ? "" : ok ? "it works" : i.rolled?.natural === 1 ? "it goes badly wrong" : "it doesn't work";
  const o = ok ? a.success : a.failure;
  const told = o ? playOutcome(i.level_id, o, i.token_id, a.name, i.placed, !!a.roll && i.rolled?.natural === 1) : new Map<number, string[]>();
  if (verdict) told.set(i.token_id, [`${a.name}: ${verdict}.`, ...(told.get(i.token_id) ?? [])]);
  finishImprovisation(i.id, (told.get(i.token_id) ?? []).join(" "));
  logSessionEvent(`💡 ${tokenLabels(i.level_id).get(i.token_id) ?? "Someone"}: ${a.name}${a.roll ? ` (${i.rolled?.total ?? "no roll"} vs DC ${a.roll.dc}: ${ok ? "success" : "failure"})` : ""}.`);
  return told;
}


/**
 * Settled by the GM: its roll is asked for (a player rolls their own; the GM's creatures roll at once). Out of combat
 * it plays out as soon as it's rolled (or at once, with no roll); in a round it waits for its planned step.
 * What the improviser is told now.
 */
export function startImprovisation(id: number): Map<number, string[]> {
  const i = getImprovisation(id);
  if (!i?.agreed) return new Map();
  const inRound = !!getEncounter(i.level_id);
  if (waitingOnTemplate(i)) return new Map(); // its template first: the player places it, the GM goes ahead (then this again)
  const spec = inRound ? null : improviseRollSpec(i); // in a round its roll goes with the plan dice (Ready)
  if (spec) {
    const t = listTokens(i.level_id).find((x) => x.id === i.token_id), player = t?.character_id ? getCharacterPlayer(t.character_id) : null;
    if (player && t?.character_id) { requestRoll(player, t.character_id, spec, { kind: "improvise", id }); return new Map(); }
    const r = rollSpec(spec);
    setImproviseRolled(id, { total: r.total, natural: r.parts[0]?.dice[0] ?? 0 });
  }
  return inRound ? new Map() : playImprovisation(getImprovisation(id)!);
}

/** A player's roll for an improvisation came in: kept; out of combat it plays out now (what they're told), in a round later. */
export function improvisationRolled(id: number, rolled: { total: number; natural: number }): string {
  const i = getImprovisation(id);
  if (!i) return "It's gone.";
  setImproviseRolled(id, rolled);
  if (getEncounter(i.level_id)) return "Rolled: you'll see how it goes when the round plays out.";
  return (playImprovisation(getImprovisation(id)!).get(i.token_id) ?? []).join(" ") || "Done.";
}
