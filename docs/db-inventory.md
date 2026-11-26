# lib/db.ts inventory (backlog U, step 1)

Generated 2026-11-26 from lib/db.ts (3558 lines, 357 exports). Each export is sorted into an area (the file's own section headings where it has them, else by name) and marked:

- **storage**: reads or writes the database, little else: moves as is to `lib/db/<area>.ts`.
- **pure**: no database (directly or through what it calls): moves to a rule module in `lib/`.
- **mixed?**: reaches the database and has logic of its own (or only reaches it through other functions): to split into a pure core and a thin loader, or to confirm as storage, when its area moves.
- **type**: a type or interface: moves with its area (domain types, later the shared model).

| Area | storage | pure | mixed? | types | total |
|---|---|---|---|---|---|
| Other | 17 | 3 | 0 | 2 | 22 |
| Users & logins | 6 | 3 | 0 | 2 | 11 |
| Catalog: items | 4 | 0 | 1 | 2 | 7 |
| Catalog: creatures | 2 | 0 | 1 | 1 | 4 |
| Catalog: characters | 14 | 0 | 2 | 1 | 17 |
| Catalog: professions | 14 | 0 | 0 | 3 | 17 |
| Catalog: actions | 2 | 1 | 1 | 4 | 8 |
| Locations | 3 | 0 | 0 | 1 | 4 |
| Maps: levels, structures, tiles | 28 | 0 | 3 | 3 | 34 |
| Sounds & media | 17 | 1 | 0 | 7 | 25 |
| Tokens | 12 | 0 | 2 | 2 | 16 |
| Lights, notes, controls | 14 | 0 | 0 | 3 | 17 |
| Game state changed by scripts | 7 | 0 | 0 | 3 | 10 |
| Effects | 12 | 0 | 0 | 1 | 13 |
| Calendar | 4 | 0 | 0 | 1 | 5 |
| Sessions (game nights) | 10 | 1 | 4 | 1 | 16 |
| Triggers | 6 | 0 | 0 | 1 | 7 |
| Party placement | 3 | 0 | 0 | 1 | 4 |
| Lasting areas | 7 | 1 | 6 | 0 | 14 |
| Statuses | 3 | 0 | 0 | 0 | 3 |
| Conditions, effects and modifiers (Poisoned…) | 15 | 0 | 7 | 0 | 22 |
| Effects played by scripts | 2 | 0 | 0 | 0 | 2 |
| Pings | 2 | 0 | 0 | 1 | 3 |
| Roll requests | 16 | 0 | 1 | 2 | 19 |
| Secrets | 9 | 0 | 0 | 2 | 11 |
| Round plans | 12 | 0 | 1 | 1 | 14 |
| The GM's map | 6 | 0 | 2 | 1 | 9 |
| Containers | 3 | 0 | 2 | 1 | 6 |
| Traps (lib/traps.ts) | 10 | 0 | 0 | 0 | 10 |
| Map triggers (lib/triggers.ts) | 7 | 0 | 0 | 0 | 7 |
| **All** | 267 | 10 | 33 | 47 | 357 |

## Other

- **pure**: `DATA_DIR` (31), `db` (33), `ownerOf` (902)
- **storage**: `addColumn` (238), `getGm` (468), `listPrerequisites` (783), `saveTemplateColors` (1149), `getPartyStart` (1378), `savePartyStart` (1387), `clearPartyStart` (1391), `setStandingOrder` (1427), `clearStandingOrder` (1431), `clearStandingOrdersOn` (1436), `getStandingOrder` (1441), `listStandingOrdersOn` (1451), `setLinkPrompt` (1498), `getLinkPrompt` (1503), `clearLinkPrompt` (1512), `renameMapThing` (1749), `setMapThingOn` (1754)
- **type**: `PartyStart` (1366), `StandingMode` (1420)

## Users & logins

- **pure**: `USER_COLUMNS` (446), `hashPassword` (462), `verifyPassword` (487)
- **storage**: `createUser` (474), `changePassword` (481), `getPlayer` (493), `updatePlayer` (498), `deletePlayer` (505), `listPlayers` (515)
- **type**: `Role` (448), `User` (450)

## Catalog: items

- **mixed?**: `saveItem` (560, 16 lines)
- **storage**: `listItems` (550), `getItem` (554), `grantItem` (891), `revokeItem` (895)
- **type**: `Item` (524, 19 lines), `Equipment` (593)

## Catalog: creatures

- **mixed?**: `saveCreature` (630, 15 lines)
- **storage**: `listCreatures` (613), `getCreature` (617)
- **type**: `Creature` (577)

## Catalog: characters

- **mixed?**: `saveCharacter` (665, 18 lines), `listCharacterProfessionIds` (693)
- **storage**: `listCharacters` (655), `getCharacter` (659), `getCharacterRank` (685), `setCharacterRank` (698), `rankChain` (703), `listRanks` (750), `startingRanks` (755), `laterRanks` (793), `charactersAtRank` (804), `moveRank` (810), `deleteRank` (828), `recordSightingAt` (1554), `listCharacterSightings` (1561), `listSightings` (1566)
- **type**: `Character` (647)

## Catalog: professions

- **storage**: `listProfessionGroups` (722), `getProfessionGroup` (726), `saveProfessionGroup` (731), `listProfessions` (745), `getProfession` (759), `saveProfession` (764), `listAdvancements` (773), `deleteProfessionGroup` (844), `linkAdvancement` (849), `unlinkAdvancement` (854), `listProfessionModifiers` (865), `addProfessionModifier` (871), `removeProfessionModifier` (877), `listProfessionItems` (882)
- **type**: `ProfessionGroup` (716), `Profession` (738), `ProfessionModifier` (858)

## Catalog: actions

- **mixed?**: `saveAction` (956, 19 lines)
- **pure**: `ACTION_TARGETS` (939)
- **storage**: `listActions` (947), `removeAction` (976)
- **type**: `ActionOwnerColumn` (899), `ActionOwner` (901), `Action` (905, 31 lines), `ActionTargets` (938)

## Locations

- **storage**: `listLocations` (1022), `getLocation` (1036), `saveLocation` (1041)
- **type**: `Location` (1014)

## Maps: levels, structures, tiles

- **mixed?**: `listLevels` (1065, 24 lines), `addLevel` (1091, 16 lines), `removeLevel` (1108, 20 lines)
- **storage**: `setLayerVisible` (1129), `saveBackground` (1137), `saveMapImage` (1141), `saveGrid` (1145), `listTiles` (1194), `addTile` (1203), `getTileLevel` (1209), `moveTile` (1213), `deleteTile` (1217), `listStructures` (1236), `addStructure` (1245), `deleteStructure` (1253), `setStructureEnds` (1258), `splitStructure` (1266), `deleteLevelStructures` (1280), `isPortraitLevel` (1325), `isGridlessLevel` (1331), `getLevelPlace` (1358), `setLevelAmbient` (1613), `getLevelAmbient` (1621), `saveFigureHeight` (1702), `saveHideWalls` (1706), `saveIllumination` (1710), `getIllumination` (1758), `setDoorOpen` (1767), `setDoorLocked` (1772), `setLockDc` (1778), `getDoor` (1783)
- **type**: `MapLevel` (1049), `MapTile` (1183), `MapStructure` (1221)

## Sounds & media

- **pure**: `ASSET_USAGES` (1153)
- **storage**: `getAssetUrl` (1166), `listAssets` (1168), `addAsset` (1174), `getAssetIdByUrl` (1178), `listAmbientSounds` (1589), `addAmbientSound` (1631), `deleteAmbientSound` (1635), `addAmbientClip` (1642), `setClipMode` (1646), `deleteAmbientClip` (1650), `listPositionalSounds` (1667), `addPositionalSound` (1676), `setPositionalLoop` (1682), `movePositionalSound` (1686), `setPositionalRadius` (1690), `deletePositionalSound` (1694), `setSoundVolume` (1698)
- **type**: `AssetType` (1154), `AssetUsage` (1155), `Asset` (1157), `AmbientClip` (1574), `AmbientSound` (1582), `SharedAmbient` (1610), `PositionalSound` (1655)

## Tokens

- **mixed?**: `listTokens` (1301, 15 lines), `moveTokenToLevel` (1520, 17 lines)
- **storage**: `addCreatureToken` (1318), `getTokenLevel` (1336), `placeCharacterToken` (1344), `deleteToken` (1395), `getTokenTarget` (1400), `setTokenTarget` (1404), `clearTokenTargets` (1409), `moveToken` (1413), `addTokenWalk` (1475), `listTokenWalks` (1480), `getPlayerToken` (1792), `getTokenActor` (1802)
- **type**: `MapToken` (1285, 15 lines), `ActorToken` (1801)

## Lights, notes, controls

- **storage**: `listLights` (1727), `addLight` (1733), `updateLight` (1742), `deleteLight` (1762), `listNotes` (1822), `addNote` (1826), `updateNoteText` (1833), `deleteNote` (1837), `resizeNote` (1841), `listControls` (1854), `addControl` (1858), `getControlScript` (1864), `saveControlScript` (1868), `deleteControl` (1872)
- **type**: `LightSource` (1714), `MapNote` (1813), `MapControl` (1846)

## Game state changed by scripts

- **storage**: `listCharacterStates` (1889), `saveCharacterState` (1899), `getVars` (1905), `saveVars` (1910), `transaction` (1917), `getEncounter` (1925), `saveEncounter` (1933)
- **type**: `CharacterState` (1878), `VarValue` (1903), `EncounterRow` (1919)

## Effects

- **storage**: `listEffects` (1958), `addEffect` (1962), `updateEffect` (1970), `moveEffect` (1974), `setEffectIntensity` (1978), `deleteEffect` (1982), `isInParty` (1986), `setInParty` (1990), `getCharacterPlayer` (1995), `setCharacterPlayer` (1999), `listPartyMembers` (2004), `listPlayerCharacters` (2009)
- **type**: `MapEffect` (1946)

## Calendar

- **storage**: `getGameTime` (2016), `setGameTime` (2020), `listTimers` (2030), `saveTimers` (2035)
- **type**: `Timer` (2024)

## Sessions (game nights)

- **mixed?**: `getOpenGameSession` (2092), `gmPlayedPlayers` (2141), `isRemovedFrom` (2146), `getGameSession` (2162)
- **pure**: `PRESENCE_MS` (2109)
- **storage**: `listGameSessions` (2083), `beginGameSession` (2097), `markPresent` (2102), `listPresentPlayers` (2112), `sessionMembers` (2130), `setSessionMember` (2135), `endGameSession` (2148), `logSessionEvent` (2153), `listSessionEvents` (2158), `startGameSession` (2167)
- **type**: `GameSession` (2071)

## Triggers

- **storage**: `addTrigger` (2192), `listActiveTriggers` (2199), `listTriggers` (2203), `setTriggerState` (2208), `setTriggerError` (2213), `deleteTrigger` (2217)
- **type**: `Trigger` (2176)

## Party placement

- **storage**: `getPartyPlacement` (2234), `getCurrentLevelId` (2249), `getPlayerTokenLevelId` (2264)
- **type**: `UnplacedCharacter` (2223)

## Lasting areas

- **mixed?**: `inFog` (2307), `listHazards` (2321), `igniteAreas` (2337), `spreadFire` (2347), `setLastingAreaOff` (2356), `setLastingAreaFound` (2364)
- **pure**: `FOG_SIGHT_FT` (2304)
- **storage**: `addLastingArea` (2286), `getExposures` (2294), `saveExposures` (2298), `getLastingArea` (2331), `updateLastingArea` (2372), `listLastingAreas` (2378), `removeLastingArea` (2385)

## Statuses

- **storage**: `addTokenStatus` (2400), `listTokenStatuses` (2406), `removeTokenStatus` (2415)

## Conditions, effects and modifiers (Poisoned…)

- **mixed?**: `getEffectDef` (2488), `getCondition` (2493), `migrateConditions` (2589, 62 lines), `seedCatalogEffects` (2667, 21 lines), `settleEffects` (2690), `leaveAreaAfflictions` (2802), `addAffliction` (2812, 15 lines)
- **storage**: `getStandingEffects` (2422), `setStandingEffects` (2427), `listEffectDefs` (2480), `saveEffectDef` (2502), `removeEffectDef` (2513), `settleSpeeds` (2698), `getStrain` (2723), `addStrain` (2727), `restStrain` (2734), `listAuraPasses` (2766), `saveAuraPasses` (2769), `listAfflictions` (2784), `saveAfflictions` (2793), `removeAffliction` (2829), `afflictedLevels` (2836)

## Effects played by scripts

- **storage**: `addMapFx` (2850), `listMapFx` (2856)

## Pings

- **storage**: `addPing` (2879), `listPings` (2888)
- **type**: `Ping` (2877)

## Roll requests

- **mixed?**: `settleInitiative` (3039)
- **storage**: `setHidden` (2938), `clearHidden` (2942), `listHidden` (2947), `setAssist` (2960), `listAssists` (2964), `clearAssist` (2971), `assistOpenRequest` (2988), `requestRoll` (3001), `getOpenRollRequest` (3010), `openInitiativeRequest` (3016), `openRollOffRequest` (3022), `openConditionSaveRequest` (3028), `closeRollOffRequests` (3034), `saveRollResult` (3047), `closeRollRequest` (3051), `characterModifiers` (3056)
- **type**: `RollRequest` (2908), `RollAction` (2918)

## Secrets

- **storage**: `listSecrets` (3088), `addSecret` (3092), `deleteSecret` (3096), `setSecretRevealed` (3100), `walkToken` (3105), `getEncounterWaiting` (3111), `setEncounterWaiting` (3116), `getPendingRound` (3130), `setPendingRound` (3135)
- **type**: `MapSecret` (3078), `PendingRound` (3122)

## Round plans

- **mixed?**: `tokenLabels` (3204)
- **storage**: `getRoundPlan` (3152), `setPlanRolled` (3158), `rollingTokens` (3165), `saveRoundPlan` (3169), `readyTokens` (3176), `clearRoundPlans` (3180), `getTokenMover` (3185), `getLastRoundLog` (3194), `setLastRoundLog` (3199), `getReplay` (3217), `setReplay` (3222), `getRoundStories` (3237)
- **type**: `RoundStory` (3230)

## The GM's map

- **mixed?**: `deleteCharacter` (3273, 15 lines), `listPlanTargets` (3298, 18 lines)
- **storage**: `setGmViewLevel` (3247), `getGmLevelId` (3252), `listPlayerPlaces` (3258), `characterPlayers` (3290), `listPlanRoutes` (3318), `downTokens` (3327)
- **type**: `PlanTarget` (3297)

## Containers

- **mixed?**: `addToContainer` (3372, 23 lines), `takeCarried` (3405)
- **storage**: `characterContainers` (3356), `takeFromStack` (3397), `setTokenAllegiance` (3417)
- **type**: `ContainerStack` (3349)

## Traps (lib/traps.ts)

- **storage**: `listTraps` (3449), `getTrap` (3453), `addTrap` (3459), `saveTrap` (3464), `moveTrap` (3470), `deleteTrap` (3474), `setTrapFound` (3479), `trapSeenBy` (3484), `markTrapSprung` (3491), `resetTrap` (3497)

## Map triggers (lib/triggers.ts)

- **storage**: `listMapTriggers` (3521), `getMapTrigger` (3525), `addMapTrigger` (3531), `saveMapTrigger` (3536), `deleteMapTrigger` (3541), `markMapTriggerSprung` (3546), `resetMapTrigger` (3552)

