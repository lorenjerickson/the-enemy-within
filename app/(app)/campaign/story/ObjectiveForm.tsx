import { listCharacters } from "@/lib/db";
import { listDiscoveries, listObjectiveCharacters, type Objective } from "@/lib/story";
import { removeObjective, submitObjective } from "./actions";
import SettleButtons from "./SettleButtons";
import ScriptEditor from "../../ScriptEditor";
import { scriptNames } from "@/lib/scriptNames";

/**
 * An objective: who it's for, what counts as success or failure (with timelines), the reward and penalty
 * (each optionally a script; a reward can also be a discovery), and how much of it the party sees.
 */
export default function ObjectiveForm({ initial }: { initial?: Objective }) {
  const forCharacters = new Set(initial ? listObjectiveCharacters(initial.id) : []);
  const discoveries = listDiscoveries();
  const assignedBy = initial ? discoveries.filter((d) => d.objective_id === initial.id) : [];
  const names = scriptNames();

  return (
    <div className="space-y-3 max-w-2xl">
      <form id="objective-form" action={submitObjective.bind(null, initial?.id ?? null)} className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{initial ? "Edit objective" : "New objective"}</h2>
          {initial && <span className="badge">{initial.status}</span>}
        </div>
        <input name="title" required placeholder="Title (e.g. Deliver the letter to Ravensbrook)" defaultValue={initial?.title} className="input w-full" />
        <textarea name="description" placeholder="What the party is asked to do" defaultValue={initial?.description} className="textarea w-full h-20" />

        <fieldset className="fieldset">
          <legend className="fieldset-legend">For (none ticked = the whole party)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {listCharacters().map((c) => (
              <label key={c.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="characters" value={c.id} defaultChecked={forCharacters.has(c.id)} className="checkbox checkbox-sm" />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Success condition (a script, true once it has succeeded)</legend>
          <ScriptEditor name="success_check" label="Success condition" placeholder={"e.g.\nWITH game.calendar.timers['deliver the letter'].elapsed as V\n   game.vars.letterDelivered and interval(V, 'days') < 3"} defaultValue={initial?.success_check} names={names} minLines={4} />
          <input name="success" placeholder="Notes (optional), e.g. the letter reaches the mayor within 3 days" defaultValue={initial?.success} className="input input-sm w-full" />
          <input type="hidden" name="success_within_days" value={initial?.success_within_days ?? ""} />
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Failure condition (a script, true once it has failed)</legend>
          <ScriptEditor name="failure_check" label="Failure condition" placeholder={"e.g. not game.characters['sheena'].alive"} defaultValue={initial?.failure_check} names={names} minLines={3} />
          <input name="failure" placeholder="Notes (optional), e.g. the deadline passes or the letter is lost" defaultValue={initial?.failure} className="input input-sm w-full" />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Reward</legend>
          <textarea name="reward" placeholder="e.g. 10% off at the town's vendors" defaultValue={initial?.reward} className="textarea w-full h-16" />
          <select name="reward_discovery_id" defaultValue={initial?.reward_discovery_id ?? ""} className="select select-sm w-full">
            <option value="">No discovery</option>
            {discoveries.map((d) => <option key={d.id} value={d.id}>Reveals: {d.title}</option>)}
          </select>
          <ScriptEditor name="reward_script" label="Reward script" placeholder={"Script run on success (optional), e.g. game.vars.ravensbrookDiscount = 10"} defaultValue={initial?.reward_script} names={names} minLines={2} />
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Penalty</legend>
          <textarea name="penalty" placeholder="e.g. The town is overrun by monsters" defaultValue={initial?.penalty} className="textarea w-full h-16" />
          <label className="flex items-center gap-2 text-sm">
            <input name="penalty_after_days" type="number" min="0" step="any" defaultValue={initial?.penalty_after_days ?? ""} className="input input-sm w-20" />
            days after failing (blank = straight away)
          </label>
          <ScriptEditor name="penalty_script" label="Penalty script" placeholder={"Script run on failure (optional), e.g. game.vars.ravensbrookOverrun = true"} defaultValue={initial?.penalty_script} names={names} minLines={2} />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">What the party sees</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="revealed" defaultChecked={!!initial?.revealed} className="checkbox checkbox-sm" />
            The party knows about this objective (its title and description)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="details_revealed" defaultChecked={!!initial?.details_revealed} className="checkbox checkbox-sm" />
            …and its success and failure conditions, reward and penalty
          </label>
        </fieldset>
        {assignedBy.length > 0 && (
          <p className="text-sm opacity-70">Assigned by: {assignedBy.map((d) => d.title).join(", ")}</p>
        )}
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <button form="objective-form" className="btn btn-primary">Save objective</button>
        {initial && (
          <form action={removeObjective.bind(null, initial.id)}>
            <button className="btn btn-ghost text-error">Delete</button>
          </form>
        )}
      </div>
      {initial && <SettleButtons objectiveId={initial.id} status={initial.status} />}
    </div>
  );
}
