import type { AreaHit, AttackFx, Fx } from "@/lib/vfx";
import { caughtBy, describeArea, placeArea, type AreaAt, type AreaFires, type LastingArea } from "@/lib/aoe";
import { rollDice, usingDice } from "@/lib/dice";
import { critImmune, describeStatus, type Status } from "@/lib/status";
/** "critical " (or a critical against someone immune to them: a normal hit), for the log. */
const critNote = (rolled: boolean | undefined, counts: boolean) => (!rolled ? "" : counts ? "critically " : "(a critical, but they're immune: a normal hit) ");
import { afterResist, combineResist, describeCondition, extrasOf, lingers, modifiersOf, reapplied, noRestrictions, resistsOf, restrictionsOf, rollChanges, type Affliction, type Condition, type Extra, type Trigger, type Senses, BLIND_RANGE, seesThem, sensesFrom, type Resist, type Restrictions } from "@/lib/conditions";
import type { Attribute } from "@/lib/attributes";
import type { RollMode } from "@/lib/actions";
import { FEET_PER_SQUARE, clearPath, crosses, reachableSquares, routeTo, shortestPath, squareKey } from "@/lib/movement";
import { ACTION_RANGE, CHASE_ACTIONS, REACTIONS } from "@/lib/playerActions";
import { DODGE_DC, ROUND_SECONDS, stepKind, timeline, type GearAction, type PlanStep, type Refit } from "@/lib/roundPlan";

/** How close a planned action needs its target: a gear action's own range, else the action's (attack = within reach). */
/** How far an action reaches (squares): a gear action's own range, a plain Attack the mover's weapon's. */
const rangeOf = (step: Extract<PlanStep, { kind: "action" }>, m?: Mover) =>
  step.use?.range ?? (step.action === "attack" && m?.attackRange ? m.attackRange : ACTION_RANGE[step.action]);
import type { Segment } from "@/lib/visibility";
import type { EquipSlot } from "@/lib/itemTypes";
import type { Intent, StoryEvent } from "@/lib/roundStory";
import { fits, relation, type Allegiance } from "@/lib/sides";
import { auraAffliction, auraWants, syncAuras, type AuraModifier } from "@/lib/auras";

type Pos = { col: number; row: number };

/** Someone (or something) taking part in the round. */
/** Two creatures ended a second in the same spot and the GM hasn't said who gets it: resolving stops here. */
export interface Contest {
  sec: number;
  key: string; // "lowId:highId@col,row", for the GM's decision (it holds for the rest of the round)
  a: { id: number; name: string; from: Pos }; // `from`: where they were at the start of that second
  b: { id: number; name: string; from: Pos };
  spot: Pos;
}
/** A player's character must save against a condition landing on it mid-round: resolving waits for their roll. */
export interface SaveRequest {
  sec: number;
  key: string; // "save:sec:conditionId:tokenId", where their roll's total is kept among the decisions
  tokenId: number;
  name: string; // their character's name
  condition: string;
  attr: Attribute;
  dc: number;
}
export class SaveNeeded extends Error {
  constructor(public save: SaveRequest) {
    super(`Save needed at ${save.sec} s`);
  }
}

export class ContestedMove extends Error {
  constructor(public contest: Contest) {
    super(`Contested move at ${contest.sec} s`);
  }
}

export interface Mover {
  tokenId: number;
  name: string;
  initiative: number; // tie breaker only; not rolled yet = lowest
  start: Pos;
  plan: PlanStep[];
  walking: number; // feet per round
  attackRange?: number; // squares a plain Attack reaches (their main-hand weapon's range); 1 = within reach
  equipment?: Partial<Record<EquipSlot, number | null>>; // what they wear (refits change it mid-round)
}

/** Where a plan puts a mover at time t (seconds into the round), ignoring everyone else. */
function planner(m: Mover, walls: Segment[], gridless: boolean): (t: number) => Pos {
  const legs: { start: number; end: number; points: Pos[] }[] = [];
  let at = m.start;
  for (const s of timeline(m.plan, m.walking).steps) {
    if (s.step.kind !== "move") continue;
    const to = s.step.to;
    let points: Pos[];
    if (gridless) points = [at, to];
    else {
      const reach = reachableSquares(at, s.step.feet / FEET_PER_SQUARE, walls);
      points = reach.has(squareKey(to.col, to.row)) ? routeTo(reach, squareKey(to.col, to.row)) : [at, to];
    }
    legs.push({ start: s.start, end: s.end, points });
    at = to;
  }
  return (t) => {
    let pos = m.start;
    for (const leg of legs) {
      if (t <= leg.start) break;
      const f = Math.min(1, (t - leg.start) / Math.max(1e-9, leg.end - leg.start));
      if (gridless) {
        const [a, b] = leg.points;
        pos = { col: Math.round((a.col + (b.col - a.col) * f) * 20) / 20, row: Math.round((a.row + (b.row - a.row) * f) * 20) / 20 };
      } else {
        pos = leg.points[Math.floor(f * (leg.points.length - 1) + 1e-9)];
      }
    }
    return pos;
  };
}

/** One second of a resolved round, for playback. */
export interface ReplayFrame {
  sec: number;
  pos: Record<number, Pos>;
  down: number[];
  lines: string[];
  fx?: Fx[]; // attacks landing (or missing) this second, for the map to draw
}

/** A resolved round to play back: frames shown one a second from `starts` (ms since epoch). */
export interface Replay {
  round: number;
  starts: number;
  start: Record<number, Pos>; // where everyone was before the round
  startDown?: number[]; // who was already down before it
  story?: StoryEvent[]; // what happened, for telling each player their part (stripped before it reaches a browser)
  frames: ReplayFrame[];
}

/** What resolving needs to settle an attack (see lib/combat.ts for the rules). */
export interface Combatant {
  hp: number;
  attack: (use?: GearAction, against?: Combatant, more?: RollMode[]) => { total: number; text: string; natural?: number; crit?: boolean; fumble?: boolean }; // crit: a critical hit; fumble: a natural 1
  statuses?: Status[]; // what actions left on them; a status added this round counts straight away
  defense: () => { total: number; text: string };
  damage: (use?: GearAction, crit?: boolean) => { total: number; text: string }; // crit: the damage dice twice
  save?: (attr: Attribute) => { total: number; text: string };
  wear?: (equipment: Partial<Record<EquipSlot, number | null>>) => void; // after a refit
  maxHp?: number; // for how bad a wound sounds in the players' story
  allegiance?: Allegiance; // whose side they're on (actions aimed at friendlies or enemies)
  resist?: Record<string, Resist[]>; // how they take each kind of damage, by type (conditions put on mid-round add to it)
  extras?: { dealing: Extra[]; taking: Extra[] }; // extra damage on their hits, and on hits against them
  limits?: Restrictions; // what conditions stop them doing (a condition put on mid-round counts from then on)
  auras?: AuraModifier[]; // auras they give off of their own (or from what they wear); those from conditions on them come with the conditions
  triggers?: { mod: Trigger; name: string }[]; // triggers of their own (or from what they wear), with the effect's name; those from conditions come with them
  senses?: Senses; // their own senses (and their gear's); conditions on them add to these as the round goes
  attrMod?: (a: Attribute) => number; // an attribute's modifier now (for amounts like "your Fortitude modifier")
}

/**
 * Resolves a round second by second. Movement: evaluation (each mover's proposed spot at the end of the second),
 * reconciliation (in initiative order, nobody ends a second where someone already is; the loser is held back a
 * second), result (positions applied). Then actions finishing that second, in initiative order: an attack hits if
 * its target is still in reach (1 square) and the roll beats their defense; an attacker hit while their action is
 * under way loses it; anyone down (0 health) does nothing more. Other actions only log for now.
 * Returns final spots, health and a log.
 */
export function resolveMovement(
  movers: Mover[],
  bystanders: { tokenId: number; name: string; at: Pos }[],
  walls: Segment[],
  gridless: boolean,
  fighters: Map<number, Combatant> = new Map(),
  effectWalls: Segment[] = walls, // what stops an area (walls, closed doors; not windows)
  lasting: LastingArea[] = [], // areas already on the map: whoever is in one at the end of the round rolls its save
  decisions: Record<string, number> = {}, // the GM's calls on contested moves: "lowId:highId@col,row" → who gets the spot
  afflictions: Map<number, Affliction[]> = new Map(), // conditions on anyone (Poisoned…): ticked at the end of the round
  rollers: Set<number> = new Set(), // players' characters: they roll their own saves (kept in `decisions` as "save:…")
  auraPasses: Set<string> = new Set(), // who passed the save against an aura's condition ("token:condition"): safe until they leave it
  lit: (p: Pos) => boolean = () => true, // whether a spot is lit (light sources, the level's overall light): in the dark, only darkvision sees
) {
  const passes = new Set(auraPasses);
  const refits: { tokenId: number; equipment: Partial<Record<EquipSlot, number | null>>; before: Partial<Record<EquipSlot, number | null>>; swap: Refit }[] = []; // refits done, to keep
  const created: (Omit<LastingArea, "id" | "ends"> & { minutes: number })[] = []; // lasting areas this round's actions leave behind
  const statuses: { tokenId: number; status: Status; minutes: number }[] = []; // statuses this round's actions leave
  const story: StoryEvent[] = []; // the round as events, for each player's own account of it
  const hurt = (id: number, dmg: number) => dmg / Math.max(1, fighters.get(id)?.maxHp ?? hp.get(id) ?? 1);
  /** Damage of a type as someone takes it (resistant: half, vulnerable: double, immune: none), and a note for the log. */
  const takenBy = (id: number, amount: number, type: string | undefined) => {
    const r = type ? combineResist(fighters.get(id)?.resist?.[type]) : null;
    const n = afterResist(amount, r);
    return { n, r, note: r ? ` (${r === "immune" ? "immune" : `${r}: ${n} of ${amount}`})` : "" };
  };
  /** Extra damage a hit carries: the attacker's on-hit extras, and the target's (from this attacker, or anyone); each as the target takes it. */
  const bonusOnHit = (attacker: number, target: number) => {
    const x = [...(fighters.get(attacker)?.extras?.dealing ?? []), ...(fighters.get(target)?.extras?.taking ?? []).filter((e) => e.from == null || e.from === attacker)];
    let n = 0;
    const parts: string[] = [];
    for (const e of x) {
      const t = takenBy(target, Math.max(0, rollDice(e.value)), e.damage_type || undefined);
      n += t.n;
      parts.push(`+${t.n}${e.damage_type ? ` ${e.damage_type}` : ""} (${e.name})${t.note}`);
    }
    return { n, note: parts.length ? ` ${parts.join(" ")}` : "" };
  };
  const nameOf = (id: number) => order.find((o) => o.tokenId === id)?.name ?? bystanders.find((b) => b.tokenId === id)?.name ?? "someone";
  // Effects on everyone (Poisoned…), as the round goes: put on (again: its rounds start over), ticked at the end.
  const afflicted = new Map([...afflictions].map(([id, list]) => [id, list.map((a) => ({ ...a }))]));
  const temps = new Map<number, number>(); // temporary health granted this round (given after it, the highest)
  const strains: { tokenId: number; attribute: Attribute; points: number }[] = []; // strain put on (or taken off) this round, kept after it
  /** A save against something landing on them: a player rolls their own (the round waits for it), the server rolls for the GM's creatures. */
  const asked = new Map<string, number>(); // how many times each save key has come up this round (the same save twice gets "#2"…)
  const saveRoll = (id: number, attr: Attribute, dc: number, base: string, what: string, sec: number): { total: number; text: string } => {
    if (fighters.get(id)?.limits?.autofail.includes(attr)) return { total: -99, text: "fails automatically" }; // nothing to roll
    if (rollers.has(id)) {
      const n = (asked.get(base) ?? 0) + 1;
      asked.set(base, n);
      const key = n === 1 ? base : `${base}#${n}`;
      if (decisions[key] === undefined) throw new SaveNeeded({ sec, key, tokenId: id, name: nameOf(id), condition: what, attr, dc });
      return { total: decisions[key], text: "their roll" };
    }
    return fighters.get(id)?.save?.(attr) ?? { total: 0, text: "no save" };
  };
  const saveAgainst = (id: number, attr: Attribute, dc: number, key: string, what: string, sec: number): number => saveRoll(id, attr, dc, key, what, sec).total;
  /** A save to end a condition, rolled by its player (the round waits) or the server. */
  const endRoll: SaveRoll = (id, attr, dc, what, sec) => saveRoll(id, attr, dc, `end:${sec}:${what}:${id}`, `${what} (to shake it off)`, sec);
  /** Puts a condition on someone mid-round (`aura`: from that creature's aura, while they're within it); false if they resist it or nothing changes. */
  const afflict = (id: number, c: Condition, by: number | null, sec: number, aura?: number): boolean => {
    // A save as it lands: a player rolls their own (the round waits for it), the server rolls for the GM's creatures.
    let rounds = c.rounds;
    if (c.apply_save_attr) {
      const dc = c.apply_save_dc ?? 12;
      const total = saveAgainst(id, c.apply_save_attr, dc, `save:${sec}:${c.id}:${id}`, c.name, sec);
      if (total >= dc) {
        if (c.apply_save_outcome !== "halves") {
          log.push(`${sec} s: ${nameOf(id)} resists ${c.name} (${c.apply_save_attr} ${total} vs DC ${dc}).`);
          story.push({ sec, k: "effectEnds", who: id, name: c.name, why: "resisted" });
          return false;
        }
        rounds = Math.max(1, Math.ceil(c.rounds / 2));
        log.push(`${sec} s: ${nameOf(id)} partly resists ${c.name} (${c.apply_save_attr} ${total} vs DC ${dc}): ${rounds} round${rounds === 1 ? "" : "s"}.`);
      } else log.push(`${sec} s: ${nameOf(id)} fails to resist ${c.name} (${c.apply_save_attr} ${total} vs DC ${dc}).`);
    }
    // Instant modifiers happen as it lands (Healing Draught: +1d10 health, up to their full health).
    for (const m of modifiersOf(c)) {
      if (m.kind !== "instant" || !hp.has(id)) continue;
      const n = Math.max(0, rollDice(m.value)), before = hp.get(id)!;
      if (m.heal) {
        const after = Math.min(fighters.get(id)?.maxHp ?? Infinity, before + n);
        hp.set(id, after);
        log.push(`${sec} s: ${nameOf(id)} is healed for ${after - before} (${c.name}); ${after} health.`);
        story.push({ sec, k: "healed", who: id, source: c.name, much: after - before });
      } else if (n > 0) {
        const t = takenBy(id, n, m.damage_type);
        const after = Math.max(0, before - t.n);
        hp.set(id, after);
        log.push(`${sec} s: ${c.name} deals ${nameOf(id)} ${t.n}${m.damage_type ? ` ${m.damage_type}` : ""} damage${t.note}; ${after} left.`);
        story.push({ sec, k: "effect", who: id, name: c.name, much: t.n, heal: false, hurt: hurt(id, t.n) });
        if (t.n > 0) wasHurt(id, sec, t.n, c.id, by);
        if (after <= 0) {
          down.add(id);
          story.push({ sec, k: "down", who: id });
          log.push(`${sec} s: ${nameOf(id)} is down.`);
        }
      }
    }
    // Strain as it lands: points on an attribute that outlast the condition (kept after the round; they count from now on).
    for (const m of modifiersOf(c)) if (m.kind === "strain" && m.points) {
      strains.push({ tokenId: id, attribute: m.attribute, points: m.points });
      if (m.points > 0) fighters.get(id)?.statuses?.push({ source: `${c.name} (strain)`, boosts: [{ target: `attribute:${m.attribute}`, value: `-${m.points}` }], grants: [] });
      log.push(`${sec} s: ${nameOf(id)} ${m.points > 0 ? `takes ${m.points}` : `is relieved of ${-m.points}`} ${m.attribute} strain (${c.name}).`);
      story.push({ sec, k: "strain", who: id, attribute: m.attribute, points: m.points, source: c.name });
    }
    // Temporary health as it lands (kept after the round: the highest counts).
    for (const m of modifiersOf(c)) if (m.kind === "temphp" && hp.has(id)) {
      const n = Math.max(0, rollDice(m.value));
      if (n > (temps.get(id) ?? 0)) temps.set(id, n);
      log.push(`${sec} s: ${nameOf(id)} gains ${n} temporary health (${c.name}).`);
      story.push({ sec, k: "temphp", who: id, source: c.name, much: n });
    }
    if (!lingers(c)) return false; // nothing more to it
    // Concentration: a caster keeps up one concentration condition at a time; a different one ends the old.
    if (c.concentration && by !== null && aura == null) {
      const old = keptUpBy(by).filter((k) => k.a.condition.id !== c.id);
      if (old.length) {
        log.push(`${sec} s: ${nameOf(by)} turns their concentration to ${c.name}: ${[...new Set(old.map((k) => k.a.condition.name))].join(", ")} ends.`);
        for (const k of old) release(k.id, k.a, "concentration", sec);
      }
    }
    const f = fighters.get(id);
    if (f) {
      f.resist = resistsOf(modifiersOf(c), { ...(f.resist ?? {}) });
      const x = extrasOf(modifiersOf(c), c.name, by);
      f.extras = { dealing: [...(f.extras?.dealing ?? []), ...x.dealing], taking: [...(f.extras?.taking ?? []), ...x.taking] };
      const was = f.limits ?? noRestrictions();
      f.limits = restrictionsOf(modifiersOf(c), c.name, by, { forbid: { ...was.forbid }, autofail: [...was.autofail], spare: [...was.spare] });
    }
    if (aura != null) afflicted.set(id, [...(afflicted.get(id) ?? []), auraAffliction(c, aura)]);
    else {
      const r = reapplied(afflicted.get(id) ?? [], c, rounds, by); // refresh, stack or ignore (the condition says)
      if (!r.applied) {
        log.push(`${sec} s: ${nameOf(id)} is already ${c.name.toLowerCase()}: no change.`);
        return false;
      }
      afflicted.set(id, r.list);
    }
    const rolls = rollChanges(c);
    if (rolls.boosts.length || rolls.grants.length || rolls.sets.length || rolls.factors.length || rolls.tweaks.length) fighters.get(id)?.statuses?.push({ source: c.name, ...rolls });
    story.push({ sec, k: "afflicted", who: id, name: c.name, by, ...(aura != null ? { aura: true } : {}) });
    log.push(aura != null ? `${sec} s: ${nameOf(id)} comes within ${nameOf(aura)}'s aura: ${c.name} (${describeCondition(c, false)}) while there.` : `${sec} s: ${nameOf(id)} is affected by ${c.name} (${describeCondition(c)}).`);
    return true;
  };
  /** A condition ends mid-round: off them, and what it did (rolls, limits, extras) stops counting from now on. */
  const release = (id: number, a: Affliction, why: "save" | "damage" | "attack" | "concentration" | "left" | "trigger", sec: number) => {
    const c = a.condition, f = fighters.get(id);
    afflicted.set(id, (afflicted.get(id) ?? []).filter((x) => x !== a));
    if (f) {
      if (f.statuses) f.statuses = f.statuses.filter((s) => s.source !== c.name);
      if (f.limits) {
        const forbid = Object.fromEntries(Object.entries(f.limits.forbid).filter(([, v]) => v !== c.name));
        f.limits = { forbid, autofail: f.limits.autofail, spare: f.limits.spare.filter((x) => x !== a.by) };
      }
      if (f.extras) f.extras = { dealing: f.extras.dealing.filter((x) => x.name !== c.name), taking: f.extras.taking.filter((x) => x.name !== c.name) };
    }
    if (why === "trigger") log.push(`${sec} s: ${nameOf(id)}'s ${c.name} is spent.`);
    if (why === "left") log.push(`${sec} s: ${nameOf(id)} is out of ${nameOf(a.aura ?? -1)}'s aura: no longer ${c.name.toLowerCase()}.`);
    if (why === "damage" || why === "attack") log.push(`${sec} s: ${nameOf(id)} is no longer ${c.name.toLowerCase()} (${why === "damage" ? "hurt" : "they attacked"}).`);
    story.push({ sec, k: "effectEnds", who: id, name: c.name, why });
  };
  /** A save to end a condition, now (start of the round, when hurt, or spending an action on it). */
  const endSave = (id: number, a: Affliction, sec: number) => {
    const s = saveToEnd(a, fighters.get(id), nameOf(id), (attr, dc) => endRoll(id, attr, dc, a.condition.name, sec));
    if (s.line) log.push(`${sec} s: ${s.line}`);
    if (s.ended) release(id, a, "save", sec);
  };
  /** Hurt: conditions that end when hurt end; those saved against when hurt get their save (not `except`, the one hurting them). */
  const wasHurt = (id: number, sec: number, amount: number, except?: number, by: number | null = null) => {
    for (const a of [...(afflicted.get(id) ?? [])]) {
      if (a.condition.id === except || a.aura != null) continue;
      if (a.condition.ends_on_damage) release(id, a, "damage", sec);
      else if (a.condition.save_when === "damaged" && !down.has(id)) endSave(id, a, sec);
    }
    concentrationCheck(id, sec, amount);
    onDamaged(id, sec, by); // "when you take damage" triggers
  };
  /** Everything a caster keeps up by concentrating (their concentration conditions on anyone). */
  const keptUpBy = (caster: number) => [...afflicted].flatMap(([id, list]) => list.filter((a) => a.by === caster && a.condition.concentration && a.aura == null).map((a) => ({ id, a })));
  /** Their concentration breaks: everything they kept up ends, on everyone. */
  const breakConcentration = (caster: number, sec: number, why: string) => {
    const kept = keptUpBy(caster);
    if (!kept.length) return;
    log.push(`${sec} s: ${nameOf(caster)}'s concentration breaks (${why}): ${[...new Set(kept.map((k) => k.a.condition.name))].join(", ")} ends.`);
    for (const { id, a } of kept) release(id, a, "concentration", sec);
  };
  /** A concentrating caster hurt: down breaks it; otherwise a Fortitude save, DC 10 or half the damage if higher. */
  const concentrationCheck = (caster: number, sec: number, amount: number) => {
    if (!keptUpBy(caster).length) return;
    if ((hp.get(caster) ?? 1) <= 0) return breakConcentration(caster, sec, "down");
    const dc = Math.max(10, Math.floor(amount / 2)), kept = [...new Set(keptUpBy(caster).map((k) => k.a.condition.name))].join(", ");
    const s = fighters.get(caster)?.save ? saveRoll(caster, "fortitude", dc, `conc:${sec}:${caster}`, `losing concentration on ${kept}`, sec) : undefined;
    if (!s || s.total < dc) return breakConcentration(caster, sec, `Fortitude ${s?.total ?? "-"} vs DC ${dc}`);
    log.push(`${sec} s: ${nameOf(caster)} keeps concentrating (Fortitude ${s.total} vs DC ${dc}).`);
  };
  /** What someone can see and whether they can be seen, now: their own senses and the conditions on them as they stand this second. */
  const sensesNow = (id: number): Senses => {
    const own = fighters.get(id)?.senses, c = sensesFrom((afflicted.get(id) ?? []).flatMap((a) => modifiersOf(a.condition)));
    return { blind: !!own?.blind || c.blind, invisible: !!own?.invisible || c.invisible, seeInvisible: !!own?.seeInvisible || c.seeInvisible, darkvision: Math.max(own?.darkvision ?? 0, c.darkvision) };
  };
  /** Whether `viewer` can see `target` now: not invisible to them, within 5 ft if they're blind, and lit or within their darkvision. */
  const sightOf = (viewer: number, target: number) => {
    const sv = sensesNow(viewer), st = sensesNow(target), pv = where(viewer), pt = where(target);
    if (!seesThem(sv, st)) return false;
    if (!pv || !pt) return true;
    const d = Math.hypot(pv.col - pt.col, pv.row - pt.row);
    if (sv.blind) return d <= BLIND_RANGE;
    return lit(pt) || d * FEET_PER_SQUARE <= sv.darkvision + 1e-6;
  };
  /** Advantage / disadvantage from not being seen: attacking someone you can't see, attacking someone who can't see you. */
  const unseen = (attacker: number, target: number): RollMode[] => [...(!sightOf(attacker, target) ? (["disadvantage"] as const) : []), ...(!sightOf(target, attacker) ? (["advantage"] as const) : [])];
  /** A creature's triggers: its own (and its gear's), and those of conditions on it. */
  const triggersOf = (id: number) => [
    ...(fighters.get(id)?.triggers ?? []).map((t) => ({ ...t, a: undefined as Affliction | undefined })),
    ...(afflicted.get(id) ?? []).flatMap((a) => modifiersOf(a.condition).flatMap((mod) => (mod.kind === "trigger" ? [{ mod, name: a.condition.name, a }] : []))),
  ];
  /**
   * A hit landed: the target's "when hit" triggers fire (on the attacker) and the attacker's "when they hit" ones (on
   * the target): damage to the other (a save may halve or negate it), a condition on someone, and a condition that
   * ends once its trigger fires ends. Triggered damage isn't a hit, so it doesn't set off more.
   */
  const onHit = (attacker: number, target: number, melee: boolean, sec: number) => {
    const fire = [
      ...triggersOf(target).filter((t) => t.mod.on === "hit").map((t) => ({ ...t, owner: target, other: attacker })),
      ...triggersOf(attacker).filter((t) => t.mod.on === "hitting").map((t) => ({ ...t, owner: attacker, other: target })),
    ];
    fire.forEach((t, i) => { if (t.mod.reach !== "melee" || melee) fireTrigger(t, `tsave:${sec}:${attacker}:${target}:${i}`, sec); });
  };
  /** Their own triggers for an event with no one else in it (start of the round, moving): they take what it does. */
  const onOwn = (id: number, on: "start" | "moves", sec: number) => {
    if (down.has(id)) return;
    triggersOf(id).filter((t) => t.mod.on === on).forEach((t, i) => {
      if (t.mod.on === "moves") log.push(`${sec} s: ${nameOf(id)} moves, setting off ${t.name}.`);
      fireTrigger({ ...t, owner: id, other: id }, `tsave:${sec}:${on}:${id}:${i}`, sec);
    });
  };
  /** A trigger fires: damage to the other creature (a save may halve or negate it), a condition on someone, and its condition may end. */
  let inTrigger = false; // a trigger is firing: the damage it deals doesn't set off "when you take damage" ones (no loops)
  const fireTrigger = (t: { mod: Trigger; name: string; a?: Affliction; owner: number; other: number }, key: string, sec: number) => {
    const m = t.mod;
    if (m.from === "source" && (t.a?.by == null || t.a.by !== t.other || t.other === t.owner)) return; // only the source's doing counts
    const was = inTrigger;
    inTrigger = true;
    try {
      // Who takes it: the other creature, or whoever has it (backwash; healing yourself). How much: dice, plus a modifier.
      const whom = m.damage_to === "self" ? t.owner : t.other;
      const roll = () => Math.max(0, (m.damage ? rollDice(m.damage) : 0) + (m.amount_mod ? (fighters.get(m.amount_mod.whose === "self" ? t.owner : t.other)?.attrMod?.(m.amount_mod.attr) ?? 0) : 0));
      if ((m.damage || m.amount_mod) && m.heal && hp.has(whom) && !down.has(whom)) {
        const before = hp.get(whom)!, after = Math.min(fighters.get(whom)?.maxHp ?? Infinity, before + roll());
        hp.set(whom, after);
        log.push(`${sec} s: ${t.name}${whom === t.owner ? "" : ` (${nameOf(t.owner)})`} heals ${nameOf(whom)} for ${after - before}; ${after} health.`);
        story.push({ sec, k: "effect", who: whom, name: t.name, much: after - before, heal: true });
      } else if ((m.damage || m.amount_mod) && !m.heal && hp.has(whom) && !down.has(whom)) {
        const other = whom; // the creature taking the damage
        let n = roll();
        let saved = "";
        if (m.save_attr) {
          const total = saveAgainst(other, m.save_attr, m.save_dc, key, t.name, sec);
          if (total >= m.save_dc) {
            n = m.save_halves ? Math.floor(n / 2) : 0;
            saved = ` (${m.save_attr} ${total} vs DC ${m.save_dc}: ${m.save_halves ? "halved" : "none"})`;
          } else saved = ` (${m.save_attr} ${total} vs DC ${m.save_dc})`;
        }
        const tk = takenBy(other, n, m.damage_type || undefined), before = hp.get(other)!, after = Math.max(0, before - tk.n);
        hp.set(other, after);
        log.push(`${sec} s: ${t.name}${other === t.owner ? "" : ` (${nameOf(t.owner)})`} deals ${nameOf(other)} ${tk.n}${m.damage_type ? ` ${m.damage_type}` : ""} damage${saved}${tk.note}; ${after} left.`);
        story.push({ sec, k: "effect", who: other, name: t.name, much: tk.n, heal: false, hurt: hurt(other, tk.n), ...(other !== t.owner ? { from: t.owner } : t.a?.by != null && t.a.by !== t.owner ? { from: t.a.by } : {}) }); // from: whose it was (their own trigger, or whoever put the condition on)
        if (tk.n > 0) wasHurt(other, sec, tk.n, undefined, t.owner);
        if (after <= 0 && before > 0) {
          down.add(other);
          story.push({ sec, k: "down", who: other });
          log.push(`${sec} s: ${nameOf(other)} is down.`);
        }
      } else if (!m.damage && !m.amount_mod && m.on !== "moves") log.push(`${sec} s: ${t.name} (${nameOf(t.owner)}) fires.`);
      if (m.given) afflict(m.condition_on === "self" ? t.owner : t.other, m.given, t.owner, sec);
      if (t.a?.condition.ends_on_trigger && (afflicted.get(t.owner) ?? []).includes(t.a)) release(t.owner, t.a, "trigger", sec);
    } finally {
      inTrigger = was;
    }
  };
  /** They took damage (from `by`, if a creature dealt it): their "when you take damage" triggers fire, unless a trigger did it. */
  const onDamaged = (id: number, sec: number, by: number | null) => {
    if (inTrigger || down.has(id)) return;
    triggersOf(id).filter((t) => t.mod.on === "damaged").forEach((t, i) => fireTrigger({ ...t, owner: id, other: by ?? id }, `tsave:${sec}:damaged:${id}:${i}`, sec));
  };
  /** Attacked someone: conditions that end when they attack end (invisibility). */
  const didAttack = (id: number, sec: number) => {
    for (const a of [...(afflicted.get(id) ?? [])]) if (a.condition.ends_on_attack && a.aura == null) release(id, a, "attack", sec);
  };
  /** Leaves a status on someone (for the rest of this round too), and logs it. */
  const leave = (id: number, status: Status | undefined, minutes: number, sec: number, by: number | null = null) => {
    if (!status || down.has(id)) return;
    // A health boost heals straight away (Healing Draught: +1d10), up to their full health.
    const healing = status.boosts.filter((b) => b.target === "health").reduce((sum, b) => sum + rollDice(b.value.replace(/^\+/, "")), 0);
    if (healing > 0 && hp.has(id)) {
      const before = hp.get(id)!, max = fighters.get(id)?.maxHp ?? Infinity, after = Math.min(max, before + healing);
      hp.set(id, after);
      log.push(`${sec} s: ${nameOf(id)} is healed for ${after - before} (${status.source}); ${after} health.`);
      story.push({ sec, k: "healed", who: id, source: status.source, much: after - before });
    }
    // Catalog effects (Poisoned…) run on by rounds of their own.
    for (const c of status.conditions ?? []) afflict(id, c, by, sec);
    // Nothing more to it than healing (and effects): done (it doesn't linger as a status).
    if (status.boosts.every((b) => b.target === "health") && !status.grants.length) return;
    fighters.get(id)?.statuses?.push(status);
    statuses.push({ tokenId: id, status, minutes });
    story.push({ sec, k: "status", who: id, source: status.source });
    log.push(`${sec} s: ${nameOf(id)}: ${describeStatus(status)} (${status.source}, ${minutes < 1 ? `${Math.round(minutes * 10)} round(s)` : `${minutes} min`}).`);
  };
  /** Everyone caught by an area (but `except`) rolls its save against `total` damage; returns how each fared. */
  const catchIn = (at: AreaAt, spec: { dc: number; save: Attribute; half: boolean }, total: number, except: number, sec: number, what = "the area", only?: (id: number) => boolean, type?: string): AreaHit[] => {
    const hits: AreaHit[] = [];
    for (const id of [...fighters.keys()]) {
      const p = where(id);
      if (id === except || down.has(id) || !p || !caughtBy(at, { x: p.col + 0.5, y: p.row + 0.5 }, effectWalls) || (only && !only(id))) continue;
      const f = fighters.get(id)!, name = order.find((o) => o.tokenId === id)?.name ?? bystanders.find((b) => b.tokenId === id)?.name ?? "someone";
      const s = f.save ? saveRoll(id, spec.save, spec.dc, `area:${sec}:${what}:${id}`, what, sec) : { total: 0, text: "no save" };
      const saved = s.total >= spec.dc;
      const t = takenBy(id, saved ? (spec.half ? Math.floor(total / 2) : 0) : total, type);
      const taken = t.n;
      const left = Math.max(0, hp.get(id)! - taken);
      if (taken > 0) {
        hp.set(id, left);
        wasHurt(id, sec, taken, undefined, except >= 0 ? except : null);
        hitAt.set(id, [...(hitAt.get(id) ?? []), sec]);
        if (except >= 0) lastHitBy.set(id, except);
      }
      log.push(`${sec} s: ${name} saves (${spec.save}): ${s.total} (${s.text}) vs DC ${spec.dc}, ${saved ? (taken ? `half damage (${taken})` : "no damage") : `fails, takes ${taken}`}${t.note}; ${left} left.`);
      hits.push({ id, outcome: left <= 0 ? "down" : !saved ? "hit" : taken ? "half" : "save" });
      story.push({ sec, k: "caught", who: id, by: except >= 0 ? except : null, name: what, outcome: !saved ? "hit" : taken ? "half" : "save", hurt: hurt(id, taken), dmg: taken });
      if (left <= 0) {
        story.push({ sec, k: "down", who: id });
        down.add(id);
        log.push(`${sec} s: ${name} is down.`);
      }
    }
    return hits;
  };
  /** Who is in a lasting area now (and not down). */
  const insideOf = (l: LastingArea) => new Set([...fighters.keys()].filter((id) => { const p = where(id); return p && !down.has(id) && caughtBy(l.area, { x: p.col + 0.5, y: p.row + 0.5 }, effectWalls); }));
  const caughtIn = new Set<string>(); // "area:token": caught by that lasting area this round (once a round each)
  /**
   * A lasting area catches whoever is in it (or `only` those) when it fires: as they come in, at the start of the
   * round or at its end (as the area says). Each rolls the save (the damage dice rolled once for all); a failed save
   * puts its conditions on them too.
   */
  const areaCatch = (l: LastingArea, sec: number, when: AreaFires, fx: Fx[], only?: Set<number>) => {
    if (!(l.fires ?? ["end"]).includes(when)) return;
    const total = l.damage ? rollDice(l.damage) : 0, before = log.length;
    const hits = catchIn(l.area, l, total, -1, sec, l.name, (id) => !caughtIn.has(`${l.id}:${id}`) && (!only || only.has(id)));
    if (!hits.length) return;
    const how = when === "enter" ? `catches ${hits.map((h) => nameOf(h.id)).join(", ")} coming into it` : when === "start" ? "catches whoever starts the round in it" : "lingers";
    log.splice(before, 0, `${sec} s: ${l.name} ${how}: ${total} damage, ${l.save} save DC ${l.dc}.`);
    for (const h of hits) {
      caughtIn.add(`${l.id}:${h.id}`);
      if (h.outcome === "hit") for (const c of l.conditions ?? []) afflict(h.id, c, l.by ?? null, sec);
    }
    fx.push({ look: "area", from: 0, area: l.area, hits, lasting: true });
  };
  const order = [...movers].sort((a, b) => b.initiative - a.initiative);
  const wants = new Map(order.map((m) => [m.tokenId, planner(m, walls, gridless)]));
  const lag = new Map(order.map((m) => [m.tokenId, 0])); // seconds each has been held back
  const pos = new Map(order.map((m) => [m.tokenId, m.start]));
  const same = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) < 0.9 : a.col === b.col && a.row === b.row); // the same spot (overlapping)
  const unmoved = (a: Pos, b: Pos) => Math.hypot(a.col - b.col, a.row - b.row) < 0.01; // a short step on a gridless map is still a move
  const log: string[] = [];
  // Each mover's actions in its own plan time. An action finishes when the mover's plan clock (seconds minus the
  // seconds it was held back or spent closing in) passes its end; order within a second = initiative order.
  type Act = { start: number; end: number; step: Extract<PlanStep, { kind: "action" }> };
  const acts = new Map<number, Act[]>(
    order.map((m) => [
      m.tokenId,
      timeline(m.plan, m.walking).steps.flatMap((s) => (s.step.kind === "action" ? [{ start: s.start, end: s.end, step: s.step }] : [])),
    ])
  );
  const finished = new Set<Act>();
  const begun = new Set<Act>(); // ranged actions that started in reach (no more closing in for them)
  const hp = new Map([...fighters].map(([id, f]) => [id, f.hp]));
  const down = new Set([...hp].filter(([, h]) => h <= 0).map(([id]) => id));
  const hitAt = new Map<number, number[]>(); // seconds each was hit in
  const where = (id: number) => pos.get(id) ?? bystanders.find((b) => b.tokenId === id)?.at;
  const inReach = (a: Pos, b: Pos, range = 1) =>
    (gridless ? Math.hypot(a.col - b.col, a.row - b.row) <= range + 0.5 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= range) &&
    !walls.some((w) => crosses({ x: a.col + 0.5, y: a.row + 0.5 }, { x: b.col + 0.5, y: b.row + 0.5 }, w)); // not through a wall

  // What each second ended with, for playing the round back: everyone's spot, who's down, and what happened.
  const frames: ReplayFrame[] = [];
  // Evade / Pursue: from when each starts (in its own plan time), its target, and whether it's over (within 5 ft).
  const chases = new Map<number, { start: number; end: number; action: string; target: { id: number; name: string } }>();
  for (const m of order) {
    for (const s of timeline(m.plan, m.walking).steps) {
      if (s.step.kind === "action" && CHASE_ACTIONS.includes(s.step.action) && s.step.target) chases.set(m.tokenId, { start: s.start, end: s.end, action: s.step.action, target: s.step.target });
    }
  }
  const chaseOver = new Set<number>();
  const close = (a: Pos, b: Pos) => (gridless ? Math.hypot(a.col - b.col, a.row - b.row) <= 1.05 : Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) <= 1);
  const dist = (a: Pos, b: Pos) => Math.hypot(a.col - b.col, a.row - b.row);
  const budget = new Map(order.map((m) => [m.tokenId, 0])); // squares (or units) of chase movement banked
  /**
   * One second of a planned move that has to leave its line: around a body lying in the way, or back onto its route
   * after being pushed aside. Heads for `to` (where the plan has them by now), turning up to 120° either side for a
   * spot clear of bodies and walls that gets closest.
   */
  function detourStep(m: Mover, from: Pos, to: Pos): Pos {
    const step = m.walking / FEET_PER_SQUARE / ROUND_SECONDS, d = dist(from, to);
    if (d < 1e-6 || step <= 0) return from;
    const bodies = [...down].flatMap((id) => (id === m.tokenId ? [] : where(id) ?? []));
    const len = Math.min(step, d), heading = Math.atan2(to.row - from.row, to.col - from.col);
    const snap = (p: Pos) => (gridless ? { col: Math.round(p.col * 20) / 20, row: Math.round(p.row * 20) / 20 } : { col: Math.round(p.col), row: Math.round(p.row) });
    let best: Pos | null = null;
    for (const turn of [0, 30, -30, 60, -60, 90, -90, 120, -120]) {
      const a = heading + (turn * Math.PI) / 180, p = snap({ col: from.col + Math.cos(a) * len, row: from.row + Math.sin(a) * len });
      if (unmoved(p, from) || bodies.some((b) => same(b, p)) || !clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: p.col + 0.5, y: p.row + 0.5 }, walls)) continue;
      if (!best || dist(p, to) < dist(best, to) - 1e-9) best = p;
    }
    return best ?? from;
  }
  /** One second of Evade / Pursue from `from` with the target at `them`: toward by the most direct route, or as far away as it can get. */
  function chaseStep(m: Mover, from: Pos, them: Pos, pursue: boolean): Pos {
    const perSecond = m.walking / FEET_PER_SQUARE / ROUND_SECONDS; // 30 ft speed → 1 square a second
    const b = budget.get(m.tokenId)! + perSecond;
    // Spots someone else stands in now: a chaser goes around them rather than waiting behind them (anyone down is
    // no obstacle: they can be stepped over).
    const others = [...[...pos].filter(([id]) => id !== m.tokenId && !down.has(id)).map(([, p]) => p), ...bystanders.filter((x) => !down.has(x.tokenId)).map((x) => x.at)];
    const taken = (p: Pos) => others.some((o) => same(o, p));
    if (gridless) {
      budget.set(m.tokenId, 0);
      if (pursue) {
        const path = shortestPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: them.col + 0.5, y: them.row + 0.5 }, walls, () => true) ?? [];
        let left = b, at = { x: from.col + 0.5, y: from.row + 0.5 };
        for (const p of path.slice(1)) {
          const d = Math.hypot(p.x - at.x, p.y - at.y);
          const goal = Math.hypot(them.col + 0.5 - at.x, them.row + 0.5 - at.y);
          const step = Math.min(left, d, Math.max(0, goal - 1)); // stop 5 ft short of them
          at = { x: at.x + ((p.x - at.x) / (d || 1)) * step, y: at.y + ((p.y - at.y) / (d || 1)) * step };
          left -= step;
          if (left <= 1e-6 || step < d) break;
        }
        let to = { col: at.x - 0.5, row: at.y - 0.5 };
        if (taken(to)) {
          // Someone's there: angle off to either side (30° steps) for the free spot that gets closest.
          const dx = to.col - from.col, dy = to.row - from.row, len = Math.hypot(dx, dy) || b;
          const heading = Math.atan2(dy, dx);
          let best: Pos | null = null;
          for (const turn of [30, -30, 60, -60, 90, -90]) {
            const a = heading + (turn * Math.PI) / 180, p = { col: from.col + Math.cos(a) * len, row: from.row + Math.sin(a) * len };
            if (taken(p) || !clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: p.col + 0.5, y: p.row + 0.5 }, walls)) continue;
            if (!best || dist(p, them) < dist(best, them)) best = p;
          }
          to = best ?? from;
        }
        return { col: Math.round(to.col * 20) / 20, row: Math.round(to.row * 20) / 20 };
      }
      // Evade: of 16 directions (clear of walls), the one ending furthest away.
      let best = from;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, to = { col: from.col + Math.cos(a) * b, row: from.row + Math.sin(a) * b };
        if (!taken(to) && clearPath({ x: from.col + 0.5, y: from.row + 0.5 }, { x: to.col + 0.5, y: to.row + 0.5 }, walls) && dist(to, them) > dist(best, them)) best = to;
      }
      return { col: Math.round(best.col * 20) / 20, row: Math.round(best.row * 20) / 20 };
    }
    const squares = Math.floor(b + 1e-9);
    budget.set(m.tokenId, b - squares);
    if (!squares) return from;
    const reach = reachableSquares(from, squares, walls); // where they can get to this second
    if (pursue) {
      // Steps from each square to the target (searching out from the target), so the next spot is the one on the
      // shortest route; equally short ones go to whichever is nearest in a straight line (the most direct).
      const toThem = reachableSquares({ col: Math.round(them.col), row: Math.round(them.row) }, 60, walls);
      let best: Pos = from, bestKey = [toThem.get(squareKey(from.col, from.row))?.steps ?? Infinity, dist(from, them)];
      for (const sq of reach.values()) {
        if ((sq.col === Math.round(them.col) && sq.row === Math.round(them.row)) || taken(sq)) continue; // not onto them or anyone else
        const k = [toThem.get(squareKey(sq.col, sq.row))?.steps ?? Infinity, dist(sq, them)];
        if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1] - 1e-9)) [best, bestKey] = [sq, k];
      }
      return { col: best.col, row: best.row };
    }
    let best = { ...from, steps: 0 };
    for (const s of reach.values()) if (!taken(s) && dist(s, them) > dist(best, them) + 1e-9) best = s;
    return { col: best.col, row: best.row };
  }

  const closingIn = new Set<number>(); // who has been told they're closing in (logged once)
  const readied = new Set<Act>(); // reactions that are ready
  const skipped = new Set<number>(); // whose later planned moves were skipped (logged once)
  // For the players' story: what each was evidently up to, who last hit them, who last held them up.
  const closingFor = new Map<number, { target: number; means: string }>();
  const lastHitBy = new Map<number, number>();
  const heldBy = new Map<number, number>();
  const frozen = new Set<number>(); // told they can't move this round (a condition)
  const movedYet = new Set<number>(); // who has moved of their own accord this round (for "when they move" triggers)
  const detoured = new Set<number>(); // told they went around a body this round
  const gaveWay = new Set<string>(); // contested moves already settled this round (told once)
  const intentOf = (m: Mover, sec: number, closing: Set<number>): Intent => {
    const c = chases.get(m.tokenId), t = sec - lag.get(m.tokenId)!;
    if (closing.has(m.tokenId) && closingFor.has(m.tokenId)) return { doing: "close", ...closingFor.get(m.tokenId)! };
    if (c && t > c.start && !chaseOver.has(m.tokenId) && t - 1 < c.end) return { doing: c.action === "pursue" ? "chase" : "evade", target: c.target.id };
    return { doing: "move" };
  };
  const wasIn = new Map(lasting.map((l) => [l.id, insideOf(l)])); // who is in each lasting area (at the start: being there isn't coming in)
  for (let sec = 1; sec <= ROUND_SECONDS; sec++) {
    const logFrom = log.length;
    // The start of the round: saves against conditions rolled then.
    if (sec === 1) for (const [id, list] of [...afflicted]) for (const a of [...list]) if (a.condition.save_when === "start" && a.condition.save_attr && a.aura == null && !down.has(id)) endSave(id, a, sec);
    // The start of the round: triggers that fire then (a burning curse), on whoever has them.
    if (sec === 1) for (const id of [...new Set([...fighters.keys(), ...afflicted.keys()])]) if (where(id)) onOwn(id, "start", sec);
    const fx: Fx[] = [];
    // The start of the round: lasting areas that catch whoever starts a round in them (Spirit Guardians).
    if (sec === 1) for (const l of lasting) areaCatch(l, sec, "start", fx);
    const lagBefore = new Map(lag);
    const autoPursue = new Set<number>(); // closing in on an out-of-reach target this second (their plan waits)
    // Evaluation: where each would like to be at the end of this second (Evade / Pursue decided afresh from where their target is now).
    const proposed = new Map(
      order.map((m) => {
        const here = pos.get(m.tokenId)!;
        if (down.has(m.tokenId)) return [m.tokenId, here];
        const held = fighters.get(m.tokenId)?.limits?.forbid.movement;
        if (held) {
          if (!frozen.has(m.tokenId)) { frozen.add(m.tokenId); log.push(`${sec} s: ${m.name} can't move (${held}).`); }
          return [m.tokenId, here];
        }
        const c = chases.get(m.tokenId), t = sec - lag.get(m.tokenId)!;
        // A ranged action due now on someone out of reach: pursue them first, while that still leaves time to do it.
        const tp = t - 1;
        const due = acts.get(m.tokenId)!.find((a) => rangeOf(a.step, m) && a.step.target && !begun.has(a) && !finished.has(a) && a.start <= tp + 1e-9 && tp < a.end);
        if (due) {
          const them = where(due.step.target!.id);
          if (them && !down.has(due.step.target!.id) && !inReach(here, them, rangeOf(due.step, m))) {
            if (ROUND_SECONDS - sec >= due.end - due.start - 1e-9) {
              autoPursue.add(m.tokenId);
              if (!closingIn.has(m.tokenId)) {
                log.push(`${sec} s: ${m.name} closes in on ${due.step.target!.name} to ${due.step.action}.`);
                const means = due.step.use ? `use ${due.step.use.name}` : due.step.action;
                closingFor.set(m.tokenId, { target: due.step.target!.id, means });
                story.push({ sec, k: "close", who: m.tokenId, target: due.step.target!.id, means });
              }
              closingIn.add(m.tokenId);
              return [m.tokenId, chaseStep(m, here, them, true)];
            }
          } else begun.add(due);
        }
        // Having closed in, they stay where that got them: moves planned for later this round are skipped.
        if (closingIn.has(m.tokenId) && !(c && t > c.start)) {
          const planned = wants.get(m.tokenId)!;
          if (!same(planned(t), planned(t - 1)) && !skipped.has(m.tokenId)) {
            skipped.add(m.tokenId);
            log.push(`${sec} s: ${m.name}'s planned move is skipped: they closed in instead.`);
            story.push({ sec, k: "skip", who: m.tokenId, after: "close", target: closingFor.get(m.tokenId)?.target ?? null });
          }
          return [m.tokenId, here];
        }
        if (c && t > c.start) {
          // Chasing (or done chasing, which ends the round's movement: they stay where it left them).
          const them = where(c.target.id);
          if (chaseOver.has(m.tokenId) || t - 1 >= c.end - 1e-9) {
            // Over: they stay where the chase left them, so moves planned after it are skipped.
            const planned = wants.get(m.tokenId)!;
            if (!same(planned(t), planned(t - 1)) && !skipped.has(m.tokenId)) {
              skipped.add(m.tokenId);
              log.push(`${sec} s: ${m.name}'s planned move is skipped: they stay where the ${c.action} left them.`);
              story.push({ sec, k: "skip", who: m.tokenId, after: c.action === "pursue" ? "chase" : "evade", target: c.target.id });
            }
            return [m.tokenId, here];
          }
          if (!them || down.has(c.target.id) || close(here, them)) return [m.tokenId, here];
          return [m.tokenId, chaseStep(m, here, them, c.action === "pursue")];
        }
        // A planned move: along its route, unless a body lies on the next spot (step around it) or they've been put off
        // the route (pushed aside): then they make their own way towards where the plan has them by now.
        const planned = wants.get(m.tokenId)!, next = planned(t);
        const body = [...down].find((id) => { const p = where(id); return id !== m.tokenId && p && same(p, next); });
        if (body !== undefined || !unmoved(here, planned(t - 1))) {
          if (unmoved(here, next) || (body !== undefined && unmoved(planned(t + 1), next) && close(here, next))) return [m.tokenId, here]; // as close as they'll get to a spot a body lies on
          if (body !== undefined && !detoured.has(m.tokenId)) {
            detoured.add(m.tokenId);
            log.push(`${sec} s: ${m.name} goes around ${nameOf(body)}, lying in the way.`);
          }
          return [m.tokenId, detourStep(m, here, next)];
        }
        return [m.tokenId, next];
      })
    );
    // Reconciliation, highest initiative first.
    const settled: { id: number; at: Pos }[] = [];
    for (const m of order) {
      const here = pos.get(m.tokenId)!, want = proposed.get(m.tokenId)!;
      if (unmoved(here, want)) {
        settled.push({ id: m.tokenId, at: here });
        continue;
      }
      const stillUnmoved = order.filter((o) => !settled.some((s) => s.id === o.tokenId) && o.tokenId !== m.tokenId && unmoved(proposed.get(o.tokenId)!, pos.get(o.tokenId)!));
      // Who's in the way (anyone down isn't: a body on the ground can be stepped over).
      const blocker =
        settled.find((s) => !down.has(s.id) && same(s.at, want)) ??
        stillUnmoved.filter((o) => !down.has(o.tokenId)).map((o) => ({ id: o.tokenId, at: pos.get(o.tokenId)! })).find((s) => same(s.at, want)) ??
        bystanders.filter((b) => !down.has(b.tokenId) && same(b.at, want)).map((b) => ({ id: b.tokenId, at: want }))[0];
      if (blocker) {
        const intent = intentOf(m, sec, autoPursue); // what they were up to, before being set back a second
        lag.set(m.tokenId, lag.get(m.tokenId)! + 1);
        const who = nameOf(blocker.id);
        log.push(`${sec} s: ${m.name} is held back by ${who}.`);
        story.push({ sec, k: "blocked", who: m.tokenId, by: blocker.id, intent });
        heldBy.set(m.tokenId, blocker.id);
        settled.push({ id: m.tokenId, at: here });
      } else {
        settled.push({ id: m.tokenId, at: want });
      }
    }
    // Closing in pauses the rest of their plan (unless being held back already did).
    for (const id of autoPursue) if (lag.get(id) === lagBefore.get(id)) lag.set(id, lag.get(id)! + 1);
    // Result.
    const before = new Map(pos); // where everyone was at the start of this second
    const shoved = new Set<number>(); // pushed aside this second (not moving of their own accord)
    for (const s of settled) pos.set(s.id, s.at);
    // Anyone left sharing a spot (a held-back mover whose spot was taken): the GM decides who has it. Until they
    // have, the round stops here; once they have, the other gives way (back where they were this second, or aside).
    for (let i = 0; i < settled.length; i++) for (let j = i + 1; j < settled.length; j++) {
      if (!same(settled[i].at, settled[j].at) || down.has(settled[i].id) || down.has(settled[j].id)) continue; // sharing a spot with a body is fine
      const spot = settled[i].at, ids = [settled[i].id, settled[j].id];
      const key = `${Math.min(...ids)}:${Math.max(...ids)}@${Math.round(spot.col)},${Math.round(spot.row)}`, winner = decisions[key]; // the same call holds if it comes up again later in the round
      const named = (id: number) => ({ id, name: nameOf(id), from: before.get(id)! });
      if (winner === undefined || !ids.includes(winner)) throw new ContestedMove({ sec, key, a: named(ids[0]), b: named(ids[1]), spot });
      const loser = ids.find((id) => id !== winner)!, entry = settled.find((s) => s.id === loser)!;
      const taken = (p: Pos) => settled.some((s) => s.id !== loser && !down.has(s.id) && same(s.at, p)) || bystanders.some((b) => !down.has(b.tokenId) && same(b.at, p));
      const back = before.get(loser)!;
      let to: Pos | undefined = !same(back, spot) && !taken(back) ? back : undefined;
      if (!to) {
        // Pushed aside: the nearest free spot next to the contested one (not through a wall).
        const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([dc, dr]) => ({ col: spot.col + dc, row: spot.row + dr }));
        to = around.filter((p) => !taken(p) && inReach(spot, p, 1)).sort((p, q) => dist(p, back) - dist(q, back))[0];
      }
      if (!to) {
        log.push(`${sec} s: ${nameOf(loser)} has nowhere to give way to and stays squeezed in beside ${nameOf(winner)}.`);
        continue;
      }
      entry.at = to;
      pos.set(loser, to);
      shoved.add(loser);
      if (lag.get(loser) === lagBefore.get(loser)) lag.set(loser, lag.get(loser)! + 1);
      const m = order.find((o) => o.tokenId === loser)!;
      log.push(gaveWay.has(key) ? `${sec} s: ${m.name} is held back by ${nameOf(winner)}.` : `${sec} s: ${m.name} gives way to ${nameOf(winner)}${same(to, back) ? "" : " and is pushed aside"} (GM's call).`);
      gaveWay.add(key);
      story.push({ sec, k: "blocked", who: loser, by: winner, intent: intentOf(m, sec, autoPursue) });
      heldBy.set(loser, winner);
    }
    // Moving of their own accord: "when they move" triggers fire, the first second they do in a round (Booming Blade).
    for (const m of order) if (!movedYet.has(m.tokenId) && !shoved.has(m.tokenId) && !down.has(m.tokenId) && !unmoved(before.get(m.tokenId)!, pos.get(m.tokenId)!)) {
      movedYet.add(m.tokenId);
      onOwn(m.tokenId, "moves", sec);
    }
    // Lasting areas that catch whoever comes into them (a fire wall): those in one now who weren't a second ago.
    for (const l of lasting) {
      const now = insideOf(l), was = wasIn.get(l.id) ?? new Set<number>();
      const entering = new Set([...now].filter((id) => !was.has(id)));
      if (entering.size) areaCatch(l, sec, "enter", fx, entering);
      wasIn.set(l.id, now);
    }
    // Auras follow whoever gives them off: those now within one get its condition (a save as it lands, on entering), those out of it lose it.
    syncAuras(afflicted, auraWants({ ids: [...fighters.keys()], where, allegiance: (id) => fighters.get(id)?.allegiance ?? "hostile", down, standing: (id) => fighters.get(id)?.auras ?? [], afflicted, gridless }), passes,
      (target, c, source) => afflict(target, c, source, sec, source), (target, a) => release(target, a, "left", sec));
    // Reactions get ready in the second they're planned for (after anything planned before them): Dodge gives
    // attacks against them disadvantage from then until the round ends.
    for (const m of order) {
      if (down.has(m.tokenId)) continue;
      for (const a of acts.get(m.tokenId)!) {
        if (!REACTIONS.includes(a.step.action) || readied.has(a) || a.start > sec - 1 - lag.get(m.tokenId)! + 1e-9) continue;
        readied.add(a);
        const noReact = fighters.get(m.tokenId)?.limits?.forbid.reaction;
        if (noReact) {
          log.push(`${sec} s: ${m.name} can't ${a.step.action} (${noReact}).`);
          story.push({ sec, k: "stopped", who: m.tokenId, action: a.step.action, target: null, why: noReact });
          continue;
        }
        // d20 + agility (their own dice, if they rolled with the plan) against DODGE_DC.
        const f = fighters.get(m.tokenId), check = f?.save ? usingDice(a.step.dice?.check, () => f.save!("agility")) : undefined;
        if (check && check.total < DODGE_DC) {
          story.push({ sec, k: "dodge", who: m.tokenId, ok: false });
          log.push(`${sec} s: ${m.name} tries to dodge but isn't quick enough (${check.total}: ${check.text} vs DC ${DODGE_DC}).`);
          continue;
        }
        f?.statuses?.push({ source: "Dodge", boosts: [], grants: [{ roll: "attacked", mode: "disadvantage" }] });
        story.push({ sec, k: "dodge", who: m.tokenId, ok: true });
        log.push(`${sec} s: ${m.name} is ready to dodge${check ? ` (${check.total} vs DC ${DODGE_DC})` : ""}: attacks against them have disadvantage.`);
      }
    }
    // Actions finishing this second: their end passed on the mover's own plan clock.
    const finishing = order.flatMap((m) => {
      const from = sec - 1 - lagBefore.get(m.tokenId)!, to = sec - lag.get(m.tokenId)!;
      return acts.get(m.tokenId)!.filter((a) => !finished.has(a) && a.end > from + 1e-9 && a.end <= to + 1e-9).map((a) => ({ m, a }));
    });
    for (const { m, a: act } of finishing) {
      finished.add(act);
      const { step } = act;
      const start = act.start + lag.get(m.tokenId)!; // when it really started
      const say = (text: string) => log.push(`${sec} s: ${text}`);
      if (down.has(m.tokenId)) continue; // down: the rest of their plan is gone
      // A condition stopping that kind of step (Stunned, Incapacitated): it doesn't happen.
      const stopped = fighters.get(m.tokenId)?.limits?.forbid[stepKind(step)];
      if (stopped) {
        say(`${m.name} can't ${step.use ? `use ${step.use.name}` : step.action} (${stopped}).`);
        story.push({ sec, k: "stopped", who: m.tokenId, action: step.use ? `use ${step.use.name}` : step.action, target: step.target?.id ?? null, why: stopped });
        continue;
      }
      // A refit (a bonus action) is done: from now on they fight with the new gear.
      if (step.swap) {
        const before = { ...(m.equipment ?? {}) };
        const equipment = { ...before, [step.swap.slot]: step.swap.item.id, ...(step.swap.clears ? { [step.swap.clears]: null } : {}) };
        m.equipment = equipment;
        fighters.get(m.tokenId)?.wear?.(equipment);
        if (step.swap.reach) m.attackRange = step.swap.reach;
        refits.push({ tokenId: m.tokenId, equipment, before, swap: step.swap });
        story.push({ sec, k: "refit", who: m.tokenId, from: step.swap.from?.name ?? null, to: step.swap.item.name });
        say(`${m.name} ${step.swap.from ? `swaps ${step.swap.from.name} for ${step.swap.item.name}` : `takes up ${step.swap.item.name}`} (${step.swap.slot}).`);
        continue;
      }
      // Hit while doing it (not in the second it finishes: blows landing together both count).
      if ((hitAt.get(m.tokenId) ?? []).some((t) => t > start && t < sec)) {
        say(`${m.name}'s ${step.action} is interrupted: they were hit.`);
        story.push({ sec, k: "interrupted", who: m.tokenId, action: step.use ? `use ${step.use.name}` : step.action, by: lastHitBy.get(m.tokenId) ?? null });
        continue;
      }
      if (CHASE_ACTIONS.includes(step.action) || REACTIONS.includes(step.action)) continue; // movement / reactions: handled above
      // An ability used on themselves (Case the Scene): its effects on them.
      if (step.action === "use" && step.use) {
        say(`${m.name} uses ${step.use.name}.`);
        story.push({ sec, k: "ability", who: m.tokenId, name: step.use.name, target: null });
        leave(m.tokenId, step.use.statuses?.self, step.use.statuses?.minutes ?? 0, sec, m.tokenId);
        continue;
      }
      // Shake off: their action spent fighting off conditions that allow it (a save against each).
      if (step.action === "shake") {
        const list = (afflicted.get(m.tokenId) ?? []).filter((a) => a.condition.save_action && a.condition.save_attr && a.aura == null);
        if (!list.length) say(`${m.name} has nothing to shake off.`);
        for (const a of list) endSave(m.tokenId, a, sec);
        continue;
      }
      if (step.action !== "attack") {
        say(`${m.name}: ${step.action} (no effect yet).`);
        continue;
      }
      // Aimed at several (exactly / up to N picked, or all of a kind in range): one attack roll against each one's
      // defense and one damage roll for everyone hit; an ability without damage just takes effect on each in range.
      const tg = step.use?.targeting;
      if (step.use && !step.use.area && tg && ((step.picks?.length ?? 0) > 1 || tg.count === "all")) {
        const use = step.use, mine = fighters.get(m.tokenId)?.allegiance ?? "hostile", here = pos.get(m.tokenId)!;
        const list = tg.count === "all"
          ? [...fighters.keys()].filter((id) => (id !== m.tokenId || use.targets === "anyone") && !down.has(id) && where(id) && (id === m.tokenId || fits(tg.who, relation(mine, fighters.get(id)?.allegiance ?? "hostile"))) && inReach(here, where(id)!, rangeOf(step, m)))
          : step.picks!.map((x) => x.id);
        const me = fighters.get(m.tokenId);
        say(`${m.name} uses ${use.name} on ${list.length ? list.map(nameOf).join(", ") : "no one"}.`);
        let a: ReturnType<Combatant["attack"]> | null = null, dmg: { total: number; text: string } | null = null;
        for (const id of list) {
          const them = fighters.get(id), at = where(id);
          if (!me || !them || !at || down.has(id)) continue;
          if (me.limits?.spare.includes(id) && use.damage) {
            say(`${m.name} can't bring themselves to harm ${nameOf(id)}.`);
            story.push({ sec, k: "stopped", who: m.tokenId, action: `use ${use.name}`, target: id, why: "spare" });
            continue;
          }
          if (!inReach(here, at, rangeOf(step, m))) {
            say(`${nameOf(id)} is out of range of ${use.name}.`);
            story.push({ sec, k: "attack", who: m.tokenId, target: id, with: use.name, outcome: "reach" });
            continue;
          }
          if (!use.damage) {
            story.push({ sec, k: "ability", who: m.tokenId, name: use.name, target: id });
            leave(id, use.statuses?.target, use.statuses?.minutes ?? 0, sec, m.tokenId);
            continue;
          }
          a ??= usingDice(step.dice?.hit, () => me.attack(use, them, unseen(m.tokenId, id)));
          const d = them.defense();
          const look = (rangeOf(step, m) ?? 1) > 1 ? "arrow" : "slash";
          // A natural 1 always misses; a critical always hits (the damage dice twice, unless they're immune to criticals).
          const crit = !!a.crit && !critImmune(them.statuses);
          if (a.fumble || (!a.crit && a.total < d.total)) {
            say(`${use.name} misses ${nameOf(id)}: ${a.total} (${a.text}) vs defense ${d.total}${a.fumble ? " (a natural 1)" : ""}.`);
            story.push({ sec, k: "attack", who: m.tokenId, target: id, with: use.name, outcome: "miss" });
            fx.push({ look, from: m.tokenId, to: id, outcome: "miss" });
            continue;
          }
          dmg ??= usingDice(step.dice?.damage, () => me.damage(use, crit));
          const t0 = takenBy(id, dmg.total, use.damageType), x = bonusOnHit(m.tokenId, id);
          const t = { ...t0, n: t0.n + x.n, note: t0.note + x.note };
          const left = Math.max(0, hp.get(id)! - t.n);
          hp.set(id, left);
          hitAt.set(id, [...(hitAt.get(id) ?? []), sec]);
          lastHitBy.set(id, m.tokenId);
          say(`${use.name} ${critNote(a.crit, crit)}hits ${nameOf(id)}: ${a.total} vs defense ${d.total}, ${dmg.total} damage (${dmg.text})${t.note}; ${left} left.`);
          story.push({ sec, k: "attack", who: m.tokenId, target: id, with: use.name, outcome: "hit", hurt: hurt(id, t.n), dmg: t.n, ...(t.r ? { resist: t.r } : {}), ...(crit ? { crit: true } : {}) });
          if (t.n > 0) wasHurt(id, sec, t.n, undefined, m.tokenId);
          fx.push({ look, from: m.tokenId, to: id, outcome: left <= 0 ? "down" : "hit" });
          if (left <= 0) {
            down.add(id);
            story.push({ sec, k: "down", who: id });
            say(`${nameOf(id)} is down.`);
          }
          leave(id, use.statuses?.target, use.statuses?.minutes ?? 0, sec, m.tokenId);
          onHit(m.tokenId, id, (rangeOf(step, m) ?? 1) <= 1, sec); // triggers: when hit, when they hit
        }
        leave(m.tokenId, use.statuses?.self, use.statuses?.minutes ?? 0, sec, m.tokenId);
        if (use.damage) didAttack(m.tokenId, sec);
        continue;
      }
      // An ability aimed at someone that does no damage (Mesmerize): no attack roll; it takes effect if they're in range.
      if (step.use && !step.use.damage && !step.use.area) {
        const target = step.target, at = target && where(target.id);
        if (!target || !at || down.has(target.id)) say(`${m.name}'s ${step.use.name} fails: no one to use it on.`);
        else if (!inReach(pos.get(m.tokenId)!, at, rangeOf(step, m))) {
          say(`${m.name}'s ${step.use.name} on ${target.name} fails: out of range.`);
          story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use.name, outcome: "reach" });
        } else {
          say(`${m.name} uses ${step.use.name} on ${target.name}.`);
          story.push({ sec, k: "ability", who: m.tokenId, name: step.use.name, target: target.id });
          leave(target.id, step.use.statuses?.target, step.use.statuses?.minutes ?? 0, sec, m.tokenId);
          leave(m.tokenId, step.use.statuses?.self, step.use.statuses?.minutes ?? 0, sec, m.tokenId);
        }
        continue;
      }
      // An area attack: everyone caught (but the attacker) rolls the save; the damage is rolled once for all.
      const area = step.use?.area;
      if (area && step.aim && step.use) {
        const me = fighters.get(m.tokenId), here = pos.get(m.tokenId)!;
        const at = placeArea(area.shape, area.ft, { x: here.col + 0.5, y: here.row + 0.5 }, { x: step.aim.col, y: step.aim.row });
        let hits: AreaHit[] = [];
        if (me) {
          const dmg = usingDice(step.dice?.damage, () => me.damage(step.use));
          say(`${m.name} uses ${step.use.name} (${describeArea(area)}): ${dmg.total} damage (${dmg.text}), ${area.save} save DC ${area.dc}.`);
          story.push({ sec, k: "area", who: m.tokenId, name: step.use.name });
          // Selective: only the kind it's for (friendlies / enemies), the ones picked, or at most N of them (nearest the aim).
          const tg = step.use.targeting, mine = fighters.get(m.tokenId)?.allegiance ?? "hostile";
          const kind = (id: number) => !tg || fits(tg.who, relation(mine, fighters.get(id)?.allegiance ?? "hostile"));
          const picked = step.picks?.length ? new Set(step.picks.map((x) => x.id)) : null;
          let allowed: Set<number> | null = null;
          if (tg && !picked && (tg.count === "exactly" || tg.count === "upto" || tg.count === "one")) {
            const n = tg.count === "one" ? 1 : tg.n, aim = { col: step.aim.col - 0.5, row: step.aim.row - 0.5 };
            allowed = new Set([...fighters.keys()].filter((id) => id !== m.tokenId && kind(id) && where(id) && caughtBy(at, { x: where(id)!.col + 0.5, y: where(id)!.row + 0.5 }, effectWalls) && !down.has(id))
              .sort((a, b) => dist(where(a)!, aim) - dist(where(b)!, aim)).slice(0, n));
          }
          hits = catchIn(at, area, dmg.total, m.tokenId, sec, step.use.name, (id) => kind(id) && (!picked || picked.has(id)) && (!allowed || allowed.has(id)), step.use.damageType);
          if (!hits.length) say(`${m.name}'s ${step.use.name} catches no one.`);
          // Statuses: on the user, and on each one caught who failed the save.
          const st = step.use.statuses;
          if (st) {
            leave(m.tokenId, st.self, st.minutes, sec, m.tokenId);
            didAttack(m.tokenId, sec);
            for (const h of hits) if (h.outcome === "hit") leave(h.id, st.target, st.minutes, sec, m.tokenId);
          }
        }
        // A lasting one stays on the map, catching whoever is in it at the end of each round.
        if (area.minutes) {
          created.push({ name: step.use.name, look: area.look ?? "fog", area: at, damage: step.use.damage, dc: area.dc, save: area.save, half: area.half, minutes: area.minutes, fires: area.fires, conditions: step.use.statuses?.target?.conditions, by: m.tokenId });
          say(`${step.use.name} stays for ${area.minutes < 1 ? `${Math.round(area.minutes * 10)} round(s)` : `${area.minutes} min`}.`);
        }
        fx.push({ look: "area", from: m.tokenId, area: at, hits });
        continue;
      }
      const target = step.target;
      const me = fighters.get(m.tokenId), them = target && fighters.get(target.id);
      const at = target && where(target.id);
      if (!target || !me || !them || !at) {
        say(`${m.name}'s attack fails: no target.`);
      } else if (me.limits?.spare.includes(target.id)) {
        say(`${m.name} can't bring themselves to attack ${target.name}.`);
        story.push({ sec, k: "stopped", who: m.tokenId, action: step.use ? `use ${step.use.name}` : step.action, target: target.id, why: "spare" });
      } else if (down.has(target.id)) {
        say(`${m.name}'s attack fails: ${target.name} is already down.`);
        story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "gone" });
      } else if (!inReach(pos.get(m.tokenId)!, at, rangeOf(step, m))) {
        say(`${m.name}'s attack on ${target.name} fails: out of reach.`);
        story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "reach" });
      } else {
        const a = usingDice(step.dice?.hit, () => me.attack(step.use, them, unseen(m.tokenId, target.id))), d = them.defense(); // unseen: advantage / disadvantage
        const how = step.use ? ` (${step.use.name})` : "";
        const look = (rangeOf(step, m) ?? 1) > 1 ? "arrow" : "slash"; // reach beyond the next square: a projectile
        const shown = (outcome: AttackFx["outcome"]) => fx.push({ look, from: m.tokenId, to: target.id, outcome });
        const crit = !!a.crit && !critImmune(them.statuses), misses = a.fumble || (!a.crit && a.total < d.total); // a natural 1 misses; a critical hits
        if (misses) shown("miss");
        if (misses) say(`${m.name} attacks ${target.name}${how}: ${a.total} (${a.text}) vs defense ${d.total} (${d.text}): miss${a.fumble ? " (a natural 1)" : ""}.`);
        if (misses) story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "miss" });
        else {
          const dmg = usingDice(step.dice?.damage, () => me.damage(step.use, crit));
          const t0 = takenBy(target.id, dmg.total, step.use?.damageType), x = bonusOnHit(m.tokenId, target.id);
          const t = { ...t0, n: t0.n + x.n, note: t0.note + x.note };
          const left = Math.max(0, hp.get(target.id)! - t.n);
          hp.set(target.id, left);
          hitAt.set(target.id, [...(hitAt.get(target.id) ?? []), sec]);
          lastHitBy.set(target.id, m.tokenId);
          say(`${m.name} attacks ${target.name}${how}: ${a.total} (${a.text}) vs defense ${d.total}: ${critNote(a.crit, crit)}hit for ${dmg.total} (${dmg.text})${t.note}; ${target.name} has ${left} left.`);
          story.push({ sec, k: "attack", who: m.tokenId, target: target.id, with: step.use?.name ?? null, outcome: "hit", hurt: hurt(target.id, t.n), dmg: t.n, ...(t.r ? { resist: t.r } : {}), ...(crit ? { crit: true } : {}) });
          if (t.n > 0) wasHurt(target.id, sec, t.n, undefined, m.tokenId);
          shown(left <= 0 ? "down" : "hit");
          if (left <= 0) {
            story.push({ sec, k: "down", who: target.id });
            down.add(target.id);
            say(`${target.name} is down.`);
          }
          leave(target.id, step.use?.statuses?.target, step.use?.statuses?.minutes ?? 0, sec, m.tokenId); // on a hit
          onHit(m.tokenId, target.id, (rangeOf(step, m) ?? 1) <= 1, sec); // triggers: when hit, when they hit
        }
        leave(m.tokenId, step.use?.statuses?.self, step.use?.statuses?.minutes ?? 0, sec, m.tokenId); // whether it hit or not
        didAttack(m.tokenId, sec);
      }
    }
    // Evade / Pursue end: within range of what's planned next, within 5 ft, the target down, or their time up.
    for (const [id, c] of chases) {
      if (chaseOver.has(id) || down.has(id) || sec - lag.get(id)! <= c.start + 1e-9) continue;
      const m = order.find((o) => o.tokenId === id)!, now = sec - lag.get(id)!;
      // Within range of what they planned next (only theirs: the other may well keep going): they stop and get on
      // with it now, the rest of the chase's time going to it.
      const next = acts.get(id)!.find((a) => a.start >= c.end - 1e-9 && !finished.has(a) && a.step.target && rangeOf(a.step, m));
      const nextAt = next && where(next.step.target!.id);
      if (next && nextAt && !down.has(next.step.target!.id) && inReach(pos.get(id)!, nextAt, rangeOf(next.step, m))) {
        chaseOver.add(id);
        if (now < next.start - 1e-9) lag.set(id, lag.get(id)! - (next.start - now));
        log.push(`${sec} s: ${m.name} stops their ${c.action}: ${next.step.target!.name} is within range to ${next.step.use?.name ?? next.step.action}.`);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: "range", next: next.step.target!.id });
        continue;
      }
      const them = where(c.target.id);
      if (them && (close(pos.get(id)!, them) || down.has(c.target.id))) {
        chaseOver.add(id);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: down.has(c.target.id) ? "down" : "close" });
        log.push(`${sec} s: ${m.name}'s ${c.action} ends: ${down.has(c.target.id) ? `${c.target.name} is down` : `within 5 ft of ${c.target.name}`}.`);
        continue;
      }
      if (now >= c.end - 1e-9 && c.end < ROUND_SECONDS - 1e-9) {
        chaseOver.add(id);
        story.push({ sec, k: "chase", who: id, target: c.target.id, action: c.action, why: "time" });
        log.push(`${sec} s: ${m.name}'s ${c.action} ends after ${+(c.end - c.start).toFixed(1)} s.`);
      }
    }
    // The end of the round: whoever is in a lasting area rolls its save (its damage dice rolled once for everyone).
    if (sec === ROUND_SECONDS) {
      for (const l of lasting) areaCatch(l, sec, "end", fx);
      // Effects tick: damage or healing, a round off each, then a save to shake it off.
      const beforeTick = new Map(hp);
      tickAfflictions(afflicted, { hp, fighters, down, nameOf, log, story, sec, hurt, roll: endRoll }); // players roll their own saves to end conditions
      for (const [id, h] of hp) if (h < (beforeTick.get(id) ?? h)) { concentrationCheck(id, sec, beforeTick.get(id)! - h); onDamaged(id, sec, null); } // hurt by damage over time
    }
    frames.push({ sec, pos: Object.fromEntries([...pos].map(([id, p]) => [id, p])), down: [...down], lines: log.slice(logFrom).map((l) => l.replace(/^\d+ s: /, "")), ...(fx.length ? { fx } : {}) });
  }
  // Actions pushed past the end of the round (by closing in or being held back) don't happen.
  for (const m of order) {
    if (down.has(m.tokenId)) continue;
    for (const a of acts.get(m.tokenId)!) if (!finished.has(a) && !CHASE_ACTIONS.includes(a.step.action)) {
      log.push(`${m.name}'s ${a.step.action} runs out of time this round.`);
      story.push({ sec: ROUND_SECONDS, k: "late", who: m.tokenId, action: a.step.use ? `use ${a.step.use.name}` : a.step.action, heldBy: heldBy.get(m.tokenId) ?? null, target: a.step.target?.id ?? null });
    }
  }
  for (const m of order) {
    const end = pos.get(m.tokenId)!;
    if (!unmoved(end, m.start)) log.push(`${m.name} ends at ${end.col}, ${end.row}.`);
  }
  return { final: pos, hp, log, frames, created, statuses, refits, story, afflictions: afflicted, temps, passes, strains };
}

/** A save rolled for someone (in a round: by its player, the round waiting, or the server): for `what`, at second `sec`. */
export type SaveRoll = (id: number, attr: Attribute, dc: number, what: string, sec: number) => { total: number; text: string };

/**
 * A creature's save to end a condition: a success counts towards the saves it takes (one, unless it says more);
 * returns whether that ended it, and a line for the log. `roll`: who rolls it (default: the server).
 */
export function saveToEnd(a: Affliction, f: Combatant | undefined, who: string, roll?: (attr: Attribute, dc: number) => { total: number; text: string }): { ended: boolean; line: string } {
  const c = a.condition;
  if (!c.save_attr || !f?.save) return { ended: false, line: "" };
  const s = roll ? roll(c.save_attr, c.save_dc) : f.save(c.save_attr), need = Math.max(1, c.saves_needed ?? 1);
  if (s.total < c.save_dc) return { ended: false, line: `${who} fails to shake off ${c.name} (${s.total} vs DC ${c.save_dc}).` };
  a.saved = (a.saved ?? 0) + 1;
  if (a.saved >= need) return { ended: true, line: `${who} shakes off ${c.name} (${s.total}: ${s.text} vs DC ${c.save_dc}).` };
  return { ended: false, line: `${who} resists ${c.name} (${s.total} vs DC ${c.save_dc}): ${a.saved} of ${need} saves.` };
}

/**
 * The end of a round for everyone's conditions: each effect's periodic modifiers do their damage (or healing), the
 * condition loses a round, and unless that was its last, its creature rolls the save to end it. Also used for rounds passing out of an encounter (the clock).
 */
export function tickAfflictions(
  afflicted: Map<number, Affliction[]>,
  { hp, fighters, down, nameOf, log, story, sec, hurt, roll }: { hp: Map<number, number>; fighters: Map<number, Combatant>; down: Set<number>; nameOf: (id: number) => string; log: string[]; story?: StoryEvent[]; sec: number; hurt: (id: number, dmg: number) => number; roll?: SaveRoll },
) {
  const at = (line: string) => log.push(story ? `${sec} s: ${line}` : line);
  for (const [id, list] of afflicted) {
    const f = fighters.get(id), keep: Affliction[] = [];
    const hurtBy = new Set<number>(); // conditions whose damage hurt them this tick
    for (const a of list) {
      const c = a.condition;
      // Each of its effects' periodic modifiers: damage or healing.
      for (const m of modifiersOf(c)) {
        if (m.kind !== "periodic" || !hp.has(id) || down.has(id)) continue;
        const n = Math.max(0, rollDice(m.value));
        const before = hp.get(id)!;
        if (m.heal) {
          const after = Math.min(f?.maxHp ?? Infinity, before + n);
          hp.set(id, after);
          if (after > before) {
            at(`${nameOf(id)} is healed for ${after - before} by ${c.name}; ${after} health.`);
            story?.push({ sec, k: "effect", who: id, name: c.name, much: after - before, heal: true });
          }
        } else if (n > 0) {
          const r = m.damage_type ? combineResist(f?.resist?.[m.damage_type]) : null, took = afterResist(n, r);
          const after = Math.max(0, before - took);
          hp.set(id, after);
          at(`${c.name} deals ${nameOf(id)} ${took}${m.damage_type ? ` ${m.damage_type}` : ""} damage${r ? ` (${r === "immune" ? "immune" : `${r}: ${took} of ${n}`})` : ""}; ${after} left.`);
          if (took > 0) {
            story?.push({ sec, k: "effect", who: id, name: c.name, much: took, heal: false, hurt: hurt(id, took) });
            hurtBy.add(c.id);
          }
          if (after <= 0 && before > 0) {
            down.add(id);
            at(`${nameOf(id)} is down.`);
            story?.push({ sec, k: "down", who: id });
          }
        }
      }
      if (a.aura != null) { // from an aura: lasts while they're within it (no rounds, no saves)
        keep.push(a);
        continue;
      }
      const left = a.left - 1;
      if (left <= 0) {
        at(`${c.name} wears off ${nameOf(id)}.`);
        story?.push({ sec, k: "effectEnds", who: id, name: c.name, why: "time" });
        continue;
      }
      if ((c.save_when ?? "end") === "end" && c.save_attr && f?.save && !down.has(id)) {
        const s = saveToEnd(a, f, nameOf(id), roll && ((attr, dc) => roll(id, attr, dc, c.name, sec)));
        at(s.line + (s.ended ? "" : ` ${left} round${left === 1 ? "" : "s"} left.`));
        if (s.ended) {
          story?.push({ sec, k: "effectEnds", who: id, name: c.name, why: "save" });
          continue;
        }
      }
      keep.push({ ...a, left });
    }
    // Hurt by a condition's damage: others that end when hurt end; those saved against when hurt get their save.
    const stays = hurtBy.size ? keep.filter((a) => {
      if (hurtBy.has(a.condition.id) || a.aura != null) return true;
      if (a.condition.ends_on_damage) {
        at(`${nameOf(id)} is no longer ${a.condition.name.toLowerCase()} (hurt).`);
        story?.push({ sec, k: "effectEnds", who: id, name: a.condition.name, why: "damage" });
        return false;
      }
      if (a.condition.save_when === "damaged" && !down.has(id)) {
        const s = saveToEnd(a, f, nameOf(id), roll && ((attr, dc) => roll(id, attr, dc, a.condition.name, sec)));
        at(s.line);
        if (s.ended) story?.push({ sec, k: "effectEnds", who: id, name: a.condition.name, why: "save" });
        return !s.ended;
      }
      return true;
    }) : keep;
    afflicted.set(id, stays);
  }
}
