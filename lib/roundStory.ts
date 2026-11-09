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
  | { k: "attack"; who: number; target: number; with: string | null; outcome: "hit" | "miss" | "reach" | "gone"; hurt?: number; dmg?: number; resist?: "resistant" | "vulnerable" | "immune" } // hurt: share of their health; dmg: how much (told only to whoever took it)
  | { k: "area"; who: number; name: string }
  | { k: "ability"; who: number; name: string; target: number | null } // an ability that does no damage (on themselves, or on someone)
  | { k: "caught"; who: number; by: number | null; name: string; outcome: "hit" | "half" | "save"; hurt: number; dmg?: number }
  | { k: "down"; who: number }
  | { k: "chase"; who: number; target: number; action: string; why: "range" | "close" | "down" | "time"; next?: number } // next: who they turned on
  | { k: "status"; who: number; source: string }
  | { k: "healed"; who: number; source: string; much: number }
  | { k: "late"; who: number; action: string; heldBy?: number | null; target?: number | null }
  | { k: "afflicted"; who: number; name: string; by: number | null; aura?: boolean } // an effect (Poisoned…) put on them (aura: by `by`'s aura, while within it)
  | { k: "stopped"; who: number; action: string; target: number | null; why: string } // a condition stopped it (why: its name, or "spare": they can't attack whoever hypnotized them)
  | { k: "effect"; who: number; name: string; much: number; heal: boolean; hurt?: number } // an effect's round of damage or healing
  | { k: "temphp"; who: number; source: string; much: number } // temporary health granted
  | { k: "effectEnds"; who: number; name: string; why: "save" | "time" | "resisted" | "damage" | "attack" | "concentration" | "left" } // resisted: it never took hold; left: out of the aura giving it
);

/**
 * How bad a wound is, from the share of their health it took. Whoever took it also learns exactly how much
 * ("moderate (-4)"); whoever dealt it only sees how bad it looked.
 */
const taken = (hurt: number, dmg?: number) => `${severity(hurt)}${dmg ? ` (-${dmg})` : ""}`;
/** How bad a wound is, from the share of their health it took. */
export const severity = (hurt: number) => (hurt <= 0.15 ? "minor" : hurt <= 0.35 ? "moderate" : hurt <= 0.6 ? "serious" : "grievous");

const ACTION_WORD: Record<string, string> = { attack: "attack", use: "use your item", interact: "do it", disengage: "disengage", assist: "help", hide: "hide", ready: "get ready", search: "search", refit: "refit" };

/** Whether this event involves the token (they did it, or it was done to them). */
const involves = (e: StoryEvent, id: number) =>
  e.who === id || (e.k === "chase" && e.next === id) || (e.k !== "late" && e.k !== "skip" && "target" in e && e.target === id) || (e.k === "blocked" && (e.by === id || (e.intent && "target" in e.intent && e.intent.target === id))) || (e.k === "caught" && e.by === id) || (e.k === "afflicted" && e.by === id);

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
          add(e.sec, e.outcome === "hit" ? (e.resist === "immune" ? `You attack ${them}${weapon} and hit, but it does them no harm.` : `You attack ${them}${weapon} and hit, causing ${severity(e.hurt ?? 0)} damage.`)
            : e.outcome === "miss" ? `You attack ${them}${weapon} but miss.`
            : e.outcome === "reach" ? `You can't reach ${them} to attack.`
            : `${cap(them)} is already down.`);
        } else if (e.outcome === "hit" || e.outcome === "miss") {
          add(e.sec, e.outcome === "hit" ? (e.resist === "immune" ? `${subj} attacks you${weapon} and hits, but it does you no harm.` : `${subj} attacks you${weapon} and hits, causing ${taken(e.hurt ?? 0, e.dmg)} damage.`) : `${subj} attacks you${weapon} but misses.`);
        }
        break;
      }
      case "area": add(e.sec, `You use ${e.name}.`); break;
      case "ability": add(e.sec, mine ? (e.target === null ? `You use ${e.name}.` : e.target === me ? `You use ${e.name} on yourself.` : `You use ${e.name} on ${name(e.target)}.`) : `${subj} uses ${e.name} on you.`); break;
      case "healed": add(e.sec, e.much > 0 ? `You feel better (+${e.much}, ${e.source}).` : `${e.source} does you no more good: you're already well.`); break;
      case "caught": {
        if (e.who === me) {
          const from = e.by === null ? e.name : `${name(e.by)}'s ${e.name}`;
          add(e.sec, e.outcome === "save" ? `You're caught in ${from} but get clear unharmed.` : e.outcome === "half" ? `You're caught in ${from} and partly get clear, taking ${taken(e.hurt, e.dmg)} damage.` : `You're caught in ${from}, taking ${taken(e.hurt, e.dmg)} damage.`);
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
      case "stopped":
        if (mine) add(e.sec, e.why === "spare" ? `You can't bring yourself to ${deed(e.action)} ${e.target !== null ? name(e.target) : "them"}.` : `You're ${e.why.toLowerCase()} and can't ${deed(e.action)}.`);
        else if (e.why === "spare") add(e.sec, `${subj} can't bring themselves to ${deed(e.action)} you.`);
        break;
      case "afflicted":
        if (e.aura) add(e.sec, !mine ? `Your aura leaves ${name(e.who)} ${e.name.toLowerCase()}.` : e.by !== null && e.by !== me ? `Within ${name(e.by)}'s aura, you're ${e.name.toLowerCase()}.` : `Your own aura leaves you ${e.name.toLowerCase()}.`);
        else if (mine) add(e.sec, e.by !== null && e.by !== me ? `${cap(name(e.by))} leaves you ${e.name.toLowerCase()}.` : `You're ${e.name.toLowerCase()}.`);
        else add(e.sec, `You leave ${name(e.who)} ${e.name.toLowerCase()}.`);
        break;
      case "temphp": add(e.sec, `${e.source} steels you (+${e.much} temporary health).`); break;
      case "effect": add(e.sec, e.heal ? `${e.name} restores you (+${e.much}).` : `${e.name} hurts you (-${e.much}).`); break;
      case "effectEnds": add(e.sec, e.why === "concentration" ? `You're no longer ${e.name.toLowerCase()}: whoever held you lost their grip on it.` : e.why === "damage" ? `The pain shakes you out of being ${e.name.toLowerCase()}.` : e.why === "attack" ? `Attacking ends your being ${e.name.toLowerCase()}.` : e.why === "left" ? `Out of the aura, you're no longer ${e.name.toLowerCase()}.` : e.why === "resisted" ? `You resist being ${e.name.toLowerCase()}.` : e.why === "save" ? `You shake off ${e.name.toLowerCase()}.` : `You're no longer ${e.name.toLowerCase()}.`); break;
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

/**
 * The whole round for the GM, in the order it happened (not grouped by who): every actor's deeds and what befell
 * them, in the third person, with exact damage. One entry per second that had anything in it.
 */
export function gmStory(events: StoryEvent[] | undefined, name: (id: number) => string): { sec: number; lines: string[] }[] {
  const out = new Map<number, string[]>();
  const add = (sec: number, line: string) => out.set(sec, [...(out.get(sec) ?? []), line]);
  const n = (id: number | null | undefined) => (id === null || id === undefined ? "something" : name(id));
  const hurt = (h: number, dmg?: number) => `${severity(h)} damage${dmg ? ` (${dmg})` : ""}`;
  const does = (action: string) => (action.startsWith("use ") ? action : ACTION_WORD[action] === "use your item" ? "use their item" : ACTION_WORD[action] ?? action);
  for (const e of [...(events ?? [])].sort((a, b) => a.sec - b.sec)) {
    const who = n(e.who);
    switch (e.k) {
      case "close": add(e.sec, `${who} closes in on ${n(e.target)}${e.means ? ` to ${does(e.means)}` : ""}.`); break;
      case "blocked": {
        const i = e.intent;
        const why = !i || i.doing === "move" ? "" : i.doing === "close" ? ` closing in on ${n(i.target)}` : i.doing === "chase" ? ` chasing ${n(i.target)}` : ` getting away from ${n(i.target)}`;
        add(e.sec, `${who} is held up by ${n(e.by)}${why}.`);
        break;
      }
      case "skip": add(e.sec, `${who} holds position instead of moving on.`); break;
      case "dodge": add(e.sec, e.ok ? `${who} readies a dodge.` : `${who} fails to ready a dodge.`); break;
      case "refit": add(e.sec, `${who} ${e.from ? `swaps ${e.from} for ${e.to}` : `takes up ${e.to}`}.`); break;
      case "interrupted": add(e.sec, `${who} is thrown off by ${e.by ? `${n(e.by)}'s blow` : "a blow"} and can't ${does(e.action)}.`); break;
      case "attack": {
        const w = e.with ? ` with ${e.with}` : "", t = n(e.target);
        add(e.sec, e.outcome === "hit" ? `${who} hits ${t}${w}: ${e.resist === "immune" ? "no damage (immune)" : `${hurt(e.hurt ?? 0, e.dmg)}${e.resist ? ` (${e.resist})` : ""}`}.` : e.outcome === "miss" ? `${who} attacks ${t}${w} and misses.` : e.outcome === "reach" ? `${who} can't reach ${t}.` : `${who} finds ${t} already down.`);
        break;
      }
      case "area": add(e.sec, `${who} uses ${e.name}.`); break;
      case "ability": add(e.sec, `${who} uses ${e.name}${e.target === null ? "" : e.target === e.who ? " on themselves" : ` on ${n(e.target)}`}.`); break;
      case "caught": add(e.sec, `${e.by === null ? e.name : `${n(e.by)}'s ${e.name}`} catches ${who}: ${e.outcome === "save" ? "they get clear" : `${e.outcome === "half" ? "partly clear, " : ""}${hurt(e.hurt, e.dmg)}`}.`); break;
      case "down": add(e.sec, `${who} goes down.`); break;
      case "chase": {
        const v = e.action === "pursue" ? `chases ${n(e.target)}` : `keeps away from ${n(e.target)}`;
        add(e.sec, e.why === "range" && e.next !== undefined && e.next !== e.target ? `${who} ${v}, then turns on ${n(e.next)}.` : `${who} ${v}${e.why === "range" ? " until within reach" : e.why === "close" ? (e.action === "pursue" ? " and catches up" : " but is caught up with") : e.why === "down" ? " until they fall" : ""}.`);
        break;
      }
      case "status": add(e.sec, `${who} is affected by ${e.source}.`); break;
      case "healed": add(e.sec, e.much > 0 ? `${who} is healed for ${e.much} (${e.source}).` : `${who} gets nothing from ${e.source} (already well).`); break;
      case "stopped": add(e.sec, e.why === "spare" ? `${who} can't bring themselves to ${does(e.action)} ${n(e.target)}.` : `${who} is ${e.why.toLowerCase()} and can't ${does(e.action)}.`); break;
      case "afflicted": add(e.sec, `${who} is ${e.name.toLowerCase()}${e.by !== null && e.by !== e.who ? ` by ${n(e.by)}${e.aura ? "'s aura" : ""}` : ""}.`); break;
      case "temphp": add(e.sec, `${who} gains ${e.much} temporary health (${e.source}).`); break;
      case "effect": add(e.sec, e.heal ? `${e.name} heals ${who} for ${e.much}.` : `${e.name} deals ${who} ${e.much} damage.`); break;
      case "effectEnds": add(e.sec, e.why === "concentration" ? `${who} is no longer ${e.name.toLowerCase()} (concentration broken).` : e.why === "damage" || e.why === "attack" ? `${who} is no longer ${e.name.toLowerCase()} (${e.why === "damage" ? "hurt" : "attacked"}).` : e.why === "left" ? `${who} is out of the aura: no longer ${e.name.toLowerCase()}.` : e.why === "resisted" ? `${who} resists being ${e.name.toLowerCase()}.` : e.why === "save" ? `${who} shakes off ${e.name.toLowerCase()}.` : `${who}'s ${e.name.toLowerCase()} wears off.`); break;
      case "late": add(e.sec, `${who}${e.heldBy ? `, held up by ${n(e.heldBy)},` : ""} runs out of time to ${does(e.action)}${e.target ? ` ${e.target === e.who ? "themselves" : n(e.target)}` : ""}.`); break;
    }
  }
  return [...out].sort((a, b) => a[0] - b[0]).map(([sec, lines]) => ({ sec, lines }));
}
