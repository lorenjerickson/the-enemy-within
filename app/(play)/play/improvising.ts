/**
 * An improvisation playing out (out of combat when the GM accepts it; in a round when its planned step finishes): its
 * roll decides success or failure, and the matching outcome happens. What the improviser (and anyone it lands on) is told.
 */
import { getCharacterPlayer, getCondition, getEncounter, getTokenActor, listTokens, logSessionEvent, requestRoll, tokenLabels } from "@/lib/db";
import { saveRollFor, skillCheckFor } from "@/lib/creatureChanges";
import { rollSpec, type RollSpec } from "@/lib/rolls";
import type { Attributes } from "@/lib/attributes";
import { finishImprovisation, getImprovisation, rollSucceeds, setImproviseRolled, type Improvisation, type ImproviseOutcome } from "@/lib/improvise";
import { runGameScript } from "@/lib/game";
import { ScriptError } from "@/lib/script";
import { fireTrigger } from "./mapTriggers";
import { applyConditionNow } from "./workOutRound";

/** One outcome, now, by `tokenId` (the improviser). What each token is told. */
export function playOutcome(levelId: number, o: ImproviseOutcome, tokenId: number, name: string): Map<number, string[]> {
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
  } else if (o.kind === "effect") {
    const c = getCondition(o.effect), on = o.on === "self" ? tokenId : o.target;
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
  const told = o ? playOutcome(i.level_id, o, i.token_id, a.name) : new Map<number, string[]>();
  if (verdict) told.set(i.token_id, [`${a.name}: ${verdict}.`, ...(told.get(i.token_id) ?? [])]);
  finishImprovisation(i.id, (told.get(i.token_id) ?? []).join(" "));
  logSessionEvent(`💡 ${tokenLabels(i.level_id).get(i.token_id) ?? "Someone"}: ${a.name}${a.roll ? ` (${i.rolled?.total ?? "no roll"} vs DC ${a.roll.dc}: ${ok ? "success" : "failure"})` : ""}.`);
  return told;
}

/** The dice an improvisation's roll needs, for its improviser. */
function rollSpecFor(i: Improvisation): RollSpec | null {
  const r = i.agreed?.roll, me = getTokenActor(i.token_id);
  if (!r || !me) return null;
  const spec = r.type === "check" ? skillCheckFor(i.token_id, r.skill, JSON.parse(me.attributes) as Attributes) : saveRollFor(i.token_id, r.attribute as never, "");
  return { ...spec, label: `${i.agreed!.name}: ${r.type === "check" ? cap(r.skill) : `${cap(r.attribute)} ${r.type}`}` };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Settled by the GM: its roll is asked for (a player rolls their own; the GM's creatures roll at once). Out of combat
 * it plays out as soon as it's rolled (or at once, with no roll); in a round it waits for its planned step.
 * What the improviser is told now.
 */
export function startImprovisation(id: number): Map<number, string[]> {
  const i = getImprovisation(id);
  if (!i?.agreed) return new Map();
  const inRound = !!getEncounter(i.level_id);
  const spec = rollSpecFor(i);
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
