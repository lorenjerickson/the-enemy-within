# Backlog

From the code review on 2026-11-06. Roughly in the order to tackle them.

## Now (cheap, real payoff)

1. **Player fog recomputes every frame.** `MapView`'s `fogged` memo depends on `drawnTokens` (a new array each render), so during replays/effects (~30 fps) it redoes one visibility polygon per sighting (43 on level 14 already; free move adds one per step). Memoize the explored polygons on sightings + structures only. `freeMove` (server) has the same growing cost per click.
2. **Dead / duplicate code.** Unused: `setTokenHp`, `getSecretLevel`, `audible`. `MapView` has its own `insidePolygon` (use `lib/visibility`'s) and a `segmentDistance` duplicating `lib/movement`'s point-to-segment distance.
3. **Health written twice.** `saveGame` writes `hp` via `saveCharacterState` and again via `saveCharacterHealth`; drop `hp` from `saveCharacterState`, and the `hp` argument of `addCreatureToken`.
4. **Health form duplicated.** Health dock tool and character page each have their own fields and number parsing: one `HealthFields` component and one `parseHealthForm` in `lib/health`.
5. **Six hand-rolled `useSyncExternalStore` stores** (`targetMode`, `scrub`, `moveMode`, `gmPlanner`, `ScriptPick`, `ambientPlayer`): a small generic `createStore<T>()`.
6. **Route groups import each other's internals.** `MapView` imports 8 modules from `(play)/play`; the play page imports 8 from `(app)`. Move the shared pieces to private folders (`app/_map/`, `app/_session/`). File moves only.
7. **Untracked `Claude outputs/` folder** in the repo: delete or gitignore.

## When next touching that area

8. **Split `MapView.tsx`** (2,294 lines; one ~1,650-line component serving the editor and live play): layer renderers → `mapLayers.ts` first (mechanical), then session overlays (pick highlights, plan ring, target lines, pings), then pointer handling per mode.
9. **Split `lib/db.ts`** (2,118 lines, 185 exports; 40 tables and 74 migrations scattered through it) into `lib/db/*.ts` behind an index re-export, or at least gather the schema at the top.
10. **Light visibility polygons recomputed per light per frame** while flicker/effects animate: memoize per light + structures.

## Later / leave for now

11. **No tests.** Keep a tiny `tests/` (run with `npx tsx --test`) with 4–5 regression tests for round resolution, movement and script prompts, built from the ad-hoc simulations used to find today's bugs. Leave `resolveRound.ts`'s structure alone until more rules arrive.
12. **`/play` polls every 3 s** (`AutoRefresh`), re-rendering the whole server tree for every client. Fine at this table size.
