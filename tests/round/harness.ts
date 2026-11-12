// Small builders for round-resolution tests: fighters with fixed rolls, movers, plan steps, and one call to resolve.
import { resolveMovement, type Combatant, type Mover, type RoundTrap } from "@/lib/resolveRound";
import type { MapTrigger } from "@/lib/triggers";
import type { GearAction, PlanStep } from "@/lib/roundPlan";
import type { PlayerActionId } from "@/lib/playerActions";
import type { Allegiance } from "@/lib/sides";
import type { Segment } from "@/lib/visibility";
import type { LastingArea } from "@/lib/aoe";
import type { Affliction, Condition, Modifier } from "@/lib/conditions";

export type Pos = { col: number; row: number };
export type Fake = Combatant & { attacks: { against: string[]; more: string[] }[] };

/** A fighter whose rolls always come up the same: to-hit `hit` (natural `nat`), defense `def`, damage `dmg`, saves `save`. */
export function fighter(o: { hp?: number; hit?: number; nat?: number; def?: number; dmg?: number; save?: number; side?: Allegiance } = {}, extra: Partial<Combatant> = {}): Fake {
  const attacks: Fake["attacks"] = [];
  return {
    hp: o.hp ?? 20,
    maxHp: o.hp ?? 20,
    statuses: [],
    allegiance: o.side ?? "hostile",
    attack: (_use, against, more = []) => {
      attacks.push({ against: (against?.statuses ?? []).map((s) => s.source), more: [...more] });
      const natural = o.nat ?? 10;
      return { total: o.hit ?? 15, text: "fixed", natural, crit: natural === 20, fumble: natural === 1 };
    },
    defense: () => ({ total: o.def ?? 12, text: "fixed" }),
    damage: (_use, crit) => ({ total: (o.dmg ?? 5) * (crit ? 2 : 1), text: "fixed" }),
    save: () => ({ total: o.save ?? 10, text: "fixed" }),
    ...extra,
    attacks,
  };
}

export const mover = (tokenId: number, start: Pos, plan: PlanStep[] = [], o: Partial<Mover> = {}): Mover => ({ tokenId, name: `T${tokenId}`, initiative: 20 - tokenId, start, plan, walking: 30, ...o });
export const move = (col: number, row: number, feet = 5): PlanStep => ({ kind: "move", to: { col, row }, feet });
export const act = (action: PlayerActionId, extra: Partial<Extract<PlanStep, { kind: "action" }>> = {}): PlanStep => ({ kind: "action", action, ...extra });
export const attack = (id: number, extra: Partial<Extract<PlanStep, { kind: "action" }>> = {}) => act("attack", { target: { id, name: `T${id}` }, ...extra });
export const gear = (g: Partial<GearAction> = {}): GearAction => ({ id: 100, name: "Strike", seconds: 2, range: 1, attack: "+0", damage: "1d6", roll: "normal", ...g });
export const wall = (x1: number, y1: number, x2: number, y2: number): Segment => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

export const condition = (id: number, name: string, modifiers: Modifier[], extra: Partial<Condition> = {}): Condition => ({
  id, name, description: "", rounds: 3, save_attr: "", save_dc: 12, effects: [{ id: id * 10, name, description: "", modifiers }], ...extra,
});

export function resolve(
  movers: Mover[],
  fighters: Record<number, Combatant>,
  o: { bystanders?: { tokenId: number; name: string; at: Pos }[]; walls?: Segment[]; lasting?: LastingArea[]; decisions?: Record<string, number>; afflictions?: Record<number, Affliction[]>; rollers?: number[]; gridless?: boolean; lit?: (p: Pos) => boolean; traps?: RoundTrap[]; triggers?: MapTrigger[] } = {},
) {
  const r = resolveMovement(
    movers, o.bystanders ?? [], o.walls ?? [], o.gridless ?? false,
    new Map(Object.entries(fighters).map(([k, v]) => [Number(k), v])),
    o.walls ?? [], o.lasting ?? [], o.decisions ?? {},
    new Map(Object.entries(o.afflictions ?? {}).map(([k, v]) => [Number(k), v])),
    new Set(o.rollers ?? []), new Set(), o.lit, o.traps, o.triggers,
  );
  return { ...r, text: r.log.join("\n"), at: (sec: number) => r.frames[sec - 1].lines.join("\n") };
}
