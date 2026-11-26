import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAssetUrl, getLevelAmbient, listLastingAreas, getTokenActor, type ActorToken, getGmLevelId, getGameTime, getLevelPlace, getOpenGameSession, getPlayerTokenLevelId, listLevels, listPlayerCharacters, listSightings, getPlayerToken, getLinkPrompt, getStandingOrder, listMapTriggers, listStructures, getOpenRollRequest, getEncounter, getRoundPlan, listTokens, tokenLabels, listPlanTargets, listPlanRoutes, downTokens, listTimers, listTriggers, markPresent, getReplay, characterContainers, gmPlayedPlayers, isRemovedFrom, listPlayers, type GameSession, type User } from "@/lib/db";
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
import CharacterSheet from "./CharacterSheet";
import AreaSounds from "./AreaSounds";
import SharedAmbient from "./SharedAmbient";
import ImprovisingCard from "./ImprovisingCard";
import ImproviseResult from "./ImproviseResult";
import type { ImproviseChoices } from "./ImproviseWindow";
import { listLights, listEffects, listSecrets, listTraps, listEffectDefs } from "@/lib/db";
import { listDiscoveries } from "@/lib/story";
import { listLibraryScripts } from "@/lib/scriptLibrary";
import type { PlanStep } from "@/lib/roundPlan";
import { agreedImprovisation, improvisationResult, listAgreedImprovisations, listOpenImprovisations, openImprovisation, templateOf, waitingOnTemplate } from "@/lib/improvise";
import GmSheetPanel from "./GmSheetPanel";
import { sheetFor } from "@/lib/sheet";
import { seenFrom } from "@/lib/sight";
import { allegianceOf } from "@/lib/sides";
import { planClock } from "./planClock";
import { interactablesNear } from "@/lib/triggers";
import { playerStory } from "@/lib/roundStory";
import PlayerPresence from "../../(app)/sessions/PlayerPresence";
import { playAs } from "../../(app)/sessions/actions";
import PlanRollPrompt from "./PlanRollPrompt";
import { planDice, planRolls, rolledTotal } from "@/lib/planRolls";
import EncounterPanel from "./EncounterPanel";
import ContestModal from "./ContestModal";
import SaveWaitModal from "./SaveWaitModal";
import { getPendingRound, getCharacterPlayer, getTokenTarget, getRoundStories, listCharacterSightings } from "@/lib/db";
import { canShakeOff, restrictionsOn, speedFps } from "@/lib/creatureChanges";
import { ROUND_SECONDS } from "@/lib/roundPlan";
import LocationsPanel from "./LocationsPanel";
import HealthPanel from "./HealthPanel";
import { afterRefits, onBelt, planEnd, timeline } from "@/lib/roundPlan";
import { planView } from "@/lib/roundPlanServer";
import { attackRange, gearActions, putOptions, refitOptions, tokenWho } from "@/lib/combat";
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
  return user.role === "gm" && !user.actingToken ? <GmView session={session} /> : <PlayerView session={session} user={user} />;
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
  const enc = getEncounter(levelId!);
  const pending = enc ? getPendingRound(levelId!) : null;
  const contest = pending?.contest ?? null; // a contested move waiting on the GM's call
  // Whose players a roll-off is waiting on, by token.
  const contestPlayers = Object.fromEntries(
    listTokens(levelId!).filter((t) => contest && (t.id === contest.a.id || t.id === contest.b.id) && t.character_id).flatMap((t) => {
      const p = listPlayers().find((u) => u.id === getCharacterPlayer(t.character_id!));
      return p ? [[t.id, p.name]] : [];
    })
  );
  return (
    <>
      {/* Players move their own tokens now, so the GM's map keeps up. */}
      <AutoRefresh />
      <GmSheetPanel />
      <ImprovisingCard asks={listOpenImprovisations(levelId!).map((i) => ({ id: i.id, intent: i.intent, who: tokenLabels(levelId!).get(i.token_id) ?? "Someone" }))} choices={improviseChoices(levelId!)}
        agreed={listAgreedImprovisations(levelId!).map((i) => {
          const t = templateOf(i), me = listTokens(levelId!).find((x) => x.id === i.token_id);
          const state = t && !i.placed ? "waiting for them to place it" : t && !i.agreed?.go ? "placed: move it or go ahead" : getEncounter(levelId!) ? "for their plan (rolled with it)" : i.agreed?.roll && !i.rolled ? "waiting for their roll" : "playing out";
          return { id: i.id, who: tokenLabels(levelId!).get(i.token_id) ?? "Someone", name: i.agreed?.name ?? "", state, template: t && me && !i.agreed?.go && i.placed ? { template: t, from: { x: me.col + 0.5, y: me.row + 0.5 } } : null };
        })} />
      <AreaSounds sounds={listLastingAreas(levelId!).filter((l) => l.sound).flatMap((l) => { const url = getAssetUrl(l.sound!); return url ? [{ id: l.id, url }] : []; })} />
      {contest && <ContestModal contest={contest} rolloff={pending?.rolloff} players={contestPlayers} />}
      {pending?.save && <SaveWaitModal save={pending.save} player={(() => { const t = listTokens(levelId!).find((x) => x.id === pending.save!.tokenId); const pid = t?.character_id ? getCharacterPlayer(t.character_id) : null; return listPlayers().find((u) => u.id === pid)?.name ?? null; })()} />}
      <LevelMap switchable="all" locationId={place.location_id} level={levels.find((l) => l.id === levelId)!} levels={levels} dock={{ side: "left", tools, initial: "map" }} contest={contest} planTargets={enc ? listPlanTargets(levelId!) : []} planRoutes={enc ? listPlanRoutes(levelId!) : []} />
    </>
  );
}

/**
 * What an actor on the map sees and does: a player's own character; or the GM acting as someone (an absent player
 * they play, a present player they only watch, or a creature of theirs, which sees through its own eyes).
 */
function PlayerView({ session, user }: { session: GameSession; user: User }) {
  const real = user.role === "player" && !user.playedBy; // the player themselves (the GM acting as them doesn't make them present)
  if (real) markPresent(session.id, user.id);
  const creature = user.role === "gm" ? user.actingToken ?? null : null; // the GM playing a creature: its token
  const me: ActorToken | undefined = creature !== null ? getTokenActor(creature) : getPlayerToken(user.id);
  const levelId = creature !== null ? me?.level_id : getPlayerTokenLevelId(user.id);
  const place = levelId === undefined ? undefined : getLevelPlace(levelId);
  const roll = creature !== null ? undefined : getOpenRollRequest(user.id); // a roll they're being asked to make (a creature's roll themselves)
  const watching = !!user.watching; // the GM watching a present player: everything shown, nothing can be done
  const gmHere = !!user.playedBy || creature !== null; // the GM: their controls on the sheet
  // In an encounter: their round plan (laid out in time) and where it leaves them.
  const walking: number = me ? speedFps(me.token_id, me.movement) : 0; // walking speed, feet per second, as boosted now
  const running: number = me ? speedFps(me.token_id, me.movement, "running") : 0; // Dash speed, feet per second (as boosted now)
  const isDown = !!me && downTokens(me.level_id).has(me.token_id); // down: sits out planning until revived
  const rp = me && !isDown && getEncounter(me.level_id) ? getRoundPlan(me.level_id, me.token_id) : null;
  // Who they can see (to pick who to attack): other tokens in their line of sight.
  const targets = me && !isDown
    ? (() => {
        if (!rp) { // out of an encounter: who they can see now (to follow, pursue or evade)
          const seen = seenFrom(me.level_id, { col: me.col, row: me.row }, me.token_id), labels = tokenLabels(me.level_id);
          return listTokens(me.level_id).filter((t) => t.id !== me.token_id && seen.has(t.id)).map((t) => ({ id: t.id, name: labels.get(t.id)!, allegiance: t.allegiance, character_id: t.character_id }));
        }
        // Who they could see from where their plan has them by then (only they can be aimed at).
        const seen = seenFrom(me.level_id, planEnd(rp.plan, { col: me.col, row: me.row }), me.token_id);
        const labels = tokenLabels(me.level_id);
        return listTokens(me.level_id).filter((t) => seen.has(t.id)).map((t) => ({ id: t.id, name: labels.get(t.id)!, allegiance: t.allegiance, character_id: t.character_id }));
      })()
    : [];
  // Who they have selected as their target this round, if they can see them and they're still up.
  const selectedTarget = me && rp ? (() => { const id = getTokenTarget(me.token_id); return id !== null && targets.some((t) => t.id === id) && !downTokens(me.level_id).has(id) ? id : null; })() : null;
  // Their gear as the plan leaves it: a planned refit counts for what they plan after it.
  const equipped = me ? afterRefits(tokenWho(me.token_id)?.equipment ?? {}, rp?.plan ?? []) : {};
  // The dice their plan needs (rolled before Ready), with what they came to once rolled.
  const diceRolls = rp && me ? planRolls(me.token_id, rp.plan).map((r) => {
    const s = rp.plan[r.step], dice = s.kind === "action" ? s.dice?.[r.key] : undefined;
    return { spec: r.spec, want: planDice(r.spec), ...(dice ? { result: rolledTotal(r.spec, dice) } : {}) };
  }) : [];
  // The last round's playback, and every round of the encounter told from their side (no numbers; only what involved them).
  const replay = me ? getReplay(me.level_id) : null;
  const roundHistory = me && getEncounter(me.level_id) ? (() => {
    const labels = tokenLabels(me.level_id);
    const mine = creature !== null ? [creature] : listTokens(me.level_id).filter((t) => t.character_id !== null && listPlayerCharacters(user.id).some((c) => c.id === t.character_id)).map((t) => t.id);
    const stories = getRoundStories(me.level_id);
    if (replay && !stories.some((r) => r.round === replay.round)) stories.push({ round: replay.round, showAt: replay.starts + (replay.frames.length + 1) * 1000, story: replay.story ?? [] }); // resolved before rounds were kept
    return stories.map((r) => ({ round: r.round, showAt: r.showAt, lines: [...playerStory(r.story, mine, (id) => labels.get(id) ?? "someone").values()].flat() }));
  })() : [];
  const plan = rp && me ? { ...timeline(rp.plan, walking), ready: rp.ready, from: planEnd(rp.plan, { col: me.col, row: me.row }) } : null;
  // Doors within reach of their character (Interact: open, close; a locked one can be picked).
  const doorsNearby = me
    ? listStructures(me.level_id)
        .filter((s) => s.kind === "door" && distanceToDoor(plan ? { x: plan.from.col + 0.5, y: plan.from.row + 0.5 } : { x: me.col + 0.5, y: me.row + 0.5 }, s) <= REACH) // in a round: from where the plan leaves them
        .map((s) => ({ id: s.id, name: s.name ?? `Door ${s.id}`, open: !!s.open, locked: !!s.locked }))
    : [];
  // Levers, switches and objects (interactable map triggers) within reach, by name.
  const interactables = me
    ? interactablesNear(listMapTriggers(me.level_id), me.token_id, allegianceOf(listTokens(me.level_id).find((t) => t.id === me.token_id) ?? { character_id: me.character_id }), plan ? { x: plan.from.col + 0.5, y: plan.from.row + 0.5 } : { x: me.col + 0.5, y: me.row + 0.5 }, REACH)
    : [];
  // Whose eyes the map is seen through: a player's characters on this map, or the creature the GM plays.
  const viewers = creature !== null ? [creature] : levelId === undefined ? [] : listTokens(levelId).filter((t) => t.character_id !== null && listPlayerCharacters(user.id).some((c) => c.id === t.character_id)).map((t) => t.id);
  const allTools: DockTool[] = [
    {
      id: "me",
      label: creature !== null ? (me ? tokenLabels(me.level_id).get(me.token_id) ?? me.name : "Creature") : user.name,
      icon: "user",
      content: (
        <div className="space-y-2 text-sm">
          <p>Session {session.number}</p>
          {place && <p className="opacity-70">{place.location} › {place.level}</p>}
          {/* Their character sheet(s): art (click for the full picture), health, effects, equipment and what they carry. */}
          {creature !== null && (() => { const sheet = sheetFor(creature); return sheet ? <CharacterSheet sheet={sheet} manage={{ gm: true, locked: null }} /> : null; })()}
          {(creature !== null ? [] : listPlayerCharacters(user.id)).map((c) => {
            const t = levelId === undefined ? undefined : listTokens(levelId).find((x) => x.character_id === c.id);
            const sheet = t && sheetFor(t.id);
            return sheet ? <CharacterSheet key={c.id} sheet={sheet} manage={{ gm: gmHere, locked: gmHere ? null : levelId !== undefined && getEncounter(levelId) ? "In an encounter, swap gear with Refit (a bonus action)." : null }} /> : <p key={c.id} className="font-semibold">{c.name} <span className="font-normal opacity-60">(not on the map)</span></p>;
          })}
          {real ? <Link href="/" className="btn btn-sm">Leave</Link> : <SwitchPlayers session={session} user={user} />}
        </div>
      ),
    },
    { id: "actions", label: "Actions", icon: "bolt" as const, content: <PickLock improvising={me ? openImprovisation(me.token_id)?.intent ?? null : null} agreed={me ? agreedView(me.token_id, rp?.plan ?? []) : null} planClock={me && rp ? (() => { const c = planClock(me.level_id); return c && c.tokenId === me.token_id ? c.endsAt : null; })() : null} running={running} standing={me && !getEncounter(me.level_id) ? (() => { const o = getStandingOrder(me.token_id); return o ? { mode: o.mode, name: tokenLabels(me.level_id).get(o.targetId) ?? "someone" } : null; })() : null} down={isDown} gear={me ? gearActions(me.token_id, equipped, { packs: !rp, onBelt: onBelt(rp?.plan ?? []) }) : []} refits={me && rp ? refitOptions(me.token_id, equipped) : []} puts={me && rp ? putOptions(me.token_id, equipped, rp.plan) : undefined} dice={rp ? { count: diceRolls.length, rolled: rp.rolled } : undefined} attackRange={me ? attackRange(me.token_id, equipped) : 1} lastRound={replay ? { round: replay.round, seconds: replay.frames.length, endsAt: replay.starts + (replay.frames.length + 1) * 1000 } : null} self={me ? { id: me.token_id, name: tokenLabels(me.level_id).get(me.token_id) ?? me.name, allegiance: allegianceOf(listTokens(me.level_id).find((t) => t.id === me.token_id) ?? { character_id: me.character_id }) } : null} targets={targets} selected={selectedTarget} history={roundHistory} forbidden={me ? restrictionsOn(me.token_id, me.level_id).forbid : {}} shakeable={!!me && canShakeOff(me.token_id, me.level_id)} plan={plan && { steps: plan.steps.map((s) => ({ ...s.step, start: s.start, end: s.end })), used: plan.used, ready: plan.ready }} doors={doorsNearby} things={interactables} onMap={!!me} freeMovement={!!me && !getEncounter(me.level_id)} moveLeft={me ? Math.floor(Math.max(0, walking * ROUND_SECONDS - me.moved)) : 0} /> },
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
  // A creature keeps no journal. Watching: every control in their panels is shown but can't be used.
  const tools = allTools.filter((t) => creature === null || t.id !== "journal").map((t) => (watching ? { ...t, content: <fieldset disabled className="contents" data-watching>{t.content}</fieldset> } : t));
  return (
    <>
      {/* Waiting on an improvisation: refresh every second, so its outcome shows as soon as the GM settles it. */}
      <AutoRefresh checkIn={real ? checkIn : undefined} seconds={me && (openImprovisation(me.token_id) || agreedImprovisation(me.token_id)) ? 1 : 3} />
      <ImproviseResult result={me ? improvisationResult(me.token_id) ?? null : null} />
      {/* The GM's ambient sound on their level, on their own speakers (the GM acting as someone already hears it). */}
      {real && levelId !== undefined && <SharedAmbient ambient={getLevelAmbient(levelId)} />}
      {!real && <ActingAs session={session} user={user} name={creature !== null && me ? tokenLabels(me.level_id).get(me.token_id) ?? me.name : user.name} />}
      {/* Watching: their prompts show as they see them, but can't be rolled. */}
      <fieldset disabled={watching} className="contents">
        {rp && me && <PlanRollPrompt key={getEncounter(me.level_id)?.round ?? 0} rolls={diceRolls} rolled={rp.rolled} />}
        <RollPrompt key={roll?.id} request={roll ? { id: roll.id, spec: roll.spec, result: roll.result } : null} />
      </fieldset>
      {place ? (
        <LevelMap readOnly switchable={real ? null : "side"} linkPrompt={me ? getLinkPrompt(me.token_id) ?? null : null} selectedTarget={selectedTarget} replayName={me?.name ?? null} planTargets={me && rp ? listPlanTargets(me.level_id, me.token_id) : []} planRoutes={me && rp ? listPlanRoutes(me.level_id, me.token_id) : []} fog={{ viewers, explored: creature !== null ? [] : listSightings(user.id, levelId!), move: me && !watching ? (plan ? { tokenId: me.token_id, feet: plan.left * walking, free: false, from: plan.from, perSecond: walking, runPerSecond: running } : { tokenId: me.token_id, feet: Math.max(0, walking * ROUND_SECONDS - me.moved), free: true }) : null }} locationId={place.location_id} level={listLevels(place.location_id).find((l) => l.id === levelId)!} levels={listLevels(place.location_id)} dock={{ side: "right", tools: tools.filter((t) => t.id === "actions"), initial: "actions", opposite: { tools: tools.filter((t) => t.id !== "actions"), initial: "me" } }} />
      ) : (
        <>
          <NoMap><span data-waiting-placement>The session has begun. The GM is placing you on the map…</span></NoMap>
          <PlayDock side="right" tools={tools} />
        </>
      )}
    </>
  );
}

/** The GM acting as someone (playing an absent player or a creature, or watching a present player): who, the absent players they could switch to, and back to the GM (or click another token). */
function ActingAs({ session, user, name }: { session: GameSession; user: User; name: string }) {
  return (
    <div data-acting-as className={`fixed left-1/2 top-2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-box px-3 py-1 text-sm shadow ${user.watching ? "bg-warning/90 text-warning-content" : "bg-info/90 text-info-content"}`}>
      <span>{user.watching ? <>Watching <b>{name}</b> (they&apos;re playing: look, don&apos;t touch)</> : <>Playing as <b>{name}</b></>}</span>
      <SwitchPlayers session={session} user={user} />
    </div>
  );
}

/** Switch to another absent player the GM plays, or back to the GM. */
function SwitchPlayers({ session, user }: { session: GameSession; user: User }) {
  const others = listPlayers().filter((p) => p.id !== user.id && gmPlayedPlayers(session.id).includes(p.id));
  return (
    <div className="flex flex-wrap items-center gap-1" data-switch-players>
      {others.map((p) => (
        <form key={p.id} action={playAs.bind(null, p.id)}><button className="btn btn-xs">Play as {p.name}</button></form>
      ))}
      <form action={playAs.bind(null, null)}><button className="btn btn-xs btn-neutral">Back to GM</button></form>
    </div>
  );
}

/** What the GM's Improvise window offers on this level: map things, library scripts, catalogue effects, who's here. */
function improviseChoices(levelId: number): ImproviseChoices {
  const labels = tokenLabels(levelId);
  return {
    things: {
      door: listStructures(levelId).filter((x) => x.kind === "door").map((x) => ({ id: x.id, name: x.name || `Door ${x.id}` })),
      light: listLights(levelId).map((x) => ({ id: x.id, name: x.name ?? `Light ${x.id}` })),
      effect: listEffects(levelId).map((x) => ({ id: x.id, name: x.name })),
      secret: listSecrets(levelId).map((x) => ({ id: x.id, name: x.name })),
      trap: listTraps(levelId).map((x) => ({ id: x.id, name: x.name })),
      discovery: listDiscoveries().map((x) => ({ id: x.id, name: x.title })),
      area: listLastingAreas(levelId).map((x) => ({ id: x.id, name: x.name })),
    },
    scripts: listLibraryScripts().map((x) => x.name),
    effects: listEffectDefs().filter((e) => e.duration === "rounds").map(({ id, name }) => ({ id, name })),
    tokens: listTokens(levelId).map((t) => ({ id: t.id, name: labels.get(t.id) ?? t.name })),
  };
}

/** A token's settled improvisation as the Actions panel shows it: its name and terms, whether its roll is awaited, whether it's planned. */
function agreedView(tokenId: number, plan: PlanStep[]) {
  const i = agreedImprovisation(tokenId), a = i?.agreed;
  if (!i || !a) return null;
  const roll = a.roll ? `${a.roll.type === "check" ? a.roll.skill : `${a.roll.attribute} ${a.roll.type}`} roll` : "no roll";
  const t = templateOf(i), me = listTokens(i.level_id).find((x) => x.id === tokenId);
  return {
    name: a.name,
    terms: `${a.cost === "free" ? "costs nothing" : a.cost === "bonus" ? "your bonus action" : "your action"}, ${a.seconds} s, ${roll}`,
    template: t && me && !a.go ? { id: i.id, template: t, from: { x: me.col + 0.5, y: me.row + 0.5 }, placed: !!i.placed } : null,
    waitingRoll: !!a.roll && !i.rolled && !waitingOnTemplate(i) && !getEncounter(i.level_id), // in a round it's rolled with the plan
    planned: plan.some((s) => s.kind === "action" && s.improv?.id === i.id),
  };
}
