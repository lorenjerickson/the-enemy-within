import { AREA_SHAPES, describeArea } from "@/lib/aoe";
import { ATTRIBUTES } from "@/lib/attributes";
import { DAMAGE_TYPES, DURATION_UNITS, ROLL_MODES, formatDuration } from "@/lib/actions";
import { getCondition, listConditionDefs, type Action, type ActionOwner } from "@/lib/db";
import { describeCondition, type Condition } from "@/lib/conditions";
import { DICE_PATTERN, MODIFIER_PATTERN } from "@/lib/itemTypes";
import { deleteAction, submitAction } from "./actions";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One-line summary, e.g. "disadvantage · to hit -1 · 3d6 fire · split within 3 m · +2 Stealth (skill) · 1 hour". */
function summary(a: Action, conditionNames: Map<number, string>): string {
  const fromItem = a.item_id !== null;
  return [
    (a.attack || a.damage) && a.roll !== "normal" && a.roll,
    a.attack && `to hit ${a.attack}`,
    a.damage && `${a.damage} ${a.damage_type}`.trim(),
    a.area_shape && `${describeArea({ shape: a.area_shape, ft: a.area_ft })}, ${a.save_attr} save DC ${a.save_dc}${a.save_half ? " (half on a save)" : ""}`,
    a.area_shape && a.area_lasts ? "stays" : "",
    ...a.conditions.map((c) => `${c.on === "target" ? "target: " : ""}${conditionNames.get(c.id) ?? "a condition"}`),
    a.area_shape && a.area_lasts && a.duration_unit && formatDuration(a.duration_amount, a.duration_unit),
    `${a.seconds} s`,
    a.range_ft > 5 ? `range ${a.range_ft} ft` : a.range_ft === 0 && fromItem ? "weapon's range" : "reach",
  ]
    .filter(Boolean)
    .join(" · ");
}

function ActionForm({ owner, initial, conditions }: { owner: ActionOwner; initial?: Action; conditions: Condition[] }) {
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
      <label className="col-span-2 flex flex-wrap items-center gap-2 text-sm" data-action-targeting>
        Targets
        <select name="target_count" defaultValue={initial?.target_count ?? "one"} className="select select-sm w-auto">
          <option value="one">one</option>
          <option value="exactly">exactly N</option>
          <option value="upto">up to N</option>
          <option value="all">all</option>
        </select>
        N
        <input name="target_n" type="number" min="1" defaultValue={initial?.target_n ?? 2} className="input input-sm w-16" />
        <select name="target_who" defaultValue={initial?.target_who ?? ""} className="select select-sm w-auto">
          <option value="">creatures</option>
          <option value="friendly">friendlies</option>
          <option value="enemy">enemies</option>
        </select>
        <span className="text-xs opacity-60">in range, or in its area if it has one (with more there than N, the player picks which)</span>
      </label>
      <div className="col-span-2 text-xs opacity-60">Attack fields are optional — leave them blank for non-attack actions.</div>
      {(["self", "target"] as const).map((on) => {
        return (
          <fieldset key={on} className="col-span-2 space-y-2 rounded-box border border-base-300 p-2" data-effects-on={on}>
            <legend className="px-1 text-sm font-semibold">{on === "self" ? "Puts on whoever uses it" : "Puts on the target (on a hit, or a failed save)"}</legend>
            <div className="space-y-1" data-action-conditions={on}>
              <div className="text-xs font-semibold opacity-80">Conditions (from the catalog)</div>
              {conditions.length ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {conditions.map((c) => (
                    <label key={c.id} className="flex items-center gap-1 text-sm" title={describeCondition(c)}>
                      <input type="checkbox" name={`condition_${on}`} value={c.id} defaultChecked={(initial?.conditions ?? []).some((x) => x.id === c.id && x.on === on)} className="checkbox checkbox-xs" />
                      {c.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs opacity-60">None in the catalog yet (Campaign › Conditions).</p>
              )}
            </div>
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
        <span className="text-xs opacity-60">how long an area that stays on the map lasts (conditions have their own rounds)</span>
      </div>
      <div className="col-span-2">
        <button className="btn btn-primary btn-sm">Save action</button>
      </div>
    </form>
  );
}

/** Lists, adds and edits the actions an owner (profession, item or creature) grants. */
export default function ActionsSection({ owner, actions }: { owner: ActionOwner; actions: Action[] }) {
  const conditions = listConditionDefs().flatMap((d) => getCondition(d.id) ?? []);
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Actions</h3>
      {actions.length === 0 && <p className="text-sm opacity-60">None</p>}
      {actions.map((a) => (
        <div key={`${a.id}:${JSON.stringify(a)}`} className="flex items-start gap-2">
          <details className="flex-1">
            <summary className="link link-hover list-none">
              <span className="font-medium">{a.name}</span>{" "}
              <span className="text-sm opacity-70">{summary(a, new Map(conditions.map((c) => [c.id, c.name])))}</span>
              {a.description && <div className="text-sm opacity-60">{a.description}</div>}
            </summary>
            <ActionForm owner={owner} initial={a} conditions={conditions} />
          </details>
          <form action={deleteAction.bind(null, owner, a.id)}>
            <button className="btn btn-ghost btn-xs">Remove</button>
          </form>
        </div>
      ))}
      <details key={actions.length}>
        <summary className="btn btn-ghost btn-xs">+ Add action</summary>
        <ActionForm owner={owner} conditions={conditions} />
      </details>
    </div>
  );
}
