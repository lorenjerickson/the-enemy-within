import { DAMAGE_TYPES, DURATION_UNITS, ROLL_MODES, formatDuration } from "@/lib/actions";
import { targetLabel } from "@/lib/modifiers";
import BoostsInput from "./BoostsInput";
import type { Action, ActionOwner } from "@/lib/db";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import { deleteAction, submitAction } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One-line summary, e.g. "disadvantage · to hit -1 · 3d6 fire · split within 3 m · +2 Stealth (skill) · 1 hour". */
function summary(a: Action): string {
  return [
    (a.attack || a.damage) && a.roll !== "normal" && a.roll,
    a.attack && `to hit ${a.attack}`,
    a.damage && `${a.damage} ${a.damage_type}`.trim(),
    a.radius > 0 && `${a.split ? "split" : "each"} within ${a.radius} m`,
    ...a.boosts.map((b) => `${b.value} ${targetLabel(b.target)}`),
    a.duration_unit && formatDuration(a.duration_amount, a.duration_unit),
  ]
    .filter(Boolean)
    .join(" · ");
}

function ActionForm({ owner, initial }: { owner: ActionOwner; initial?: Action }) {
  return (
    <form action={submitAction.bind(null, owner, initial?.id ?? null)} className="grid grid-cols-2 gap-2 mt-2 p-3 bg-base-200 rounded-box">
      <input name="name" placeholder="Action name (e.g. Circle of Flames)" required defaultValue={initial?.name} className="input input-sm col-span-2 w-full" />
      <textarea name="description" placeholder="What the action does" defaultValue={initial?.description} className="textarea textarea-sm col-span-2 w-full" />
      <select name="roll" defaultValue={initial?.roll ?? "normal"} className="select select-sm w-full">
        {ROLL_MODES.map((r) => (
          <option key={r} value={r}>To hit: {r}</option>
        ))}
      </select>
      <input name="attack" pattern={MODIFIER_PATTERN} placeholder="To-hit modifier (e.g. -1, 1d4)" defaultValue={initial?.attack ?? ""} className="input input-sm w-full" />
      <input name="damage" pattern={DICE_PATTERN} placeholder="Damage dice (e.g. 3d6)" defaultValue={initial?.damage ?? ""} className="input input-sm w-full" />
      <select name="damage_type" defaultValue={initial?.damage_type} className="select select-sm w-full">
        <option value="">Damage type…</option>
        {DAMAGE_TYPES.map((t) => (
          <option key={t} value={t}>{capitalize(t)}</option>
        ))}
      </select>
      <input name="radius" type="number" min="0" step="any" placeholder="Area radius in metres (0 = single target)" defaultValue={initial?.radius || ""} className="input input-sm w-full" />
      <label className="flex items-center gap-2 text-sm">
        <input name="split" type="checkbox" defaultChecked={!!initial?.split} className="checkbox checkbox-sm" />
        Split damage evenly across the area
      </label>
      <div className="col-span-2 text-xs opacity-60">Attack fields are optional — leave them blank for non-attack actions.</div>
      <div className="col-span-2">
        <BoostsInput initial={initial?.boosts} />
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <span className="text-sm font-semibold">Duration</span>
        <input name="duration_amount" type="number" min="1" defaultValue={initial?.duration_amount ?? 1} className="input input-sm w-20" />
        <select name="duration_unit" defaultValue={initial?.duration_unit ?? ""} className="select select-sm">
          {DURATION_UNITS.map((u) => (
            <option key={u} value={u}>{u ? `${u}(s)` : "Instant"}</option>
          ))}
        </select>
        <span className="text-xs opacity-60">e.g. 1 long rest = until the next long rest</span>
      </div>
      <div className="col-span-2">
        <button className="btn btn-primary btn-sm">Save action</button>
      </div>
    </form>
  );
}

/** Lists, adds and edits the actions an owner (profession, item or creature) grants. */
export default function ActionsSection({ owner, actions }: { owner: ActionOwner; actions: Action[] }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Actions</h3>
      {actions.length === 0 && <p className="text-sm opacity-60">None</p>}
      {actions.map((a) => (
        <div key={`${a.id}:${JSON.stringify(a)}`} className="flex items-start gap-2">
          <details className="flex-1">
            <summary className="link link-hover list-none">
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-sm opacity-70">{summary(a)}</span>
              {a.description && <div className="text-sm opacity-60">{a.description}</div>}
            </summary>
            <ActionForm owner={owner} initial={a} />
          </details>
          <form action={deleteAction.bind(null, owner, a.id)}>
            <button className="btn btn-ghost btn-xs">Remove</button>
          </form>
        </div>
      ))}
      <details key={actions.length}>
        <summary className="btn btn-ghost btn-xs">+ Add action</summary>
        <ActionForm owner={owner} />
      </details>
    </div>
  );
}
