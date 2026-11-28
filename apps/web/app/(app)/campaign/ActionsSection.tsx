import { listEffectDefs } from "@/lib/db/effects";
import { type Action, type ActionOwner } from "@/lib/db/catalog";
import { describeCondition, asCondition, type Effect } from "@/lib/conditions";
import { deleteAction, submitAction } from "./actions";
import type { EffectOption } from "./EffectChips";
import ActionInterview from "./ActionInterview";
import { gearOf } from "@/lib/actionCard";
import { actionSentence } from "@/lib/actionSummary";

/** Every catalog effect; an action can put on only those lasting rounds (and keeps any it already grants), the rest
 * are listed greyed out with why (they're for items or creatures). */
function effectOptions(effects: Effect[], grants: { id: number }[]): EffectOption[] {
  return effects.map((e) => ({
    id: e.id, name: e.name, about: describeCondition(asCondition(e)) || e.description, description: e.description,
    unavailable: e.duration === "rounds" || grants.some((x) => x.id === e.id) ? undefined : e.duration === "always" ? "lasts always: for creatures" : "while equipped: for items",
  }));
}

/** Lists, adds and edits the actions an owner (profession, item or creature) grants. */
export default function ActionsSection({ owner, actions }: { owner: ActionOwner; actions: Action[] }) {
  const effects = listEffectDefs();
  const conditions = new Map(effects.map((e) => [e.id, asCondition(e)]));
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Actions</h3>
      {actions.length === 0 && <p className="text-sm opacity-60">None</p>}
      {actions.map((a) => (
        <div key={`${a.id}:${JSON.stringify(a)}`} className="flex items-start gap-2">
          <details className="flex-1">
            <summary className="link link-hover list-none">
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-sm opacity-70">{actionSentence(gearOf(a, (id) => conditions.get(id)))}</span>
              {a.description && <div className="text-sm opacity-60">{a.description}</div>}
            </summary>
            <ActionInterview action={submitAction.bind(null, owner, a.id)} initial={a} conditions={effects.map(asCondition)} effectOptions={effectOptions(effects, a.conditions)} itemOwned={"item_id" in owner} catalog={effects} />
          </details>
          <form action={deleteAction.bind(null, owner, a.id)}>
            <button className="btn btn-ghost btn-xs">Remove</button>
          </form>
        </div>
      ))}
      <details key={actions.length}>
        <summary className="btn btn-ghost btn-xs">+ Add action</summary>
        <ActionInterview action={submitAction.bind(null, owner, null)} conditions={effects.map(asCondition)} effectOptions={effectOptions(effects, [])} itemOwned={"item_id" in owner} catalog={effects} />
      </details>
    </div>
  );
}
