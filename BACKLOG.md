# Backlog

From the code review on 2026-11-06. Roughly in the order to tackle them.

## Next

0. **Collapse conditions and effects into one thing: effects, granted by various means.** Conditions and effects read as the same thing to the GM (every custom condition has at most one effect, named after its action: Mesmerize → Mesmerized), so keep only effects. An effect has a name, its rule sentences and its lifecycle (duration, saves, what ends it, stacking). Actions grant effects directly (on the user and/or the target); so do items, creatures and professions. Duration "while equipped" is only offered for effects granted by an equippable item (replaces standing effects on items). Migrate the catalogue (each condition merges into its effect, keeping the effect's name and taking the condition's lifecycle; built-ins become single effects with all their rules; look at Hold, Pummel and Bear Hug, which have no effects), effects on tokens (`afflictions`) and the campaign export/import. Round resolution only reads rules, so it changes little; the round tests cover it. Later slice: fold actions' own boosts and advantage/disadvantage ("statuses") into effects too.

0a. **Traps** (after #0). A hazard the GM places on the map (Triggers layer): a shape (circle, rectangle, or a line across a corridor), hidden from players until found. Sets off when someone enters it, starts a round in it or ends a move in it, in free movement and in each second of a round (the lasting-area machinery: a trap is a lasting area the GM places, that stays and is hidden). Who sets it off (anyone, the party, enemies) and how often (once, once per creature, every time). What it does: damage with a save, and/or grants effects (Burning, Grappled); stops the mover where they are. Found like a secret (Search: Investigation within range, or the GM reveals it); once found it shows to players. Disarming later.
0b. **Triggers** (after Traps). The same kind of zone, for things that aren't hazards: someone entering, leaving, starting a round in or ending a move in it opens, closes or locks a door; turns a light or map effect on or off; plays a sound or a visual effect; reveals a secret or a discovery; stops the mover; or runs a script for anything else. Same who / how-often choices as traps; always hidden from players. Replaces writing ON … DO position scripts for the common cases, and gets checked each second of a round (ON triggers only run at the end of one).

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
    - Open-ground routes arc off the straight line (3,5 → 7,5 goes via 5,3): `reachableSquares` keeps the first-found of several equally short predecessors; prefer the straightest. Can walk someone into a lasting area. (`tests/round/movement.test.ts`)
    - Two effect rules render badly: a "when you take damage" damage trigger ("your Might increases by ? for ? rounds") and an "it takes" amount from an attribute modifier ("your:fortitude"). Not makeable in the builder; only older data. Likely moot after #0. (`tests/editing/effectGrammar.test.ts`)
    - Script ternary branches can't assign (`a ? x = 1 : x = 2`). (`tests/editing/script.test.ts`)
