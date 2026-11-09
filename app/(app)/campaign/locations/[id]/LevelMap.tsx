import { listDiscoveries } from "@/lib/story";
import { playerReplay } from "@/lib/replayView";
import { blockingSegments } from "@/lib/visibility";
import { type PlanTarget, tokenLabels, downTokens, getCharacterPlayer, listPlayers, getReplay, listSecrets, getPartyPlacement, getPartyStart, listEffects, listCharacters, listControls, listLights, listNotes, listAmbientSounds, listPositionalSounds, listAssets, listCreatures, listStructures, listTiles, listTokens, type MapLevel, listLastingAreas } from "@/lib/db";
import { scriptNames } from "@/lib/scriptNames";
import MapView from "./MapView";
import { sensesOf } from "@/lib/creatureChanges";
import { BLIND_RANGE } from "@/lib/conditions";
import type { Contest } from "@/lib/resolveRound";
import type { DockTool } from "../../../../(play)/play/PlayDock";

/** One map level with everything on it, editable: used by the location editor and the GM's session view. */
export default function LevelMap({
  locationId,
  level,
  levels,
  readOnly = false,
  fog,
  dock,
  gmPlans,
  replayName = null,
  planTargets = [],
  planRoutes = [],
  contest = null,
  selectedTarget = null,
  planExplored,
}: {
  locationId: number;
  level: MapLevel;
  levels: MapLevel[];
  readOnly?: boolean;
  replayName?: string | null; // a player's character name (they see only playback lines about them)
  planTargets?: PlanTarget[]; // planned attacks / pursuits / evasions to draw (from where they'll be)
  planRoutes?: { token: number; points: { col: number; row: number }[] }[]; // planned moves, as trails of waypoints
  contest?: Contest | null; // a contested move waiting on the GM (GM only)
  selectedTarget?: number | null; // a player's selected target (player only)
  planExplored?: Record<number, { x: number; y: number }[]>; // GM planning as a character: where it has stood (its fog of war)
  gmPlans?: Record<number, { from: { col: number; row: number }; feetLeft: number; perSecond?: number }>; // GM planning creatures' rounds
  fog?: { viewers: number[]; explored: { x: number; y: number }[]; move?: { characterId: number; feet: number; free: boolean; from?: { col: number; row: number }; perSecond?: number } | null }; // a player's fog of war (and movement: left, and whether it's free)
  dock?: { side: "left" | "right"; tools: DockTool[]; initial?: string | null; opposite?: { tools: DockTool[]; initial?: string | null } }; // in a session: full screen, with this dock
}) {
  // A player's view gets nothing GM-only (notes, controls, scripts, sounds, the creature list).
  const gm = !readOnly;
  // A round's playback: the GM sees the full log; a player sees only their own story of it (no numbers, nothing
  // about anyone they didn't deal with). The raw events never reach a browser.
  const raw = getReplay(level.id);
  const labels = tokenLabels(level.id);
  const mine = gm ? [] : listTokens(level.id).filter((t) => t.character_id !== null && (fog?.viewers ?? []).includes(t.character_id)).map((t) => t.id);
  const replay = raw && (gm ? { ...raw, story: undefined } : playerReplay(raw, mine, (id) => labels.get(id) ?? "someone", blockingSegments(listStructures(level.id))));
  const start = getPartyStart();
  // Senses: a player doesn't get invisible tokens (unless one of their characters sees invisible things), and a blind
  // character of theirs sees only what's around it.
  const all = listTokens(level.id);
  const seeInvisible = !gm && mine.some((id) => sensesOf(id, level.id).seeInvisible);
  const tokens = gm || seeInvisible ? all : all.filter((t) => mine.includes(t.id) || !sensesOf(t.id, level.id).invisible);
  const sight = gm ? undefined : Object.fromEntries(all.filter((t) => mine.includes(t.id) && t.character_id !== null && sensesOf(t.id, level.id).blind).map((t) => [t.character_id!, BLIND_RANGE]));
  const players = new Map(gm ? listPlayers().map((u) => [u.id, u.name]) : []);
  const placement = getPartyPlacement();
  return (
    <MapView downTokens={[...downTokens(level.id)]} lasting={listLastingAreas(level.id)} planTargets={planTargets} planRoutes={planRoutes} contest={contest} selectedTarget={selectedTarget} planExplored={planExplored} replay={replay} replayName={gm ? replayName : null} gmPlans={gmPlans} fog={fog && { ...fog, sight }} secrets={gm ? listSecrets(level.id) : listSecrets(level.id).filter((s) => s.revealed).map((s) => ({ ...s, discovery_id: null }))} discoveries={gm ? listDiscoveries().map(({ id, title, text, found }) => ({ id, title, text, found })) : []} hideWalls={!!level.hide_walls} readOnly={readOnly} dockSide={dock?.side} dockTools={dock?.tools} dockInitial={dock?.initial} dockOpposite={dock?.opposite} key={level.id} locationId={locationId} levelId={level.id} hidden={level.hidden} background={level.background} mapImage={level.mapImage} grid={level.grid} templateColors={level.templateColors}
      tileAssets={gm ? listAssets({ type: "image", usage: "tile" }) : []}
      tiles={listTiles(level.id)}
      structures={listStructures(level.id)}
      tokens={tokens}
      sounds={gm ? listAmbientSounds(level.id) : []}
      positional={gm ? listPositionalSounds(level.id) : []}
      illumination={level.illumination}
      figureHeight={level.figure_height}
      lights={listLights(level.id)}
      notes={gm ? listNotes(level.id) : []}
      effects={listEffects(level.id)}
      scriptNames={gm ? scriptNames(level.id) : {}}
      controls={gm ? listControls(level.id) : []}
      audioAssets={gm ? listAssets({ type: "audio", usage: "ambient" }) : []}
      creatures={!gm ? [] : [
        ...listCharacters().map(({ id, name, type, image, token_overhead, token_side, height }) => ({
          kind: "character" as const, id, name, type, image, token_overhead, token_side, height,
          player: players.get(getCharacterPlayer(id) ?? -1) ?? null, // so same-named characters can be told apart
        })),
        ...listCreatures().map(({ id, name, type, image, token_overhead, token_side, height }) => ({ kind: "creature" as const, id, name, type, image, token_overhead, token_side, height })),
      ]}
      toPlace={gm && placement && placement.start.level_id === level.id ? placement.unplaced : []}
      partyStart={start && start.level_id === level.id ? { x: start.x, y: start.y, w: start.w, h: start.h } : null}
      partyStartElsewhere={start && start.level_id !== level.id ? `${start.location} › ${start.level}` : null}
      otherLevels={levels.filter((l) => l.id !== level.id).map(({ id, name }) => ({ id, name }))}
    />
  );
}
