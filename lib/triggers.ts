/**
 * Map triggers: zones the GM places (Triggers layer), always hidden from players, that make things happen when someone
 * comes into one, starts a round in one or ends a move in one (the same zones and choices as traps; see
 * lib/traps.ts): open or lock a door, switch a light or map effect, reveal a secret or a discovery, set off a trap,
 * stop the mover, or run a script. Outside rounds they act at once; in a round they're noted the second they fire and
 * act once the round is resolved (only stopping the mover is immediate).
 */
import type { AreaFires } from "@/lib/aoe";
import { canSpring, distanceToTrap, type TrapArea, type TrapOften, type TrapWho } from "@/lib/traps";
import type { Allegiance } from "@/lib/sides";

export type TriggerOutcome =
  | { kind: "door"; door: number; to: "open" | "close" | "lock" | "unlock" }
  | { kind: "light"; light: number; on: boolean }
  | { kind: "effect"; effect: number; on: boolean } // a placed map effect (rain, fog…)
  | { kind: "secret"; secret: number } // revealed to the players
  | { kind: "discovery"; discovery: number } // into the party's journals
  | { kind: "area"; area: number; to: "on" | "off" | "set off" } // a hazard: switched on (an active one catches whoever is in it) or off, or set off (a dormant one springs on whoever is in it, going off even if no one is; an active one catches whoever is in it, whatever its timings)
  | { kind: "stop" } // stops whoever set it off where they are
  | { kind: "script"; script: string }; // a game script, run on this level

export interface MapTrigger {
  id: number;
  name: string;
  area: TrapArea;
  springs: AreaFires[];
  who: TrapWho;
  often: TrapOften;
  outcomes: TriggerOutcome[];
  sprung: number[]; // tokens it has fired for
  interact?: boolean; // also fires when someone within reach Interacts with it (a lever, a switch, an object: by its name)
}

export const OUTCOME_KINDS: [TriggerOutcome["kind"], string][] = [
  ["door", "a door"], ["light", "a light"], ["effect", "a map effect"], ["secret", "reveal a secret"], ["discovery", "reveal a discovery"],
  ["area", "a hazard"], ["stop", "stop them"], ["script", "run a script"],
];

/** "opens Cellar door", "turns Lamp off", "sets off Spike pit"… (`name` names the thing by id). */
export function describeOutcome(o: TriggerOutcome, name: (kind: TriggerOutcome["kind"], id: number) => string = (_, id) => `#${id}`): string {
  switch (o.kind) {
    case "door": return `${o.to === "close" ? "closes" : `${o.to}s`} ${name("door", o.door)}`;
    case "light": return `turns ${name("light", o.light)} ${o.on ? "on" : "off"}`;
    case "effect": return `turns ${name("effect", o.effect)} ${o.on ? "on" : "off"}`;
    case "secret": return `reveals ${name("secret", o.secret)}`;
    case "discovery": return `reveals ${name("discovery", o.discovery)}`;
    case "area": return o.to === "set off" ? `sets off ${name("area", o.area)}` : `turns ${name("area", o.area)} ${o.to}`;
    case "stop": return "stops them";
    case "script": return "runs a script";
  }
}

/** Interactable triggers (levers, switches, objects) a token at `at` (its centre) can reach and set off: by name. */
export function interactablesNear(triggers: MapTrigger[], tokenId: number, side: Allegiance, at: { x: number; y: number }, reach: number): { id: number; name: string }[] {
  return triggers.filter((t) => t.interact && canSpring(t, tokenId, side) && distanceToTrap(t.area, at) <= reach).map((t) => ({ id: t.id, name: t.name }));
}
