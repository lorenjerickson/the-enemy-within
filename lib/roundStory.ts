/**
 * What happened in a round, as events, told back to each player as a short story of their own part in it: what
 * they did and what was done to them, with no numbers (no rolls, damage figures or defenses) and nothing about
 * anyone they didn't deal with.
 */
/** What someone was evidently doing when something got in their way (as anyone watching could tell). */
export type Intent = { doing: "chase" | "evade"; target: number } | { doing: "close"; target: number; means: string } | { doing: "move" };

export type StoryEvent = { sec: number } & (
  | { k: "close"; who: number; target: number; means?: string } // means: "attack", "use Bite"…
  | { k: "blocked"; who: number; by: number | null; intent?: Intent }
  | { k: "skip"; who: number; after?: "close" | "chase" | "evade"; target?: number | null }
  | { k: "dodge"; who: number; ok: boolean }
  | { k: "refit"; who: number; from: string | null; to: string }
  | { k: "interrupted"; who: number; action: string; by?: number | null }
  | { k: "attack"; who: number; target: number; with: string | null; outcome: "hit" | "miss" | "reach" | "gone"; hurt?: number } // hurt: share of their health
  | { k: "area"; who: number; name: string }
  | { k: "ability"; who: number; name: string; target: number | null } // an ability that does no damage (on themselves, or on someone)
  | { k: "caught"; who: number; by: number | null; name: string; outcome: "hit" | "half" | "save"; hurt: number }
  | { k: "down"; who: number }
  | { k: "chase"; who: number; target: number; action: string; why: "range" | "close" | "down" | "time"; next?: number } // next: who they turned on
  | { k: "status"; who: number; source: string }
  | { k: "healed"; who: number; source: string; much: number }
  | { k: "late"; who: number; action: string; heldBy?: number | null; target?: number | null }
);

/** How bad a wound is, from the share of their health it took. */
export const severity = (hurt: number) => (hurt <= 0.15 ? "minor" : hurt <= 0.35 ? "moderate" : hurt <= 0.6 ? "serious" : "grievous");

const ACTION_WORD: Record<string, string> = { attack: "attack", use: "use your item", interact: "do it", disengage: "disengage", assist: "help", hide: "hide", ready: "get ready", search: "search", refit: "refit" };

/** Whether this event involves the token (they did it, or it was done to them). */
const involves = (e: StoryEvent, id: number) =>
  e.who === id || (e.k === "chase" && e.next === id) || (e.k !== "late" && e.k !== "skip" && "target" in e && e.target === id) || (e.k === "blocked" && (e.by === id || (e.intent && "target" in e.intent && e.intent.target === id))) || (e.k === "caught" && e.by === id);

/** "attack", "use Bite", "search"… as something to do. */
const deed = (action: string) => (action.startsWith("use ") ? action : ACTION_WORD[action] ?? action);

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
      case "close": {
        const means = e.means ? `, meaning to ${deed(e.means)}` : "";
        add(e.sec, mine ? `You close in on ${name(e.target)}${e.means ? ` to ${deed(e.means)} them` : ""}.` : `${subj} closes in on you${means}.`);
        break;
      }
      case "blocked": {
        // Who was held up, by whom, and what they were evidently trying to do (as seen from each side).
        const i = e.intent, them = (id: number) => (id === me ? "you" : name(id));
        const purpose = (subject: "you" | "they") =>
          !i || i.doing === "move" ? "" : i.doing === "close" ? ` as ${subject} close in on ${them(i.target)} to ${deed(i.means)}` :
          i.doing === "chase" ? ` as ${subject} chase ${them(i.target)}` :
          ` as ${subject} try to get away from ${them(i.target)}`;
        if (mine) add(e.sec, e.by === null ? `Something blocks your way${purpose("you")}, holding you up.` : `${cap(name(e.by))} gets in your way${purpose("you")}, holding you up.`);
        else if (e.by === me) add(e.sec, i && i.doing !== "move" && i.target === me ? `You block ${name(e.who)} as they come at you, holding them up.` : `You get in ${name(e.who)}'s way${purpose("they")}, holding them up.`);
        else add(e.sec, i?.doing === "evade" ? `${cap(name(e.by ?? -1))} cuts off ${name(e.who)} as they try to get away from you.` : `${cap(e.by === null ? "something" : name(e.by))} gets in ${name(e.who)}'s way as they come after you, holding them up.`);
        break;
      }
      case "skip": {
        const them = e.target ? name(e.target) : "them";
        add(e.sec, e.after === "close" ? `Having closed in on ${them}, you hold your ground rather than move on as planned.`
          : e.after === "chase" ? `You stay where chasing ${them} left you, instead of moving on as planned.`
          : e.after === "evade" ? `You stay where getting away from ${them} left you, instead of moving on as planned.`
          : "You hold your ground instead of moving on.");
        break;
      }
      case "dodge": add(e.sec, e.ok ? "You get ready to dodge." : "You try to get ready to dodge, but you're not quick enough."); break;
      case "refit": add(e.sec, e.from ? `You put away ${e.from} and take up ${e.to}.` : `You take up ${e.to}.`); break;
      case "interrupted": add(e.sec, `${e.by ? `${cap(name(e.by))}'s blow` : "The blow"} throws you off, and you can't ${deed(e.action)}.`); break;
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
      case "ability": add(e.sec, mine ? (e.target === null ? `You use ${e.name}.` : e.target === me ? `You use ${e.name} on yourself.` : `You use ${e.name} on ${name(e.target)}.`) : `${subj} uses ${e.name} on you.`); break;
      case "healed": add(e.sec, e.much > 0 ? `You feel better (${e.source}).` : `${e.source} does you no more good: you're already well.`); break;
      case "caught": {
        if (e.who === me) {
          const from = e.by === null ? e.name : `${name(e.by)}'s ${e.name}`;
          add(e.sec, e.outcome === "save" ? `You're caught in ${from} but get clear unharmed.` : e.outcome === "half" ? `You're caught in ${from} and partly get clear, taking ${severity(e.hurt)} damage.` : `You're caught in ${from}, taking ${severity(e.hurt)} damage.`);
        } else add(e.sec, `Your ${e.name} catches ${name(e.who)}${e.outcome === "save" ? ", who gets clear" : `, causing ${severity(e.hurt)} damage`}.`);
        break;
      }
      case "down": add(e.sec, mine ? "You fall." : `${subj} falls.`); break;
      case "chase": {
        const them = name(e.target), turned = e.why === "range" && e.next !== undefined && e.next !== e.target;
        if (mine) {
          const verb = e.action === "pursue" ? `You chase ${them}` : `You keep away from ${them}`;
          add(e.sec, turned ? `${verb}, then turn on ${e.next === me ? "yourself" : name(e.next!)} as they come within reach.`
            : e.why === "range" ? `${verb} until they're within reach.`
            : e.why === "close" ? `${verb}, ${e.action === "pursue" ? "catching up with them" : "but they catch up with you"}.`
            : e.why === "down" ? `${verb} until they fall.` : `${verb} for a while.`);
        } else if (e.target === me) {
          add(e.sec, turned ? `${subj} breaks off coming after you and turns on ${e.next === me ? "you" : name(e.next!)}.`
            : e.action === "pursue" ? (e.why === "close" || e.why === "range" ? `${subj} comes after you and catches up.` : `${subj} comes after you.`)
            : `${subj} keeps away from you.`);
        } else if (e.next === me) add(e.sec, `${subj} breaks off ${e.action === "pursue" ? "chasing" : "keeping away from"} ${them} and turns on you.`);
        break;
      }
      case "status": add(e.sec, `You're affected by ${e.source}.`); break;
      case "late": add(e.sec, `${e.heldBy ? `Held up by ${name(e.heldBy)}, you` : "You"} run out of time to ${deed(e.action)}${e.target ? `${e.action.startsWith("use ") ? " on" : ""} ${e.target === me ? "yourself" : name(e.target)}` : ""}.`); break;
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
