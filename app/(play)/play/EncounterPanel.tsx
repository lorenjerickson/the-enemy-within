import { downTokens, characterPlayers, getGmLevelId, getEncounter, getEncounterWaiting, getLastRoundLog, getReplay, listTokens, readyTokens, rollingTokens, tokenLabels, listLastingAreas, getGameTime, listTokenStatuses } from "@/lib/db";
import { endEncounter, gmRollInitiativeFor, resolveRound, rollInitiative, removeLasting } from "./gmActions";
import { planView } from "@/lib/roundPlanServer";
import CreaturePlans from "./CreaturePlans";
import TurnOrder from "./TurnOrder";
import { describeStatus } from "@/lib/status";
import { gearActions } from "@/lib/combat";
import RoundScrubber from "./RoundScrubber";
import { allegianceOf } from "@/lib/sides";

/** The GM's Encounter tool: call for initiative on the party's map, and the turn order as rolls come in. */
export default function EncounterPanel() {
  const levelId = getGmLevelId();
  const enc = levelId === undefined ? undefined : getEncounter(levelId);
  const waiting = levelId === undefined ? [] : getEncounterWaiting(levelId);
  const ready = levelId === undefined ? new Set<number>() : readyTokens(levelId);
  const rolling = levelId === undefined ? new Set<number>() : rollingTokens(levelId);
  const down = levelId === undefined ? new Set<number>() : downTokens(levelId); // sit out planning until revived
  const statuses: ReturnType<typeof listTokenStatuses> = levelId === undefined ? new Map() : listTokenStatuses(levelId);
  // Tokens by id; several with the same name get numbers (Human 1, Human 2) so the GM can tell them apart.
  const labels = levelId === undefined ? new Map<number, string>() : tokenLabels(levelId);
  const names = new Map(
    (levelId === undefined ? [] : listTokens(levelId)).map((t) => [t.id, { name: labels.get(t.id)!, player: (t.character_id !== null && characterPlayers().get(t.character_id)) || null, allegiance: allegianceOf(t), character_id: t.character_id }])
  );
  return (
    <div className="space-y-3 text-sm" data-encounter-panel>
      <form action={rollInitiative}>
        <button className="btn btn-primary btn-sm w-full">{enc ? "Roll initiative again" : "Roll initiative"}</button>
      </form>
      <p className="text-xs opacity-60">Players on this map are asked to roll; your creatures roll straight away. Movement is limited while the encounter runs.</p>
      {enc && (
        <>
          <div className="flex items-center font-semibold">
            Round {enc.round}
            {waiting.length > 0 && (
              <form action={gmRollInitiativeFor.bind(null, null)} className="ml-auto">
                <button className="btn btn-xs" data-roll-for-all title="Roll initiative for everyone still rolling">Roll for the {waiting.length} still rolling</button>
              </form>
            )}
          </div>
          <TurnOrder
            rows={[
              ...enc.order.map((o, i) => ({ tokenId: o.token_id, initiative: o.initiative, turn: i === enc.turn })),
              ...waiting.map((id) => ({ tokenId: id, initiative: null, turn: false })),
            ].map((r) => ({ ...r, name: names.get(r.tokenId)?.name ?? "(gone)", player: names.get(r.tokenId)?.player ?? null, down: down.has(r.tokenId), ready: ready.has(r.tokenId), rolling: rolling.has(r.tokenId), statuses: (statuses.get(r.tokenId) ?? []).map((s) => ({ source: s.source, text: describeStatus(s) })) }))}
          />
          <CreaturePlans
            targets={[...names].map(([id, n]) => ({ id, name: n.name, allegiance: n.allegiance, character_id: n.character_id }))}
            creatures={[...enc.order.map((o) => o.token_id), ...waiting]
              .filter((id) => names.get(id) && !down.has(id))
              .flatMap((id) => {
                const v = planView(id);
                return v ? [{ tokenId: id, name: names.get(id)!.name, player: names.get(id)!.player, plan: { steps: v.steps, used: v.used, ready: v.ready }, gear: v.gear, refits: v.refits, allegiance: names.get(id)!.allegiance }] : [];
              })}
          />
          {levelId !== undefined && listLastingAreas(levelId).length > 0 && (
            <div className="space-y-1 rounded-box bg-base-100/50 p-2 text-xs" data-lasting-areas>
              <div className="font-semibold">Lasting areas</div>
              {listLastingAreas(levelId).map((l) => {
                const rounds = Math.max(1, Math.round((l.ends - getGameTime()) * 10));
                return (
                  <form key={l.id} action={removeLasting.bind(null, l.id)} className="flex items-center gap-2">
                    <span className="flex-1">{l.name} <span className="opacity-60">({rounds < 10 ? `${rounds} round${rounds === 1 ? "" : "s"}` : `${Math.round(rounds / 10)} min`} left)</span></span>
                    <button className="btn btn-ghost btn-xs">Remove</button>
                  </form>
                );
              })}
            </div>
          )}
          <form action={resolveRound} className="space-y-1">
            {(() => {
              const notReady = [...enc.order.map((o) => o.token_id), ...waiting].filter((id) => !ready.has(id) && !down.has(id)).length;
              return (
                <>
                  <button className="btn btn-primary btn-sm w-full" data-resolve-round>Resolve round {enc.round}</button>
                  {notReady > 0 && <p className="text-xs opacity-60">{notReady} not ready yet; their plans so far will be used.</p>}
                </>
              );
            })()}
          </form>
          {levelId !== undefined && (() => {
            const r = getReplay(levelId);
            return r ? <RoundScrubber round={r.round} seconds={r.frames.length} /> : null;
          })()}
          {levelId !== undefined && getLastRoundLog(levelId).length > 0 && (
            <div className="space-y-1 rounded-box bg-base-100/50 p-2 text-xs" data-round-log>
              {getLastRoundLog(levelId).map((line, i) => (
                <p key={i} className={i === 0 ? "font-semibold" : line.includes("GM to decide") ? "text-warning" : ""}>{line}</p>
              ))}
            </div>
          )}
          <form action={endEncounter}>
            <button className="btn btn-ghost btn-sm text-error">End encounter</button>
          </form>
        </>
      )}
    </div>
  );
}
