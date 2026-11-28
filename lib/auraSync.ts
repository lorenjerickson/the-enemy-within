/**
 * Auras out of a round: after a token moves (the GM drags it, a player walks), a condition is put on or taken off,
 * or sides change, those within an aura get its condition and those out of it lose it. (In a round, the engine does
 * this every second.) A save as it lands is rolled here by the server for now (backlog: players roll their own).
 */
import { downTokens, listTokens, tokenLabels } from "@/lib/db/tokens";
import { listAfflictions, listAuraPasses, saveAfflictions, saveAuraPasses } from "@/lib/db/effects";
import { logSessionEvent } from "@/lib/db/sessions";
import { fightersOn } from "@/lib/combat";
import { auraAffliction, aurasOf, auraWants, syncAuras } from "@/lib/auras";
import { NO_SAVE_DC, UNTIL_REMOVED, type LastingArea } from "@/lib/aoe";
import { FEET_PER_SQUARE } from "@/lib/movement";
import { describeCondition } from "@/lib/conditions";
import { isGridlessLevel, listStructures } from "@/lib/db/maps";
import { blockingSegments } from "@/lib/visibility";

/** Brings a level's aura conditions in line with where everyone is; returns what happened (also logged). */
export function syncAurasOn(levelId: number): string[] {
  const afflicted = listAfflictions(levelId), passes = listAuraPasses(levelId), fighters = fightersOn(levelId), tokens = listTokens(levelId);
  const labels = tokenLabels(levelId), name = (id: number) => labels.get(id) ?? "someone";
  const before = [...passes].sort().join();
  const log: string[] = [];
  let changed = false;
  const wants = auraWants({
    ids: [...fighters.keys()],
    where: (id) => { const t = tokens.find((x) => x.id === id); return t ? { col: t.col, row: t.row } : undefined; },
    allegiance: (id) => fighters.get(id)?.allegiance ?? "hostile",
    down: downTokens(levelId),
    standing: (id) => fighters.get(id)?.auras ?? [],
    afflicted,
    gridless: isGridlessLevel(levelId),
    walls: blockingSegments(listStructures(levelId)),
  });
  syncAuras(afflicted, wants, passes,
    (target, c, source) => {
      if (c.apply_save_attr) {
        const dc = c.apply_save_dc ?? 12, s = fighters.get(target)?.save(c.apply_save_attr);
        if (s && s.total >= dc && c.apply_save_outcome !== "halves") {
          log.push(`${name(target)} comes within ${name(source)}'s aura and resists ${c.name} (${c.apply_save_attr} ${s.total} vs DC ${dc}).`);
          return false;
        }
      }
      afflicted.set(target, [...(afflicted.get(target) ?? []), auraAffliction(c, source)]);
      log.push(`${name(target)} comes within ${name(source)}'s aura: ${c.name} (${describeCondition(c, false)}) while there.`);
      changed = true;
      return true;
    },
    (target, a) => {
      afflicted.set(target, (afflicted.get(target) ?? []).filter((x) => x !== a));
      log.push(`${name(target)} is out of ${name(a.aura ?? -1)}'s aura: no longer ${a.condition.name.toLowerCase()}.`);
      changed = true;
    });
  if (changed) saveAfflictions(levelId, afflicted);
  if ([...passes].sort().join() !== before) saveAuraPasses(levelId, passes);
  if (log.length) logSessionEvent(log.join(" "));
  return log;
}

/** Auras with a look, drawn round whoever gives them off (a ghoul's green haze): circles following their tokens, as areas to draw (not stored). */
export function auraLooks(levelId: number, tokenIds?: number[]): LastingArea[] {
  const afflicted = listAfflictions(levelId), fighters = fightersOn(levelId), down = downTokens(levelId);
  return listTokens(levelId).filter((t) => !down.has(t.id) && (!tokenIds || tokenIds.includes(t.id))).flatMap((t) =>
    aurasOf(fighters.get(t.id)?.auras ?? [], afflicted.get(t.id)).filter((a) => a.look).map((a, i): LastingArea => ({
      id: -(1_000_000 + t.id * 100 + i), name: `${a.given.name} (aura)`, look: a.look!, ends: UNTIL_REMOVED, damage: null, dc: NO_SAVE_DC, save: "agility", half: false,
      area: { shape: "circle", origin: { x: t.col + 0.5, y: t.row + 0.5 }, dir: 0, size: a.radius / FEET_PER_SQUARE },
    })));
}
