/**
 * What happened in a round, as events, told back to each player as a short story of their own part in it: what
 * they did and what was done to them, with no numbers (no rolls, damage figures or defenses) and nothing about
 * anyone they didn't deal with.
 */
export type StoryEvent = { sec: number } & (
  | { k: "close"; who: number; target: number }
  | { k: "blocked"; who: number; by: number | null }
  | { k: "skip"; who: number }
  | { k: "dodge"; who: number; ok: boolean }
  | { k: "refit"; who: number; from: string | null; to: string }
  | { k: "interrupted"; who: number; action: string }
  | { k: "attack"; who: number; target: number; with: string | null; outcome: "hit" | "miss" | "reach" | "gone"; hurt?: number } // hurt: share of their health
  | { k: "area"; who: number; name: string }
  | { k: "caught"; who: number; by: number | null; name: string; outcome: "hit" | "half" | "save"; hurt: number }
  | { k: "down"; who: number }
  | { k: "chase"; who: number; target: number; action: string; why: "range" | "close" | "down" | "time" }
  | { k: "status"; who: number; source: string }
  | { k: "late"; who: number; action: string }
);

/** How bad a wound is, from the share of their health it took. */
export const severity = (hurt: number) => (hurt <= 0.15 ? "minor" : hurt <= 0.35 ? "moderate" : hurt <= 0.6 ? "serious" : "grievous");

const ACTION_WORD: Record<string, string> = { attack: "attack", use: "use your item", interact: "do it", disengage: "disengage", assist: "help", hide: "hide", ready: "get ready", search: "search", refit: "refit" };

/** Whether this event involves the token (they did it, or it was done to them). */
const involves = (e: StoryEvent, id: number) =>
  e.who === id || ("target" in e && e.target === id) || (e.k === "blocked" && e.by === id) || (e.k === "caught" && e.by === id);

/**
 * The round as `me` lived it, one line per thing, in second person ("You close with Giant Rat 1."), keyed by the
 * second it happened in. `name` gives what the player calls the others.
 */
export function storyFor(events: StoryEvent[], me: number, name: (id: number) => string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (sec: number, line: string) => out.set(sec, [...(out.get(sec) ?? []), line]);
  const who = (id: number | null) => (id === me ? "you" : id === null ? "something" : name(id));
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  for (const e of events) {
    if (!involves(e, me)) continue;
    const mine = e.who === me, subj = cap(who(e.who));
    switch (e.k) {
      case "close": add(e.sec, mine ? `You close in on ${name(e.target)}.` : `${subj} closes in on you.`); break;
      case "blocked": add(e.sec, mine ? `${cap(who(e.by))} is in your way.` : `You stand in ${name(e.who)}'s way.`); break;
      case "skip": add(e.sec, "You hold your ground instead of moving on."); break;
      case "dodge": add(e.sec, e.ok ? "You get ready to dodge." : "You try to get ready to dodge, but you're not quick enough."); break;
      case "refit": add(e.sec, e.from ? `You put away ${e.from} and take up ${e.to}.` : `You take up ${e.to}.`); break;
      case "interrupted": add(e.sec, `The blow throws you off and you can't ${ACTION_WORD[e.action] ?? e.action}.`); break;
      case "attack": {
        const weapon = e.with ? ` with ${e.with}` : "";
        if (mine) {
          const them = name(e.target);
          add(e.sec, e.outcome === "hit" ? `You attack ${them}${weapon} and hit, causing ${severity(e.hurt ?? 0)} damage.`
            : e.outcome === "miss" ? `You attack ${them}${weapon} but miss.`
            : e.outcome === "reach" ? `You can't reach ${them} to attack.`
            : `${cap(them)} is already down.`);
        } else if (e.outcome === "hit" || e.outcome === "miss") {
          add(e.sec, e.outcome === "hit" ? `${subj} attacks you${weapon} and hits, causing ${severity(e.hurt ?? 0)} damage.` : `${subj} attacks you${weapon} but misses.`);
        }
        break;
      }
      case "area": add(e.sec, `You use ${e.name}.`); break;
      case "caught": {
        if (e.who === me) {
          const from = e.by === null ? e.name : `${name(e.by)}'s ${e.name}`;
          add(e.sec, e.outcome === "save" ? `You're caught in ${from} but get clear unharmed.` : e.outcome === "half" ? `You're caught in ${from} and partly get clear, taking ${severity(e.hurt)} damage.` : `You're caught in ${from}, taking ${severity(e.hurt)} damage.`);
        } else add(e.sec, `Your ${e.name} catches ${name(e.who)}${e.outcome === "save" ? ", who gets clear" : `, causing ${severity(e.hurt)} damage`}.`);
        break;
      }
      case "down": add(e.sec, mine ? "You fall." : `${subj} falls.`); break;
      case "chase": {
        const them = name(e.target);
        if (mine) {
          const verb = e.action === "pursue" ? `You chase ${them}` : `You keep away from ${them}`;
          add(e.sec, e.why === "range" ? `${verb} until they're in range.` : e.why === "close" ? `${verb}, ${e.action === "pursue" ? "catching up with them" : "but they catch up with you"}.` : e.why === "down" ? `${verb} until they fall.` : `${verb} for a while.`);
        } else add(e.sec, e.action === "pursue" ? `${subj} comes after you.` : `${subj} keeps away from you.`);
        break;
      }
      case "status": add(e.sec, `You're affected by ${e.source}.`); break;
      case "late": add(e.sec, `You run out of time to ${ACTION_WORD[e.action] ?? e.action}.`); break;
    }
  }
  return out;
}

/** A player's own story of a round, by second, across their characters' tokens (lines in time order). */
export function playerStory(events: StoryEvent[] | undefined, tokens: number[], name: (id: number) => string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const t of tokens) for (const [sec, lines] of storyFor(events ?? [], t, name)) out.set(sec, [...(out.get(sec) ?? []), ...lines]);
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}
