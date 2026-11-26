## Real-time updates: polling today, and what it costs

How browsers learn about changes now (2026-11-25):

- **The play page** re-renders from the server every 3 s (`app/(app)/AutoRefresh.tsx`, `router.refresh()`), every 1 s while the player has an improvisation open or agreed. It carries tokens' positions, plans, the round, rolls, everything on the page.
- **The map** polls every 1 s for script effects and for walks recorded by other browsers (`MapView.tsx`: `fxSince`, `walksSince`), to animate them.
- **Heartbeat** checks in every 5 s (presence); the lobby every 3 s; the join prompt every 10 s.

Symptoms seen in play, all from separate polls arriving in either order:

- A player's smooth walk shows on another browser as the token jumping straight to its destination: the page refresh (final position) landed before the map's walk poll (the path to animate).
- In a round replay, an area's overlay (a smoke bomb) shows as the round starts instead of when it's used (at 5 s).
- Generally: state from "the future" (an end state) reaching a browser before the animation that leads to it.

For productization: push changes from the server over WebSockets instead of polling. Ordering still matters with one channel: send events (a walk, an area placed) before, or with, the end state they lead to, and have the client hold an end state until its animation has played. The near-term fix for the jump does the same holding without WebSockets (backlog T).
