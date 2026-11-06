import { getCharacterPlayer, getGmLevelId, getEncounter, getEncounterWaiting, getLastRoundLog, getReplay, listTokens, readyTokens, tokenLabels } from "@/lib/db";
import { endEncounter, resolveRound, rollInitiative } from "./gmActions";
import { planView } from "@/lib/roundPlanServer";
import CreaturePlans from "./CreaturePlans";
import { gearActions } from "@/lib/combat";
import RoundScrubber from "./RoundScrubber";

/** The GM's Encounter tool: call for initiative on the party's map, and the turn order as rolls come in. */
export default function EncounterPanel() {
  const levelId = getGmLevelId();
  const enc = levelId === undefined ? undefined : getEncounter(levelId);
  const waiting = levelId === undefined ? [] : getEncounterWaiting(levelId);
  const ready = levelId === undefined ? new Set<number>() : readyTokens(levelId);
  // Tokens by id; several with the same name get numbers (Human 1, Human 2) so the GM can tell them apart.
  const labels = levelId === undefined ? new Map<number, string>() : tokenLabels(levelId);
  const names = new Map(
    (levelId === undefined ? [] : listTokens(levelId)).map((t) => [t.id, { name: labels.get(t.id)!, player: t.character_id !== null && getCharacterPlayer(t.character_id) !== null }])
  );
  return (
    <div className="space-y-3 text-sm" data-encounter-panel>
      <form action={rollInitiative}>
        <button className="btn btn-primary btn-sm w-full">{enc ? "Roll initiative again" : "Roll initiative"}</button>
      </form>
      <p className="text-xs opacity-60">Players on this map are asked to roll; your creatures roll straight away. Movement is limited while the encounter runs.</p>
      {enc && (
        <>
          <div className="font-semibold">Round {enc.round}</div>
          <ol className="space-y-1" data-turn-order>
            {enc.order.map((o, i) => (
              <li key={o.token_id} className={`flex items-center gap-2 rounded px-2 py-1 ${i === enc.turn ? "bg-primary/25" : "bg-base-100/60"}`}>
                <span className="w-6 text-right font-mono">{o.initiative}</span>
                <span className="flex-1">{names.get(o.token_id)?.name ?? "(gone)"}</span>
                {names.get(o.token_id)?.player && (
                  <span className={`badge badge-sm ${ready.has(o.token_id) ? "badge-success" : "badge-ghost"}`}>{ready.has(o.token_id) ? "ready" : "planning"}</span>
                )}
              </li>
            ))}
            {waiting.map((id) => (
              <li key={id} className="flex items-center gap-2 rounded bg-base-100/30 px-2 py-1 opacity-70">
                <span className="w-6 text-right">…</span>
                <span className="flex-1">{names.get(id)?.name ?? "(gone)"}</span>
                <span className="text-xs">rolling</span>
                <span className={`badge badge-sm ${ready.has(id) ? "badge-success" : "badge-ghost"}`}>{ready.has(id) ? "ready" : "planning"}</span>
              </li>
            ))}
          </ol>
          <CreaturePlans
            targets={[...names].map(([id, n]) => ({ id, name: n.name }))}
            creatures={enc.order
              .filter((o) => names.get(o.token_id) && !names.get(o.token_id)!.player)
              .flatMap((o) => {
                const v = planView(o.token_id);
                return v ? [{ tokenId: o.token_id, name: names.get(o.token_id)!.name, plan: { steps: v.steps, used: v.used, ready: v.ready }, gear: gearActions(o.token_id) }] : [];
              })}
          />
          <form action={resolveRound} className="space-y-1">
            {(() => {
              const notReady = [...enc.order.map((o) => o.token_id), ...waiting].filter((id) => !ready.has(id)).length;
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
