/**
 * Map triggers firing outside rounds (free movement): their outcomes happen at once, the GM's log says so, and the
 * player learns only what it does to them (a trap it sets off on them; being stopped). Rounds note which fire and
 * apply them after the round (see workOutRound).
 */
import { getDoor, setDoorLocked, setDoorOpen } from "@/lib/db/maps";
import { listMapTriggers, markMapTriggerSprung } from "@/lib/db/traps";
import { listSecrets, setSecretRevealed } from "@/lib/db/story";
import { listTokens } from "@/lib/db/tokens";
import { logSessionEvent } from "@/lib/db/sessions";
import { setMapThingOn } from "@/lib/db/mapThings";
import { revealDiscovery } from "@/lib/storyRules";
import { allegianceOf } from "@/lib/sides";
import { sprungByStep, sprungWhereStanding } from "@/lib/traps";
import { describeOutcome, type MapTrigger } from "@/lib/triggers";
import type { Point } from "@/lib/visibility";
import { runGameScript } from "@/lib/game";
import { ScriptError } from "@/lib/script";
import { setOffHazard } from "./hazards";
import { isActive, type Hazard } from "@/lib/hazards";
import { getGameTime } from "@/lib/db/calendar";
import { catchInArea } from "./areas";
import { getLastingArea, setLastingAreaOff, spreadFire } from "@/lib/db/areas";
import { inArea } from "@/lib/aoe";

export interface Fired {
  trigger: MapTrigger;
  stops: boolean; // stops whoever set it off
  told: Map<number, string[]>; // what each token's player is told (traps it set off on them)
}

/** A trigger's outcomes, now (for `tokenId`, who set it off; null: no one in particular). */
export function fireTrigger(levelId: number, t: MapTrigger, tokenId: number | null): Fired {
  if (tokenId !== null) markMapTriggerSprung(t.id, tokenId);
  const told = new Map<number, string[]>(), done: string[] = [];
  for (const o of t.outcomes) {
    if (o.kind === "door") {
      if (o.to === "open") { setDoorLocked(o.door, false); setDoorOpen(o.door, true); } // a trigger's door opens even if locked (a portcullis)
      else if (o.to === "close") setDoorOpen(o.door, false);
      else setDoorLocked(o.door, o.to === "lock");
    } else if (o.kind === "light") setMapThingOn("light_sources", o.light, o.on);
    else if (o.kind === "effect") setMapThingOn("map_effects", o.effect, o.on);
    else if (o.kind === "secret") {
      setSecretRevealed(o.secret, true);
      const d = listSecrets(levelId).find((s) => s.id === o.secret)?.discovery_id;
      if (d) revealDiscovery(d);
    } else if (o.kind === "discovery") revealDiscovery(o.discovery);
    else if (o.kind === "area") {
      // A hazard: switched off; switched on (an active one catches whoever is in it now); set off (a dormant one
      // springs, an active one catches whoever is in it now, whatever its timings).
      if (o.to !== "set off") setLastingAreaOff(o.area, o.to === "off");
      const l = o.to === "off" ? undefined : (getLastingArea(o.area) as Hazard | undefined);
      if (l && !l.off && l.activation === "dormant" && o.to === "set off") for (const s of setOffHazard(levelId, l)) told.set(s.tokenId, [...(told.get(s.tokenId) ?? []), s.player]);
      else if (l && isActive(l, getGameTime())) for (const tok of listTokens(levelId)) if (inArea(l.area, { x: tok.col + 0.5, y: tok.row + 0.5 })) told.set(tok.id, [...(told.get(tok.id) ?? []), catchInArea(levelId, l, tok.id)]);
      spreadFire(levelId);
    }
    else if (o.kind === "script") {
      try { runGameScript(o.script, levelId); } catch (e) {
        if (!(e instanceof ScriptError)) throw e;
        logSessionEvent(`⚡ ${t.name}: its script failed (${e.message}).`);
      }
    }
    done.push(describeOutcome(o, (kind, id) => (kind === "door" ? getDoor(id)?.name || `door ${id}` : `${kind} ${id}`)));
  }
  const by = tokenId !== null ? listTokens(levelId).find((x) => x.id === tokenId)?.name : undefined;
  logSessionEvent(`⚡ ${t.name}${by ? ` (set off by ${by})` : ""}: ${done.join(", ") || "nothing"}.`);
  return { trigger: t, stops: t.outcomes.some((o) => o.kind === "stop"), told };
}

const centre = (p: Point) => ({ x: p.x + 0.5, y: p.y + 0.5 }); // a token's corner (col, row) to its centre

/** The triggers a token's step (token corners, grid units) sets off, fired now. */
export function triggersOnStep(levelId: number, tokenId: number, from: Point, to: Point): Fired[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  return sprungByStep(listMapTriggers(levelId), tokenId, allegianceOf(token), centre(from), centre(to)).map((t) => fireTrigger(levelId, t, tokenId));
}

/** The triggers that fire for a token ending its move where it stands, fired now. */
export function triggersWhereStopped(levelId: number, tokenId: number, at: Point): Fired[] {
  const token = listTokens(levelId).find((t) => t.id === tokenId);
  if (!token) return [];
  return sprungWhereStanding(listMapTriggers(levelId), tokenId, allegianceOf(token), centre(at), "end").map((t) => fireTrigger(levelId, t, tokenId));
}
