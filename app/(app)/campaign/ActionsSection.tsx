import { AREA_SHAPES, describeArea } from "@/lib/aoe";
import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES, DURATION_UNITS, ROLL_KIND_GROUPS, ROLL_MODES, formatDuration, rollKindLabel } from "@/lib/actions";
import { MODIFIER_TARGET_GROUPS, targetLabel } from "@/lib/modifiers";
import PairListInput from "./PairListInput";
import type { Action, ActionOwner } from "@/lib/db";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import { deleteAction, submitAction } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One-line summary, e.g. "disadvantage · to hit -1 · 3d6 fire · split within 3 m · +2 Stealth (skill) · 1 hour". */
function summary(a: Action): string {
  const fromItem = a.item_id !== null;
  return [
    (a.attack || a.damage) && a.roll !== "normal" && a.roll,
    a.attack && `to hit ${a.attack}`,
    a.damage && `${a.damage} ${a.damage_type}`.trim(),
    a.area_shape && `${describeArea({ shape: a.area_shape, ft: a.area_ft })}, ${a.save_attr} save DC ${a.save_dc}${a.save_half ? " (half on a save)" : ""}`,
    ...a.boosts.map((b) => `${b.on === "target" ? "target: " : ""}${b.value} ${targetLabel(b.target)}`),
    ...a.roll_grants.map((g) => `${g.on === "target" ? "target: " : ""}${g.mode} on ${rollKindLabel(g.roll)}`),
    a.area_shape && a.area_lasts ? "stays" : "",
    a.duration_unit && formatDuration(a.duration_amount, a.duration_unit),
    `${a.seconds} s`,
    a.range_ft > 5 ? `range ${a.range_ft} ft` : a.range_ft === 0 && fromItem ? "weapon's range" : "reach",
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
      <fieldset className="col-span-2 flex flex-wrap items-center gap-2 text-sm" data-area-fields>
        <span className="font-semibold">Area</span>
        <select name="area_shape" defaultValue={initial?.area_shape ?? ""} className="select select-sm w-36">
          <option value="">Single target</option>
          {AREA_SHAPES.map((s) => (
            <option key={s} value={s}>{capitalize(s)}</option>
          ))}
        </select>
        <input name="area_ft" type="number" min="0" step="5" placeholder="ft" defaultValue={initial?.area_ft || ""} className="input input-sm w-20" title="Circle: radius; cone and line: length (feet)" />
        ft · save
        <select name="save_attr" defaultValue={initial?.save_attr ?? "agility"} className="select select-sm w-32">
          {ATTRIBUTES.map((a) => (
            <option key={a} value={a}>{capitalize(a)}</option>
          ))}
        </select>
        DC
        <input name="save_dc" type="number" min="1" defaultValue={initial?.save_dc ?? 12} className="input input-sm w-16" />
        <label className="flex items-center gap-1">
          <input name="save_half" type="checkbox" defaultChecked={initial ? !!initial.save_half : true} className="checkbox checkbox-sm" />
          half damage on a save
        </label>
        <label className="flex items-center gap-1">
          <input name="area_lasts" type="checkbox" defaultChecked={!!initial?.area_lasts} className="checkbox checkbox-sm" />
          stays on the map for the duration
        </label>
        <span className="w-full text-xs opacity-60">Everyone caught (allies too) rolls the save; the damage dice are rolled once for all. A circle is aimed at a spot within range; a cone or line goes from the actor towards where it's aimed. If it stays on the map (for the duration below), whoever is in it at the end of each round rolls the save again.</span>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        Takes
        <input name="seconds" type="number" min="0.5" max="6" step="0.5" defaultValue={initial?.seconds ?? 2} className="input input-sm w-20" />
        seconds of a round
      </label>
      <label className="flex items-center gap-2 text-sm">
        Range
        <input name="range_ft" type="number" min="0" step="5" placeholder={"item_id" in owner ? "weapon's" : "5"} defaultValue={initial ? initial.range_ft || "" : "item_id" in owner ? "" : 5} className="input input-sm w-24" />
        ft {"item_id" in owner ? "(blank = the weapon's range; 5 = within reach)" : "(5 = within reach)"}
      </label>
      <label className="flex items-center gap-2 text-sm">
        Can be used on
        <select name="targets" defaultValue={initial?.targets ?? ""} className="select select-sm w-auto" data-action-targets>
          <option value="">Automatic (others if it does damage or affects a target, else self)</option>
          <option value="self">Only themselves</option>
          <option value="others">Others only</option>
          <option value="anyone">Themselves or others</option>
        </select>
      </label>
      <div className="col-span-2 text-xs opacity-60">Attack fields are optional — leave them blank for non-attack actions.</div>
      {(["self", "target"] as const).map((on) => {
        const p = on === "target" ? "target_" : "";
        const mine = <T extends { on?: "self" | "target" }>(xs: T[] | undefined) => (xs ?? []).filter((x) => (x.on ?? "self") === on);
        return (
          <fieldset key={on} className="col-span-2 space-y-2 rounded-box border border-base-300 p-2" data-effects-on={on}>
            <legend className="px-1 text-sm font-semibold">{on === "self" ? "On whoever uses it" : "On the target (on a hit, or a failed save)"}</legend>
            <PairListInput
              title="Temporary boosts"
              addLabel="+ Add boost"
              firstName={`${p}boost_target`}
              firstPlaceholder="Boosts…"
              groups={MODIFIER_TARGET_GROUPS}
              secondName={`${p}boost_value`}
              secondPattern={MODIFIER_PATTERN}
              secondPlaceholder="+2 or 1d4"
              initial={mine(initial?.boosts).map((b) => [b.target, b.value])}
            />
            <PairListInput
              title="Advantage / disadvantage on rolls"
              addLabel="+ Add roll effect"
              firstName={`${p}grant_roll`}
              firstPlaceholder="Roll…"
              groups={ROLL_KIND_GROUPS}
              secondName={`${p}grant_mode`}
              secondOptions={["advantage", "disadvantage"]}
              initial={mine(initial?.roll_grants).map((g) => [g.roll, g.mode])}
            />
          </fieldset>
        );
      })}
      <div className="col-span-2 flex items-center gap-2">
        <span className="text-sm font-semibold">Duration</span>
        <input name="duration_amount" type="number" min="1" defaultValue={initial?.duration_amount ?? 1} className="input input-sm w-20" />
        <select name="duration_unit" defaultValue={initial?.duration_unit ?? ""} className="select select-sm">
          {DURATION_UNITS.map((u) => (
            <option key={u} value={u}>{u ? `${u}(s)` : "Instant"}</option>
          ))}
        </select>
        <span className="text-xs opacity-60">how long its boosts and roll effects last (1 round = until the end of the next round)</span>
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
