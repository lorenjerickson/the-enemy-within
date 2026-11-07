/**
 * What every player can do in a round, grouped by kind (movement, actions, bonus actions, reactions) in the order the
 * Actions panel shows them, with a Game Icons name each. A round has any amount of movement (time allowing), one
 * action, one bonus action and one reaction.
 */
export const PLAYER_ACTIONS = [
  { id: "move", label: "Move", hint: "walk", icon: "GiWalk", kind: "movement" },
  { id: "dash", label: "Dash", hint: "run", icon: "GiRun", kind: "movement" },
  { id: "evade", label: "Evade", icon: "GiRabbit", kind: "movement" },
  { id: "pursue", label: "Pursue", icon: "GiHound", kind: "movement" },
  { id: "attack", label: "Attack", icon: "GiCrossedSwords", kind: "action" },
  { id: "use", label: "Use", icon: "GiSwapBag", kind: "action" },
  { id: "interact", label: "Interact", icon: "GiHand", kind: "action" },
  { id: "disengage", label: "Disengage", icon: "GiReturnArrow", kind: "action" },
  { id: "assist", label: "Assist", icon: "GiShakingHands", kind: "action" },
  { id: "hide", label: "Hide", icon: "GiHoodedFigure", kind: "action" },
  { id: "ready", label: "Ready", icon: "GiHourglass", kind: "action" },
  { id: "search", label: "Search", icon: "GiMagnifyingGlass", kind: "action" },
  { id: "refit", label: "Refit", icon: "GiSwordClash", kind: "bonus" },
  { id: "dodge", label: "Dodge", icon: "GiDodging", kind: "reaction" },
] as const;

export type PlayerActionId = (typeof PLAYER_ACTIONS)[number]["id"];
export type ActionKind = "movement" | "action" | "bonus" | "reaction";

/** The groups in the Actions panel. */
export const ACTION_GROUPS: [ActionKind, string][] = [["movement", "Movement"], ["action", "Actions"], ["bonus", "Bonus actions"], ["reaction", "Reactions"]];

export const actionKind = (id: PlayerActionId): ActionKind => PLAYER_ACTIONS.find((a) => a.id === id)?.kind ?? "action";

/**
 * Reactions are planned like anything else and take their time, but only work from the moment they're planned:
 * declared after a move, they're ready once the move is done (so declare them first). Dodge: from then on, attacks
 * against them have disadvantage for the rest of the round.
 */
export const REACTIONS: PlayerActionId[] = ["dodge"];

/** Search: an Investigation check against this DC reveals hidden things within SEARCH_RANGE grid squares (5 ft each). */
export const SEARCH_DC = 14;
export const SEARCH_RANGE = 2; // 10 ft

/** Actions aimed at someone: the player picks a target when planning them. */
export const TARGETED_ACTIONS: PlayerActionId[] = ["attack", "evade", "pursue"];

/**
 * Evade and Pursue: movement that follows the target, re-decided every second, for as long as planned (the rest of
 * the round by default). Each stops early once the two are within 5 ft, or once its target is within range of the
 * next thing they planned to do to them (it starts straight away).
 */
export const CHASE_ACTIONS: PlayerActionId[] = ["evade", "pursue"];

/**
 * Actions that need their target within a range (grid squares; 1 = next to them). Declared on someone out of reach,
 * the actor pursues them first, for as long as that still leaves time to do the action.
 */
export const ACTION_RANGE: Partial<Record<PlayerActionId, number>> = { attack: 1 };

/**
 * Refit (bonus action): swap what's in one equipment slot for something else they carry that fits it. Planned
 * steps after it assume the swap (a new weapon's actions can be planned); it happens when the refit finishes.
 */
export const REFIT_SECONDS = 2;
