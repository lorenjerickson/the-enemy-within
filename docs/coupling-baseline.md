# Coupling baseline (backlog U, step 0)

Taken 2026-11-26 with `npm run coupling` (scripts/coupling.mjs), before any of U. Re-run after each step: the numbers for lib/db.ts should shrink, cycles shouldn't grow. tests/engine/purity.test.ts keeps rule modules off the database.

```
Modules: 259 · runtime imports: 878 · exports: 1470 · cycles: 2 (7 modules in them)

Most exports:
   365  lib/db.ts
    77  app/(app)/campaign/locations/actions.ts
    43  lib/conditions.ts
    31  lib/story.ts
    31  app/(play)/play/actions.ts
    30  lib/maps.ts
    27  lib/improvise.ts
    26  lib/script.ts
    26  app/(app)/campaign/locations/[id]/mapLayers.tsx
    26  app/(play)/play/gmActions.ts
    22  lib/aoe.ts
    19  lib/creatureChanges.ts

Most imported (fan-in):
   110  lib/db.ts
    59  lib/auth.ts
    30  lib/aoe.ts
    29  lib/attributes.ts
    28  lib/sides.ts
    25  lib/conditions.ts
    22  lib/visibility.ts
    18  lib/itemTypes.ts
    16  lib/roundPlan.ts
    16  lib/story.ts
    15  lib/actions.ts
    15  lib/creatureChanges.ts

Most imports (fan-out, runtime):
    47  app/(play)/play/page.tsx
    43  app/(app)/campaign/locations/[id]/MapView.tsx
    28  app/(play)/play/actions.ts
    21  app/(app)/campaign/locations/actions.ts
    21  app/(play)/play/workOutRound.ts
    20  app/(play)/play/PickLock.tsx
    17  app/(play)/play/CreaturePlans.tsx
    17  app/(play)/play/gmActions.ts
    15  lib/roundPlanServer.ts
    12  lib/resolveRound.ts
    12  app/(app)/campaign/characters/[id]/page.tsx
    11  lib/game.ts

lib/db.ts: 365 exports, imported by 110 modules (23 in lib/)

Cycles:
  2: lib/game.ts, lib/storyRules.ts
  5: app/(play)/play/areas.ts, app/(play)/play/improvising.ts, app/(play)/play/mapTriggers.ts, app/(play)/play/traps.ts, app/(play)/play/workOutRound.ts
```

## After U (2026-11-26)

lib/db.ts is gone: 17 storage modules under lib/db/ (connection.ts holds every table; migrations.ts runs at start-up from instrumentation.ts). The biggest is lib/db/tokens.ts with 58 exports, imported by 44 modules (lib/db.ts had 365, imported by 110). Rules pulled out: lib/aoe.ts (fog, fire hazards, fire spreading), lib/containers.ts, lib/fighter.ts. 55 pure lib modules pinned by tests/engine/purity.test.ts. Cycles unchanged (2).

```
Modules: 277 · runtime imports: 1079 · exports: 1476 · cycles: 2 (7 modules in them)

Most exports:
    77  app/(app)/campaign/locations/actions.ts
    58  lib/db/tokens.ts
    57  lib/db/catalog.ts
    43  lib/conditions.ts
    43  lib/db/maps.ts
    31  lib/db/mapThings.ts
    31  lib/story.ts
    31  app/(play)/play/actions.ts
    30  lib/maps.ts
    27  lib/db/media.ts
    27  lib/improvise.ts
    26  lib/aoe.ts

Most imported (fan-in):
    59  lib/auth.ts
    47  lib/db/catalog.ts
    44  lib/db/tokens.ts
    32  lib/aoe.ts
    32  lib/db/connection.ts
    31  lib/attributes.ts
    31  lib/db/maps.ts
    29  lib/sides.ts
    28  lib/conditions.ts
    23  lib/db/sessions.ts
    22  lib/db/effects.ts
    22  lib/visibility.ts

Most imports (fan-out, runtime):
    61  app/(play)/play/page.tsx
    43  app/(app)/campaign/locations/[id]/MapView.tsx
    37  app/(play)/play/actions.ts
    32  app/(app)/campaign/locations/actions.ts
    31  app/(play)/play/workOutRound.ts
    25  app/(play)/play/gmActions.ts
    22  app/(app)/campaign/locations/[id]/LevelMap.tsx
    20  lib/roundPlanServer.ts
    20  app/(play)/play/PickLock.tsx
    19  lib/game.ts
    17  app/(play)/play/CreaturePlans.tsx
    16  app/(play)/play/improvising.ts

Storage (lib/db/): 17 modules, 362 exports; biggest lib/db/tokens.ts (58), lib/db/catalog.ts (57), lib/db/maps.ts (43)

Cycles:
  2: lib/game.ts, lib/storyRules.ts
  5: app/(play)/play/areas.ts, app/(play)/play/improvising.ts, app/(play)/play/mapTriggers.ts, app/(play)/play/traps.ts, app/(play)/play/workOutRound.ts
```
