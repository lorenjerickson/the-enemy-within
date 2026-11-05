/** What every player can do on their turn, in the order the Actions panel shows them, with a Game Icons name each. */
export const PLAYER_ACTIONS = [
  { id: "move", label: "Move", hint: "walk", icon: "GiWalk" },
  { id: "dash", label: "Dash", hint: "run", icon: "GiRun" },
  { id: "interact", label: "Interact", icon: "GiHand" },
  { id: "use", label: "Use", icon: "GiSwapBag" },
  { id: "attack", label: "Attack", icon: "GiCrossedSwords" },
  { id: "disengage", label: "Disengage", icon: "GiReturnArrow" },
  { id: "dodge", label: "Dodge", icon: "GiDodging" },
  { id: "assist", label: "Assist", icon: "GiShakingHands" },
  { id: "hide", label: "Hide", icon: "GiHoodedFigure" },
  { id: "ready", label: "Ready", icon: "GiHourglass" },
  { id: "search", label: "Search", icon: "GiMagnifyingGlass" },
  { id: "evade", label: "Evade", icon: "GiRabbit" },
  { id: "pursue", label: "Pursue", icon: "GiHound" },
] as const;

export type PlayerActionId = (typeof PLAYER_ACTIONS)[number]["id"];

/** Search: an Investigation check against this DC reveals hidden things within SEARCH_RANGE grid squares (5 ft each). */
export const SEARCH_DC = 14;
export const SEARCH_RANGE = 2; // 10 ft

/** Actions aimed at someone: the player picks a target when planning them. */
export const TARGETED_ACTIONS: PlayerActionId[] = ["attack", "evade", "pursue"];

/** Evade and Pursue: movement that follows the target, re-decided every second, for the rest of the round. */
export const CHASE_ACTIONS: PlayerActionId[] = ["evade", "pursue"];
