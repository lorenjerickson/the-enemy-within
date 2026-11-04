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
] as const;

export type PlayerActionId = (typeof PLAYER_ACTIONS)[number]["id"];
