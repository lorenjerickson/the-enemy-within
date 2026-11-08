import { ACTION_SECONDS } from "@/lib/roundPlan";
import { CHASE_ACTIONS, actionKind, type PlayerActionId } from "@/lib/playerActions";

/** The short summary in a basic action's tooltip: how long it takes, and what kind of thing it is. */
export function basicLines(id: PlayerActionId): string[] {
  const kind = actionKind(id);
  const what = kind === "movement" ? "Movement: as much as time allows." : kind === "bonus" ? "Bonus action: one a round." : kind === "reaction" ? "Reaction: one a round." : "Action: one a round.";
  const time = id === "move" ? "Takes as long as the walk (your walking speed)." : CHASE_ACTIONS.includes(id) ? "Takes the seconds you pick." : ACTION_SECONDS[id] ? `Takes ${ACTION_SECONDS[id]} s of the round.` : null;
  return [what, ...(time ? [time] : [])];
}
