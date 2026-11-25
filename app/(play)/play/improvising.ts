/**
 * An improvisation playing out (out of combat when the GM accepts it; in a round when its planned step finishes): its
 * roll decides success or failure, and the matching outcome happens. What the improviser (and anyone it lands on) is told.
 */
import { getCondition, listTokens, logSessionEvent, tokenLabels } from "@/lib/db";
import { finishImprovisation, rollSucceeds, type Improvisation, type ImproviseOutcome } from "@/lib/improvise";
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
  finishImprovisation(i.id);
  logSessionEvent(`💡 ${tokenLabels(i.level_id).get(i.token_id) ?? "Someone"}: ${a.name}${a.roll ? ` (${i.rolled?.total ?? "no roll"} vs DC ${a.roll.dc}: ${ok ? "success" : "failure"})` : ""}.`);
  return told;
}
