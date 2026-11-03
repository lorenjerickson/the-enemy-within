import { listCharacters } from "@/lib/db";
import { listDiscoveries, listObjectiveCharacters, type Objective } from "@/lib/story";
import { removeObjective, submitObjective } from "./actions";
import SettleButtons from "./SettleButtons";

/**
 * An objective: who it's for, what counts as success or failure (with timelines), the reward and penalty
 * (each optionally a script; a reward can also be a discovery), and how much of it the party sees.
 */
export default function ObjectiveForm({ initial }: { initial?: Objective }) {
  const forCharacters = new Set(initial ? listObjectiveCharacters(initial.id) : []);
  const discoveries = listDiscoveries();
  const assignedBy = initial ? discoveries.filter((d) => d.objective_id === initial.id) : [];

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
          <legend className="fieldset-legend">Success</legend>
          <textarea name="success" placeholder="e.g. The letter reaches the mayor" defaultValue={initial?.success} className="textarea w-full h-16" />
          <label className="flex items-center gap-2 text-sm">
            Within
            <input name="success_within_days" type="number" min="0" step="any" defaultValue={initial?.success_within_days ?? ""} className="input input-sm w-20" />
            days (blank = no deadline)
          </label>
          <input name="success_check" placeholder="Optional game-state check, e.g. game.vars.letterDelivered" defaultValue={initial?.success_check} spellCheck={false} className="input input-sm w-full font-mono" />
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Failure</legend>
          <textarea name="failure" placeholder="e.g. The deadline passes, or the letter is lost" defaultValue={initial?.failure} className="textarea w-full h-16" />
          <input name="failure_check" placeholder="Optional game-state check, e.g. not game.characters['sheena'].alive" defaultValue={initial?.failure_check} spellCheck={false} className="input input-sm w-full font-mono" />
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend">Reward</legend>
          <textarea name="reward" placeholder="e.g. 10% off at the town's vendors" defaultValue={initial?.reward} className="textarea w-full h-16" />
          <select name="reward_discovery_id" defaultValue={initial?.reward_discovery_id ?? ""} className="select select-sm w-full">
            <option value="">No discovery</option>
            {discoveries.map((d) => <option key={d.id} value={d.id}>Reveals: {d.title}</option>)}
          </select>
          <textarea name="reward_script" placeholder="Script run on success (optional), e.g. game.vars.ravensbrookDiscount = 10" defaultValue={initial?.reward_script} spellCheck={false} className="textarea w-full h-16 font-mono text-sm" />
        </fieldset>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Penalty</legend>
          <textarea name="penalty" placeholder="e.g. The town is overrun by monsters" defaultValue={initial?.penalty} className="textarea w-full h-16" />
          <label className="flex items-center gap-2 text-sm">
            <input name="penalty_after_days" type="number" min="0" step="any" defaultValue={initial?.penalty_after_days ?? ""} className="input input-sm w-20" />
            days after failing (blank = straight away)
          </label>
          <textarea name="penalty_script" placeholder="Script run on failure (optional), e.g. game.vars.ravensbrookOverrun = true" defaultValue={initial?.penalty_script} spellCheck={false} className="textarea w-full h-16 font-mono text-sm" />
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
