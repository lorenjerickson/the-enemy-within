import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getGmLevelId, getGameTime, getLevelPlace, getOpenGameSession, getPlayerTokenLevelId, listLevels, listPlayerCharacters, listSightings, getPlayerToken, listStructures, getOpenRollRequest, getEncounter, getRoundPlan, listTokens, tokenLabels, listPlanTargets, downTokens, listTimers, listTriggers, markPresent, getReplay, characterContainers, gmPlayedPlayers, isRemovedFrom, listPlayers, type GameSession, type User } from "@/lib/db";
import { triggerText } from "@/lib/game";
import { scriptNames } from "@/lib/scriptNames";
import LevelMap from "../../(app)/campaign/locations/[id]/LevelMap";
import AutoRefresh from "../../(app)/AutoRefresh";
import { CalendarPanel } from "../../(app)/sessions/CalendarPanel";
import { ScriptConsole } from "../../(app)/sessions/ScriptConsole";
import { TriggersPanel } from "../../(app)/sessions/TriggersPanel";
import { endSession } from "../../(app)/sessions/actions";
import { checkIn } from "../../(app)/lobby/actions";
import PlayDock, { type DockTool } from "./PlayDock";
import PickLock from "./PickLock";
import RollPrompt from "./RollPrompt";
import RoundSummary from "./RoundSummary";
import CharacterSheet from "./CharacterSheet";
import GmSheetPanel from "./GmSheetPanel";
import GmPlanningMode from "./GmPlanningMode";
import { sheetFor } from "@/lib/sheet";
import { allegianceOf } from "@/lib/sides";
import { playerStory } from "@/lib/roundStory";
import PlayerPresence from "../../(app)/sessions/PlayerPresence";
import { playAs } from "../../(app)/sessions/actions";
import PlanRollPrompt from "./PlanRollPrompt";
import { planDice, planRolls, rolledTotal } from "@/lib/planRolls";
import EncounterPanel, { planningData } from "./EncounterPanel";
import LocationsPanel from "./LocationsPanel";
import HealthPanel from "./HealthPanel";
import { afterRefits, planEnd, timeline } from "@/lib/roundPlan";
import { planView } from "@/lib/roundPlanServer";
import { gearActions, refitOptions, tokenWho } from "@/lib/combat";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";
import Journal from "../../(app)/character/Journal";
import { REACH, distanceToDoor } from "./reach";

/** The running session, full screen: the GM's tools dock on the left, a player's panel on the right. */
export default async function Play() {
  await connection();
  const user = await requireUser();
  const session = getOpenGameSession();
  if (!session?.began_at) redirect(user.role === "gm" ? (session ? `/sessions/${session.id}` : "/sessions") : "/lobby");
  if (user.role === "player" && isRemovedFrom(session.id, user.id)) redirect("/lobby"); // the GM left them out
  return user.role === "gm" ? <GmView session={session} /> : <PlayerView session={session} user={user} />;
}

/** Shown in place of the map when there's none to show yet. */
function NoMap({ children }: { children: React.ReactNode }) {
  return <div className="flex size-full items-center justify-center p-8 text-center opacity-80">{children}</div>;
}

function GmView({ session }: { session: GameSession }) {
  const tools: DockTool[] = [
    { id: "locations", label: "Locations", icon: "map", content: <LocationsPanel /> },
    { id: "encounter", label: "Encounter", icon: "swords", content: <EncounterPanel /> },
    { id: "health", label: "Health", icon: "heart", content: <HealthPanel /> },
    { id: "time", label: "Time", icon: "clock", content: <CalendarPanel now={getGameTime()} timers={listTimers()} /> },
    {
      id: "triggers",
      label: "Triggers",
      icon: "bolt",
      content: <TriggersPanel triggers={listTriggers().map((t) => ({ id: t.id, text: triggerText(t), fired: t.fired, error: t.error }))} />,
    },
    { id: "script", label: "Script", icon: "code", content: <ScriptConsole names={scriptNames()} /> },
    {
      id: "session",
      label: `Session ${session.number}`,
      icon: "flag",
      content: (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Link href="/campaign" className="btn btn-sm">Campaign</Link>
            <Link href="/sessions" className="btn btn-sm">Sessions</Link>
          </div>
          {/* Absent players the GM plays: switch to playing as one (and back from their screen). */}
          <div className="space-y-1" data-play-as>
            <div className="text-xs font-semibold opacity-80">Players you play</div>
            {gmPlayedPlayers(session.id).length ? (
              <div className="flex flex-wrap gap-1">
                {listPlayers().filter((p) => gmPlayedPlayers(session.id).includes(p.id)).map((p) => (
                  <form key={p.id} action={playAs.bind(null, p.id)}><button className="btn btn-xs btn-info">Play as {p.name}</button></form>
                ))}
              </div>
            ) : (
              <p className="text-xs opacity-60">None. Add absent players in the session&apos;s lobby list (Sessions › this session).</p>
            )}
          </div>
          <PlayerPresence sessionId={session.id} manage />
          <form action={endSession.bind(null, session.id)}>
            <button className="btn btn-sm btn-error btn-outline">End session</button>
          </form>
        </div>
      ),
    },
  ];
  const levelId = getGmLevelId(); // the map the GM has loaded, else the party's
  const place = levelId === undefined ? undefined : getLevelPlace(levelId);
  if (!place) {
    return (
      <>
        <NoMap>No current map: mark the party start area on a location&apos;s map (Tokens layer).</NoMap>
        <PlayDock side="left" tools={tools} initial="session" />
      </>
    );
  }
  const levels = listLevels(place.location_id);
  // In an encounter: where each of the GM's creatures' plans leaves it, and the feet it can still move (for planning moves on the map).
  const enc = getEncounter(levelId!);
  const gmPlans = Object.fromEntries(
    (enc?.order ?? []).flatMap((o) => {
      const v = planView(o.token_id);
      return v ? [[o.token_id, { from: v.from, feetLeft: v.ready ? 0 : v.feetLeft, perSecond: v.perSecond }]] : [];
    })
  );
  return (
    <>
      {/* Players move their own tokens now, so the GM's map keeps up. */}
      <AutoRefresh />
      <GmSheetPanel />
      <GmPlanningMode {...planningData()} />
      <LevelMap locationId={place.location_id} level={levels.find((l) => l.id === levelId)!} levels={levels} dock={{ side: "left", tools, initial: "map" }} gmPlans={gmPlans} planTargets={enc ? listPlanTargets(levelId!) : []} />
    </>
  );
}

function PlayerView({ session, user }: { session: GameSession; user: User }) {
  if (!user.playedBy) markPresent(session.id, user.id); // the GM playing them doesn't make them present
  const levelId = getPlayerTokenLevelId(user.id);
  const place = levelId === undefined ? undefined : getLevelPlace(levelId);
  const roll = getOpenRollRequest(user.id); // a roll they're being asked to make
  // Locked doors within reach of their character.
  const me = getPlayerToken(user.id);
  // In an encounter: their round plan (laid out in time) and where it leaves them.
  const walking: number = me ? JSON.parse(me.movement).walking ?? 0 : 0;
  const isDown = !!me && downTokens(me.level_id).has(me.token_id); // down: sits out planning until revived
  const rp = me && !isDown && getEncounter(me.level_id) ? getRoundPlan(me.level_id, me.token_id) : null;
  // Who they can see (to pick who to attack): other tokens in their line of sight.
  const targets = rp && me
    ? (() => {
        const seen = visibilityPolygon({ x: me.col + 0.5, y: me.row + 0.5 }, 500, blockingSegments(listStructures(me.level_id)));
        const labels = tokenLabels(me.level_id);
        return listTokens(me.level_id).filter((t) => t.id !== me.token_id && insidePolygon({ x: t.col + 0.5, y: t.row + 0.5 }, seen)).map((t) => ({ id: t.id, name: labels.get(t.id)!, allegiance: t.allegiance, character_id: t.character_id }));
      })()
    : [];
  // Their gear as the plan leaves it: a planned refit counts for what they plan after it.
  const equipped = me ? afterRefits(tokenWho(me.token_id)?.equipment ?? {}, rp?.plan ?? []) : {};
  // The dice their plan needs (rolled before Ready), with what they came to once rolled.
  const diceRolls = rp && me ? planRolls(me.token_id, rp.plan).map((r) => {
    const s = rp.plan[r.step], dice = s.kind === "action" ? s.dice?.[r.key] : undefined;
    return { spec: r.spec, want: planDice(r.spec), ...(dice ? { result: rolledTotal(r.spec, dice) } : {}) };
  }) : [];
  // The last round, told from their side once it has played back (no numbers; only what involved them).
  const replay = me ? getReplay(me.level_id) : null;
  const lastRound = replay && me ? (() => {
    const labels = tokenLabels(me.level_id);
    const mine = listTokens(me.level_id).filter((t) => t.character_id !== null && listPlayerCharacters(user.id).some((c) => c.id === t.character_id)).map((t) => t.id);
    return { round: replay.round, showAt: replay.starts + (replay.frames.length + 1) * 1000, lines: [...playerStory(replay.story, mine, (id) => labels.get(id) ?? "someone").values()].flat() };
  })() : null;
  const plan = rp && me ? { ...timeline(rp.plan, walking), ready: rp.ready, from: planEnd(rp.plan, { col: me.col, row: me.row }) } : null;
  const lockedNearby = me
    ? listStructures(me.level_id)
        .filter((s) => s.kind === "door" && s.locked && distanceToDoor({ x: me.col + 0.5, y: me.row + 0.5 }, s) <= REACH)
        .map((s) => ({ id: s.id, name: s.name ?? `Door ${s.id}` }))
    : [];
  const tools: DockTool[] = [
    {
      id: "me",
      label: user.name,
      icon: "user",
      content: (
        <div className="space-y-2 text-sm">
          <p>Session {session.number}</p>
          {place && <p className="opacity-70">{place.location} › {place.level}</p>}
          {/* Their character sheet(s): art (click for the full picture), health, effects, equipment and what they carry. */}
          {listPlayerCharacters(user.id).map((c) => {
            const t = levelId === undefined ? undefined : listTokens(levelId).find((x) => x.character_id === c.id);
            const sheet = t && sheetFor(t.id);
            return sheet ? <CharacterSheet key={c.id} sheet={sheet} /> : <p key={c.id} className="font-semibold">{c.name} <span className="font-normal opacity-60">(not on the map)</span></p>;
          })}
          <Link href="/" className="btn btn-sm">Leave</Link>
        </div>
      ),
    },
    { id: "actions", label: "Actions", icon: "bolt" as const, content: <PickLock down={isDown} gear={me ? gearActions(me.token_id, equipped) : []} refits={me && rp ? refitOptions(me.token_id, equipped) : []} dice={rp ? { count: diceRolls.length, rolled: rp.rolled } : undefined} lastRound={replay ? { round: replay.round, seconds: replay.frames.length, endsAt: replay.starts + (replay.frames.length + 1) * 1000 } : null} self={me ? { id: me.token_id, name: tokenLabels(me.level_id).get(me.token_id) ?? me.name, allegiance: allegianceOf(listTokens(me.level_id).find((t) => t.id === me.token_id) ?? { character_id: me.character_id }) } : null} targets={targets} plan={plan && { steps: plan.steps.map((s) => ({ ...s.step, start: s.start, end: s.end })), used: plan.used, ready: plan.ready }} doors={lockedNearby} onMap={!!me} freeMovement={!!me && !getEncounter(me.level_id)} moveLeft={me ? Math.floor(Math.max(0, (JSON.parse(me.movement).walking ?? 0) - me.moved)) : 0} /> },
    {
      id: "journal",
      label: "Journal",
      icon: "book" as const,
      content: (
        <div className="space-y-4">
          {listPlayerCharacters(user.id).map((c) => (
            <Journal key={c.id} characterId={c.id} name={c.name} inPanel />
          ))}
        </div>
      ),
    },
  ];
  return (
    <>
      <AutoRefresh checkIn={checkIn} />
      {user.playedBy && <ActingAs session={session} user={user} />}
      {lastRound && <RoundSummary key={lastRound.round} {...lastRound} />}
      {rp && <PlanRollPrompt rolls={diceRolls} rolled={rp.rolled} />}
      <RollPrompt key={roll?.id} request={roll ? { id: roll.id, spec: roll.spec, result: roll.result } : null} />
      {place ? (
        <LevelMap readOnly replayName={me?.name ?? null} planTargets={me && rp ? listPlanTargets(me.level_id, me.token_id) : []} fog={{ viewers: listPlayerCharacters(user.id).map((c) => c.id), explored: listSightings(user.id, levelId!), move: me && (plan ? { characterId: me.character_id, feet: (plan.left * walking) / 6, free: false, from: plan.from, perSecond: walking / 6 } : { characterId: me.character_id, feet: Math.max(0, walking - me.moved), free: true }) }} locationId={place.location_id} level={listLevels(place.location_id).find((l) => l.id === levelId)!} levels={listLevels(place.location_id)} dock={{ side: "right", tools: tools.filter((t) => t.id === "actions"), initial: "actions", opposite: { tools: tools.filter((t) => t.id !== "actions"), initial: "me" } }} />
      ) : (
        <>
          <NoMap><span data-waiting-placement>The session has begun. The GM is placing you on the map…</span></NoMap>
          <PlayDock side="right" tools={tools} />
        </>
      )}
    </>
  );
}

/** The GM playing an absent player: whose screen this is, the others they play, and back to the GM. */
function ActingAs({ session, user }: { session: GameSession; user: User }) {
  const others = listPlayers().filter((p) => p.id !== user.id && gmPlayedPlayers(session.id).includes(p.id));
  return (
    <div data-acting-as className="fixed left-1/2 top-2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-box bg-info/90 px-3 py-1 text-sm text-info-content shadow">
      <span>Playing as <b>{user.name}</b></span>
      {others.map((p) => (
        <form key={p.id} action={playAs.bind(null, p.id)}><button className="btn btn-xs">{p.name}</button></form>
      ))}
      <form action={playAs.bind(null, null)}><button className="btn btn-xs btn-neutral">Back to GM</button></form>
    </div>
  );
}
