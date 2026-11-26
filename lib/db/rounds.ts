import { db } from "@/lib/db/connection";
import type { PlanStep } from "@/lib/roundPlan";
import type { Replay } from "@/lib/resolveRound";

/** A round stopped mid-resolution for the GM to settle a contested move: its dice seed, the calls made so far, and
 * the contest waiting on them (see lib/resolveRound.ts). */
export interface PendingRound {
  seed: number;
  decisions: Record<string, number>;
  contest?: import("@/lib/resolveRound").Contest; // a contested move waiting on the GM's call
  save?: import("@/lib/resolveRound").SaveRequest; // or a player's save against a condition, waiting on their roll
  rolloff?: Record<number, number | null>; // a roll-off under way: each side's d20 (null = their player hasn't rolled yet)
}

export function getPendingRound(levelId: number): PendingRound | null {
  const row = db.prepare<[number], { pending: string | null }>("SELECT pending FROM encounters WHERE level_id = ?").get(levelId);
  return row?.pending ? JSON.parse(row.pending) : null;
}

export function setPendingRound(levelId: number, p: PendingRound | null): void {
  db.prepare<[string | null, number]>("UPDATE encounters SET pending = ? WHERE level_id = ?").run(p ? JSON.stringify(p) : null, levelId);
}

 // the player's dice for it: 0 not yet, 1 rolling, 2 rolled (plan set)

export function getRoundPlan(levelId: number, tokenId: number): { plan: PlanStep[]; ready: boolean; rolled: 0 | 1 | 2 } {
  const r = db.prepare<[number, number], { plan: string; ready: number; rolled: number }>("SELECT plan, ready, rolled FROM round_plans WHERE level_id = ? AND token_id = ?").get(levelId, tokenId);
  return { plan: r ? JSON.parse(r.plan) : [], ready: !!r?.ready, rolled: (r?.rolled ?? 0) as 0 | 1 | 2 };
}

/** Sets where a plan's dice are (0 not rolled, 1 rolling, 2 rolled), keeping the plan. */
export function setPlanRolled(levelId: number, tokenId: number, rolled: 0 | 1 | 2, plan?: PlanStep[]): void {
  db.prepare("INSERT INTO round_plans (level_id, token_id, plan, rolled) VALUES (?, ?, ?, ?) ON CONFLICT(level_id, token_id) DO UPDATE SET rolled = excluded.rolled" + (plan ? ", plan = excluded.plan" : "")).run(
    levelId, tokenId, JSON.stringify(plan ?? []), rolled
  );
}

/** Which tokens on the level are rolling their plan's dice right now. */
export function rollingTokens(levelId: number): Set<number> {
  return new Set(db.prepare<[number], { token_id: number }>("SELECT token_id FROM round_plans WHERE level_id = ? AND rolled = 1").all(levelId).map((r) => r.token_id));
}

export function saveRoundPlan(levelId: number, tokenId: number, plan: PlanStep[], ready: boolean): void {
  db.prepare("INSERT INTO round_plans (level_id, token_id, plan, ready) VALUES (?, ?, ?, ?) ON CONFLICT(level_id, token_id) DO UPDATE SET plan = excluded.plan, ready = excluded.ready").run(
    levelId, tokenId, JSON.stringify(plan), ready ? 1 : 0
  );
}

/** Which tokens on the level are ready with their round plan. */
export function readyTokens(levelId: number): Set<number> {
  return new Set(db.prepare<[number], { token_id: number }>("SELECT token_id FROM round_plans WHERE level_id = ? AND ready = 1").all(levelId).map((r) => r.token_id));
}

export function clearRoundPlans(levelId: number): void {
  db.prepare("DELETE FROM round_plans WHERE level_id = ?").run(levelId);
}

export function getLastRoundLog(levelId: number): string[] {
  const row = db.prepare<[number], { last_log: string }>("SELECT last_log FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.last_log) : [];
}

export function setLastRoundLog(levelId: number, lines: string[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET last_log = ? WHERE level_id = ?").run(JSON.stringify(lines), levelId);
}

export function getReplay(levelId: number): Replay | null {
  const row = db.prepare<[number], { replay: string | null }>("SELECT replay FROM encounters WHERE level_id = ?").get(levelId);
  return row?.replay ? JSON.parse(row.replay) : null;
}

export function setReplay(levelId: number, replay: Replay, log?: string[]): void {
  db.prepare<[string, number]>("UPDATE encounters SET replay = ? WHERE level_id = ?").run(JSON.stringify(replay), levelId);
  // Kept for the rest of the encounter, so players can look back over every round they've had.
  const stories = [...getRoundStories(levelId).filter((r) => r.round !== replay.round), { round: replay.round, showAt: replay.starts + (replay.frames.length + 1) * 1000, story: replay.story ?? [], ...(log ? { log } : {}) }];
  db.prepare<[string, number]>("UPDATE encounters SET stories = ? WHERE level_id = ?").run(JSON.stringify(stories), levelId);
}

/** A resolved round's events (raw: each player is only ever told their own part), and when its playback ends. */
export interface RoundStory {
  round: number;
  showAt: number; // ms since epoch: the playback's end (players hear about it then)
  story: import("@/lib/roundStory").StoryEvent[];
  log?: string[]; // the GM's log of the round, with the numbers (never sent to players)
}

export function getRoundStories(levelId: number): RoundStory[] {
  const row = db.prepare<[number], { stories: string }>("SELECT stories FROM encounters WHERE level_id = ?").get(levelId);
  return row ? JSON.parse(row.stories) : [];
}

/** Planned targeted steps on a level (who aims what at whom), for drawing on the map; optionally one token's only. */
export type PlanTarget = { from: number; to: number; action: string; label: string; at: { col: number; row: number } | null };

 // at: where they'll be (null: where they stand)
export function listPlanTargets(levelId: number, tokenId?: number): PlanTarget[] {
  const rows = db.prepare<[number], { token_id: number; plan: string }>("SELECT token_id, plan FROM round_plans WHERE level_id = ?").all(levelId);
  return rows
    .filter((r) => tokenId === undefined || r.token_id === tokenId)
    .flatMap((r) => {
      // Each aimed step from where the moves before it leave them (so a move, attack, move plan aims from the middle).
      let at: { col: number; row: number } | null = null;
      return (JSON.parse(r.plan) as PlanStep[]).flatMap((s) => {
        if (s.kind === "move") {
          at = s.to;
          return [];
        }
        const label = s.use?.name ?? s.action;
        const to = s.picks?.length ? s.picks.map((p) => p.id) : s.target ? [s.target.id] : [];
        return to.map((id) => ({ from: r.token_id, to: id, action: s.action, label, at }));
      });
    });
}

/** Each plan's moves as a trail of waypoints (in order), for drawing the route it takes. */
export function listPlanRoutes(levelId: number, tokenId?: number): { token: number; points: { col: number; row: number; step?: number }[] }[] {
  const rows = db.prepare<[number], { token_id: number; plan: string }>("SELECT token_id, plan FROM round_plans WHERE level_id = ?").all(levelId);
  return rows
    .filter((r) => tokenId === undefined || r.token_id === tokenId)
    .map((r) => ({ token: r.token_id, points: (JSON.parse(r.plan) as PlanStep[]).flatMap((s, step) => (s.kind === "move" ? [{ ...s.to, step }] : [])) })) // step: which plan step it ends (dragging it changes that move)
    .filter((r) => r.points.length);
}
