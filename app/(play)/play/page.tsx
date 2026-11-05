import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCurrentLevelId, getGameTime, getLevelPlace, getOpenGameSession, getPlayerTokenLevelId, listLevels, listPlayerCharacters, listSightings, getPlayerToken, listStructures, getOpenRollRequest, getEncounter, getRoundPlan, listTokens, tokenLabels, listTimers, listTriggers, markPresent, type GameSession, type User } from "@/lib/db";
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
import EncounterPanel from "./EncounterPanel";
import { planEnd, timeline } from "@/lib/roundPlan";
import { planView } from "@/lib/roundPlanServer";
import { blockingSegments, insidePolygon, visibilityPolygon } from "@/lib/visibility";
import Journal from "../../(app)/character/Journal";
import { REACH, distanceToDoor } from "./reach";

/** The running session, full screen: the GM's tools dock on the left, a player's panel on the right. */
export default async function Play() {
  await connection();
  const user = await requireUser();
  const session = getOpenGameSession();
  if (!session?.began_at) redirect(user.role === "gm" ? (session ? `/sessions/${session.id}` : "/sessions") : "/lobby");
  return user.role === "gm" ? <GmView session={session} /> : <PlayerView session={session} user={user} />;
}

/** Shown in place of the map when there's none to show yet. */
function NoMap({ children }: { children: React.ReactNode }) {
  return <div className="flex size-full items-center justify-center p-8 text-center opacity-80">{children}</div>;
}

function GmView({ session }: { session: GameSession }) {
  const tools: DockTool[] = [
    { id: "encounter", label: "Encounter", icon: "swords", content: <EncounterPanel /> },
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
          <form action={endSession.bind(null, session.id)}>
            <button className="btn btn-sm btn-error btn-outline">End session</button>
          </form>
        </div>
      ),
    },
  ];
  const levelId = getCurrentLevelId();
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
      return v ? [[o.token_id, { from: v.from, feetLeft: v.ready ? 0 : v.feetLeft }]] : [];
    })
  );
  return (
    <>
      {/* Players move their own tokens now, so the GM's map keeps up. */}
      <AutoRefresh />
      <LevelMap locationId={place.location_id} level={levels.find((l) => l.id === levelId)!} levels={levels} dock={{ side: "left", tools, initial: "map" }} gmPlans={gmPlans} />
    </>
  );
}

function PlayerView({ session, user }: { session: GameSession; user: User }) {
  markPresent(session.id, user.id);
  const levelId = getPlayerTokenLevelId(user.id);
  const place = levelId === undefined ? undefined : getLevelPlace(levelId);
  const roll = getOpenRollRequest(user.id); // a roll they're being asked to make
  // Locked doors within reach of their character.
  const me = getPlayerToken(user.id);
  // In an encounter: their round plan (laid out in time) and where it leaves them.
  const walking: number = me ? JSON.parse(me.movement).walking ?? 0 : 0;
  const rp = me && getEncounter(me.level_id) ? getRoundPlan(me.level_id, me.token_id) : null;
  // Who they can see (to pick who to attack): other tokens in their line of sight.
  const targets = rp && me
    ? (() => {
        const seen = visibilityPolygon({ x: me.col + 0.5, y: me.row + 0.5 }, 500, blockingSegments(listStructures(me.level_id)));
        const labels = tokenLabels(me.level_id);
        return listTokens(me.level_id).filter((t) => t.id !== me.token_id && insidePolygon({ x: t.col + 0.5, y: t.row + 0.5 }, seen)).map((t) => ({ id: t.id, name: labels.get(t.id)! }));
      })()
    : [];
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
          <ul>
            {listPlayerCharacters(user.id).map((c) => (
              <li key={c.id} className="font-semibold">{c.name}</li>
            ))}
          </ul>
          <Link href="/" className="btn btn-sm">Leave</Link>
        </div>
      ),
    },
    { id: "actions", label: "Actions", icon: "bolt" as const, content: <PickLock targets={targets} plan={plan && { steps: plan.steps.map((s) => ({ ...s.step, start: s.start, end: s.end })), used: plan.used, ready: plan.ready }} doors={lockedNearby} onMap={!!me} freeMovement={!!me && !getEncounter(me.level_id)} moveLeft={me ? Math.floor(Math.max(0, (JSON.parse(me.movement).walking ?? 0) - me.moved)) : 0} /> },
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
      <RollPrompt key={roll?.id} request={roll ? { id: roll.id, spec: roll.spec, result: roll.result } : null} />
      {place ? (
        <LevelMap readOnly fog={{ viewers: listPlayerCharacters(user.id).map((c) => c.id), explored: listSightings(user.id, levelId!), move: me && (plan ? { characterId: me.character_id, feet: (plan.left * walking) / 6, free: false, from: plan.from } : { characterId: me.character_id, feet: Math.max(0, walking - me.moved), free: true }) }} locationId={place.location_id} level={listLevels(place.location_id).find((l) => l.id === levelId)!} levels={listLevels(place.location_id)} dock={{ side: "right", tools }} />
      ) : (
        <>
          <NoMap><span data-waiting-placement>The session has begun. The GM is placing you on the map…</span></NoMap>
          <PlayDock side="right" tools={tools} />
        </>
      )}
    </>
  );
}
