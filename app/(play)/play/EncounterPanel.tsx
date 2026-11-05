import { getCurrentLevelId, getEncounter, getEncounterWaiting, listTokens } from "@/lib/db";
import { endEncounter, rollInitiative } from "./gmActions";

/** The GM's Encounter tool: call for initiative on the party's map, and the turn order as rolls come in. */
export default function EncounterPanel() {
  const levelId = getCurrentLevelId();
  const enc = levelId === undefined ? undefined : getEncounter(levelId);
  const waiting = levelId === undefined ? [] : getEncounterWaiting(levelId);
  const names = new Map(levelId === undefined ? [] : listTokens(levelId).map((t) => [t.id, { name: t.name, player: t.character_id !== null }]));
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
                {names.get(o.token_id)?.player && <span className="badge badge-ghost badge-sm">player</span>}
              </li>
            ))}
            {waiting.map((id) => (
              <li key={id} className="flex items-center gap-2 rounded bg-base-100/30 px-2 py-1 opacity-70">
                <span className="w-6 text-right">…</span>
                <span className="flex-1">{names.get(id)?.name ?? "(gone)"}</span>
                <span className="text-xs">rolling</span>
              </li>
            ))}
          </ol>
          <form action={endEncounter}>
            <button className="btn btn-ghost btn-sm text-error">End encounter</button>
          </form>
        </>
      )}
    </div>
  );
}
