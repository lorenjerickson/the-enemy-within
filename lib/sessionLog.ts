import { formatGameTime, formatSpan } from "./calendar";
import {
  endGameSession, getGameSession, getGameTime, getOpenGameSession, getVars, listCharacterStates, listSessionEvents, listTimers,
  startGameSession, type VarValue,
} from "./db";
import { discoveryRecipients, listDiscoveries, listObjectives } from "./story";

/**
 * Session summaries: the game state is snapshotted when a session starts and compared with the state when it
 * ends; that, with the events logged along the way (triggers going off), is the summary of what happened.
 */

interface Snapshot {
  time: number;
  characters: { id: number; name: string; hp: number | null; conditions: string[] }[];
  vars: Record<string, VarValue>;
  timers: { name: string; started: number; duration: number | null }[];
  objectives: { id: number; title: string; status: string; revealed: number }[];
  discoveries: { id: number; title: string; to: number[] }[];
}

function snapshot(): Snapshot {
  return {
    time: getGameTime(),
    characters: listCharacterStates().map((c) => ({ id: c.id, name: c.name, hp: c.hp, conditions: c.conditions })),
    vars: getVars(),
    timers: listTimers(),
    objectives: listObjectives().map((o) => ({ id: o.id, title: o.title, status: o.status, revealed: o.revealed })),
    discoveries: listDiscoveries().map((d) => ({ id: d.id, title: d.title, to: discoveryRecipients(d.id) })),
  };
}

/** A summary: headed sections of lines. */
export type Summary = { heading: string; lines: string[] }[];

function summarize(before: Snapshot, after: Snapshot, events: { game_time: number; text: string }[]): Summary {
  const name = (id: number) => after.characters.find((c) => c.id === id)?.name ?? before.characters.find((c) => c.id === id)?.name ?? "someone";
  const list = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  const sections: Summary = [];
  const add = (heading: string, lines: string[]) => lines.length && sections.push({ heading, lines });

  add("Time", [
    after.time > before.time
      ? `${formatGameTime(before.time)} to ${formatGameTime(after.time)} (${formatSpan(after.time - before.time)} of game time).`
      : `No game time passed (${formatGameTime(after.time)}).`,
  ]);

  add("Discoveries", after.discoveries.flatMap((d) => {
    const had = new Set(before.discoveries.find((b) => b.id === d.id)?.to ?? []);
    const told = d.to.filter((c) => !had.has(c));
    return told.length ? [`${d.title}: revealed to ${list(told.map(name))}.`] : [];
  }));

  add("Objectives", after.objectives.flatMap((o) => {
    const b = before.objectives.find((x) => x.id === o.id);
    const lines: string[] = [];
    if (!b) lines.push(`${o.title}: new${o.revealed ? ", and revealed" : " (not yet revealed)"}.`);
    else if (o.revealed && !b.revealed) lines.push(`${o.title}: revealed.`);
    if (o.status !== (b?.status ?? "open")) lines.push(`${o.title}: ${o.status}.`);
    return lines;
  }));

  add("Characters", after.characters.flatMap((c) => {
    const b = before.characters.find((x) => x.id === c.id);
    if (!b) return [];
    const lines: string[] = [];
    if (b.hp !== null && c.hp !== null && b.hp !== c.hp) {
      lines.push(c.hp <= 0 && b.hp > 0 ? `${c.name} fell (health ${b.hp} to ${c.hp}).` : `${c.name}: health ${b.hp} to ${c.hp}.`);
    }
    const gained = c.conditions.filter((x) => !b.conditions.includes(x));
    const lost = b.conditions.filter((x) => !c.conditions.includes(x));
    if (gained.length) lines.push(`${c.name} is now ${list(gained)}.`);
    if (lost.length) lines.push(`${c.name} is no longer ${list(lost)}.`);
    return lines;
  }));

  add("Timers", [
    ...after.timers.flatMap((t) => {
      const b = before.timers.find((x) => x.name === t.name);
      const lines: string[] = [];
      const restarted = !b || b.started !== t.started;
      if (restarted) lines.push(`${t.name}: started ${formatGameTime(t.started)}.`);
      const expiredBefore = !restarted && b.duration !== null && before.time - b.started >= b.duration;
      if (t.duration !== null && after.time - t.started >= t.duration && !expiredBefore) lines.push(`${t.name}: ran out.`);
      return lines;
    }),
    ...before.timers.filter((b) => !after.timers.some((t) => t.name === b.name)).map((b) => `${b.name}: stopped.`),
  ]);

  add("Triggers", events.map((e) => `${formatGameTime(e.game_time)}: ${e.text}`));

  add("Flags (game.vars)", Object.entries(after.vars).flatMap(([k, v]) => (before.vars[k] === v ? [] : [`${k}: ${JSON.stringify(before.vars[k] ?? null)} to ${JSON.stringify(v)}.`])));

  return sections;
}

/** Starts a new session, ending the running one first (which writes its summary). Returns the new session's id. */
export function startSession(): number {
  const open = getOpenGameSession();
  if (open) endSession(open.id);
  return startGameSession(JSON.stringify(snapshot()));
}

/** Ends a session and writes its summary from what changed since it started. */
export function endSession(id: number): void {
  const s = getGameSession(id);
  if (!s || s.ended_at) return;
  const summary: Summary = s.start_state
    ? summarize(JSON.parse(s.start_state), snapshot(), listSessionEvents(id))
    : [{ heading: "Not recorded", lines: ["This session started before sessions were logged."] }];
  endGameSession(id, JSON.stringify(summary));
}
