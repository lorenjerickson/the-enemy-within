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
