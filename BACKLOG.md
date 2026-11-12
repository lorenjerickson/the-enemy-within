# Backlog

From the code review on 2026-11-06. Roughly in the order to tackle them.

## Next

0. ~~**Collapse conditions and effects into one thing: effects.**~~ Done 2026-11-13. An effect is a name, its rules and how long it lasts: so many rounds (with its saves and what ends it), while equipped (offered to items), or always (offered to creatures). Actions and the GM put on effects lasting rounds. The conditions table is kept empty: at start-up and after importing an older export, any conditions become effects (`migrateConditions`): a custom condition with one effect of its own merges into it (keeping the effect's name and id), anything else becomes a new effect named after the condition; actions, trigger/aura rules, effects on tokens and aura passes are repointed; the old built-ins' building blocks go unless something has one or no built-in uses it. Built-ins are single effects with all their rules. Rules now say "gains the X effect". Engine unchanged (it still keeps an effect put on someone as a `Condition` snapshot). Still to do as its own slice: fold actions' own boosts and advantage/disadvantage ("statuses") into effects.

0a. ~~**Traps**~~ Done 2026-11-13. Traps layer (GM): drag out a rectangle, circle or tripwire; set when it springs (coming into it, starting a round in it, ending a move in it), on whom (anyone / the party / their enemies), how often (once / once per creature / every time), damage with a save (half or none), effects on a failed save, whether it stops the mover, and the Search DC to find it; re-arm, reveal/hide, remove. Springs in free movement (stops the walk; the player is told how bad, the GM logged) and in each second of a round (players roll their own saves; a stopping trap ends their movement for the round; in round stories). Springing reveals it; Search (Investigation vs its DC, within 10 ft) finds it; players see found traps (where, not what they do). Saves outside rounds are rolled by the server. Disarming later. `lib/traps.ts`, `map_traps`, `app/(play)/play/traps.ts`.
0b. **Triggers** (after Traps). The same kind of zone, for things that aren't hazards: someone entering, leaving, starting a round in or ending a move in it opens, closes or locks a door; turns a light or map effect on or off; plays a sound or a visual effect; reveals a secret or a discovery; stops the mover; activates a trap; or runs a script for anything else. Same who / how-often choices as traps; always hidden from players. Replaces writing ON … DO position scripts for the common cases, and gets checked each second of a round (ON triggers only run at the end of one).

## Now (cheap, real payoff)

1. ~~**Player fog recomputes every frame.**~~ Done 2026-11-10: explored polygons keyed on sightings + walls, current sight on where the viewers stand (not every frame); `freeMove` works out views lazily, nearest first. `MapView`'s `fogged` memo depends on `drawnTokens` (a new array each render), so during replays/effects (~30 fps) it redoes one visibility polygon per sighting (43 on level 14 already; free move adds one per step). Memoize the explored polygons on sightings + structures only. `freeMove` (server) has the same growing cost per click.
2. ~~**Dead / duplicate code.**~~ Done (found already done 2026-11-10). Unused: `setTokenHp`, `getSecretLevel`, `audible`. `MapView` has its own `insidePolygon` (use `lib/visibility`'s) and a `segmentDistance` duplicating `lib/movement`'s point-to-segment distance.
3. ~~**Health written twice.**~~ Done (found already done 2026-11-10). `saveGame` writes `hp` via `saveCharacterState` and again via `saveCharacterHealth`; drop `hp` from `saveCharacterState`, and the `hp` argument of `addCreatureToken`.
4. ~~**Health form duplicated.**~~ Done (`HealthFields`, `parseHealthForm`). Health dock tool and character page each have their own fields and number parsing: one `HealthFields` component and one `parseHealthForm` in `lib/health`.
5. **Six hand-rolled `useSyncExternalStore` stores** (`targetMode`, `scrub`, `moveMode`, `gmPlanner`, `ScriptPick`, `ambientPlayer`): a small generic `createStore<T>()`.
6. **Route groups import each other's internals.** `MapView` imports 8 modules from `(play)/play`; the play page imports 8 from `(app)`. Move the shared pieces to private folders (`app/_map/`, `app/_session/`). File moves only.
7. ~~**Untracked `Claude outputs/` folder**~~ Done 2026-11-10: gitignored (kept on disk). in the repo: delete or gitignore.

## When next touching that area

8. **Split `MapView.tsx`** (2,294 lines; one ~1,650-line component serving the editor and live play): layer renderers → `mapLayers.ts` first (mechanical), then session overlays (pick highlights, plan ring, target lines, pings), then pointer handling per mode.
9. **Split `lib/db.ts`** (2,118 lines, 185 exports; 40 tables and 74 migrations scattered through it) into `lib/db/*.ts` behind an index re-export, or at least gather the schema at the top.
10. ~~**Light visibility polygons recomputed per light per frame**~~ Done 2026-11-10: `viewPast` caches each spot's view (grid units) per walls array; lights, the darkness mask, sounds, lasting areas and area effects use it. while flicker/effects animate: memoize per light + structures.

## Later / leave for now

11. ~~**No tests.**~~ Done 2026-11-12: `npm test` (Node's runner, no dependencies; each file gets its own temp database), run in CI before the build. 253 tests: engine rules (`tests/engine`), round resolution scenarios (`tests/round`, via `harness.ts`), effect sentences, scripts and formatter (`tests/editing`), and characters, inventory, professions, fighters, game scripts, triggers and campaign export/import against a real database (`tests/db`).
12. **`/play` polls every 3 s** (`AutoRefresh`), re-rendering the whole server tree for every client. Fine at this table size.
13. **Gaps the tests found** (each is a `{ todo }` test: fix, then drop the todo):
    - ~~Open-ground routes arc off the straight line~~ Fixed 2026-11-13 (of equally short routes, the straightest wins; found while testing traps).
    - Two effect rules render badly: a "when you take damage" damage trigger ("your Might increases by ? for ? rounds") and an "it takes" amount from an attribute modifier ("your:fortitude"). Not makeable in the builder; only older data. Likely moot after #0. (`tests/editing/effectGrammar.test.ts`)
    - Script ternary branches can't assign (`a ? x = 1 : x = 2`). (`tests/editing/script.test.ts`)
