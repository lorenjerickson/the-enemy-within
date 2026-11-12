/**
 * Map triggers: zones the GM places (Triggers layer), always hidden from players, that make things happen when someone
 * comes into one, starts a round in one or ends a move in one (the same zones and choices as traps; see
 * lib/traps.ts): open or lock a door, switch a light or map effect, reveal a secret or a discovery, set off a trap,
 * stop the mover, or run a script. Outside rounds they act at once; in a round they're noted the second they fire and
 * act once the round is resolved (only stopping the mover is immediate).
 */
import type { AreaFires } from "@/lib/aoe";
import type { TrapArea, TrapOften, TrapWho } from "@/lib/traps";

export type TriggerOutcome =
  | { kind: "door"; door: number; to: "open" | "close" | "lock" | "unlock" }
  | { kind: "light"; light: number; on: boolean }
  | { kind: "effect"; effect: number; on: boolean } // a placed map effect (rain, fog…)
  | { kind: "secret"; secret: number } // revealed to the players
  | { kind: "discovery"; discovery: number } // into the party's journals
  | { kind: "trap"; trap: number } // sets it off: it springs on whoever is in it (it goes off, and is found, even if no one is)
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
}

export const OUTCOME_KINDS: [TriggerOutcome["kind"], string][] = [
  ["door", "a door"], ["light", "a light"], ["effect", "a map effect"], ["secret", "reveal a secret"], ["discovery", "reveal a discovery"],
  ["trap", "set off a trap"], ["stop", "stop them"], ["script", "run a script"],
];

/** "opens Cellar door", "turns Lamp off", "sets off Spike pit"… (`name` names the thing by id). */
export function describeOutcome(o: TriggerOutcome, name: (kind: TriggerOutcome["kind"], id: number) => string = (_, id) => `#${id}`): string {
  switch (o.kind) {
    case "door": return `${o.to === "close" ? "closes" : `${o.to}s`} ${name("door", o.door)}`;
    case "light": return `turns ${name("light", o.light)} ${o.on ? "on" : "off"}`;
    case "effect": return `turns ${name("effect", o.effect)} ${o.on ? "on" : "off"}`;
    case "secret": return `reveals ${name("secret", o.secret)}`;
    case "discovery": return `reveals ${name("discovery", o.discovery)}`;
    case "trap": return `sets off ${name("trap", o.trap)}`;
    case "stop": return "stops them";
    case "script": return "runs a script";
  }
}
