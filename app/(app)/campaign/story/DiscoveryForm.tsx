import { SKILLS_BY_ATTRIBUTE } from "@/lib/attributes";
import { listCharacters, listItems, listLocations } from "@/lib/db";
import { DISCOVERY_KINDS, RELATIONS, listDiscoveries, listLinks, listObjectives, type Discovery } from "@/lib/story";
import { removeDiscovery, submitDiscovery } from "./actions";
import ScriptEditor from "../../ScriptEditor";
import { scriptNames } from "@/lib/scriptNames";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
const SKILLS = [...new Set(Object.values(SKILLS_BY_ATTRIBUTE).flat())].sort();

/** A discovery: what the party learns, what it really is (GM only), who or what holds it, how it's found, and its links. */
export default function DiscoveryForm({ initial }: { initial?: Discovery }) {
  const others = listDiscoveries().filter((d) => d.id !== initial?.id);
  const names = scriptNames();
  const links = new Map(initial ? listLinks(initial.id).map((l) => [l.other_id, l.relation]) : []);
  const owner = initial?.location_id
    ? `location:${initial.location_id}`
    : initial?.character_id
      ? `character:${initial.character_id}`
      : initial?.item_id
        ? `item:${initial.item_id}`
        : "";

  return (
    <div className="space-y-3 max-w-2xl">
      <form id="discovery-form" action={submitDiscovery.bind(null, initial?.id ?? null)} className="space-y-3">
        <h2 className="text-xl font-semibold">{initial ? "Edit discovery" : "New discovery"}</h2>
        <input name="title" required placeholder="Title (e.g. The ledger behind the barrel)" defaultValue={initial?.title} className="input w-full" />
        <textarea name="text" placeholder="What the party learns" defaultValue={initial?.text} className="textarea w-full h-28" />
        <div className="grid grid-cols-2 gap-2">
          <label className="floating-label">
            <span>What it really is (GM only)</span>
            <select name="kind" defaultValue={initial?.kind ?? "truth"} className="select w-full">
              {DISCOVERY_KINDS.map((k) => (
                <option key={k} value={k}>{capitalize(k)}</option>
              ))}
            </select>
          </label>
          <label className="floating-label">
            <span>Held by</span>
            <select name="owner" defaultValue={owner} className="select w-full">
              <option value="">No one in particular</option>
              <optgroup label="Locations">
                {listLocations().map((l) => <option key={l.id} value={`location:${l.id}`}>{l.name}</option>)}
              </optgroup>
              <optgroup label="Characters">
                {listCharacters().map((c) => <option key={c.id} value={`character:${c.id}`}>{c.name}</option>)}
              </optgroup>
              <optgroup label="Items">
                {listItems().map((i) => <option key={i.id} value={`item:${i.id}`}>{i.name}</option>)}
              </optgroup>
            </select>
          </label>
        </div>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">How it&apos;s found</legend>
          <input name="reveal" placeholder="e.g. investigating the barrels, asking the clerk about the ledger" defaultValue={initial?.reveal} className="input w-full" />
          <div className="flex items-center gap-2 text-sm">
            Check
            <select name="reveal_skill" defaultValue={initial?.reveal_skill ?? ""} className="select select-sm w-48">
              <option value="">None (found when the above happens)</option>
              {SKILLS.map((s) => <option key={s} value={s}>{capitalize(s)}</option>)}
            </select>
            DC
            <input name="reveal_dc" type="number" min="1" max="40" defaultValue={initial?.reveal_dc ?? ""} className="input input-sm w-20" />
          </div>
        </fieldset>
        <label className="floating-label">
          <span>Assigns objective</span>
          <select name="objective_id" defaultValue={initial?.objective_id ?? ""} className="select w-full">
            <option value="">None</option>
            {listObjectives().map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </label>
        {others.length > 0 && (
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Relation to other discoveries</legend>
            <ul className="space-y-1">
              {others.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <select name={`link:${d.id}`} defaultValue={links.get(d.id) ?? ""} className="select select-xs w-36">
                    <option value="">—</option>
                    {RELATIONS.map((r) => <option key={r} value={r}>{capitalize(r)}</option>)}
                  </select>
                  <span className="truncate">{d.title}</span>
                  <span className="badge badge-ghost badge-sm">{d.kind}</span>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <fieldset className="fieldset">
          <legend className="fieldset-legend">When found (a script, run once when the party finds it)</legend>
          <ScriptEditor name="on_found" label="When found script" placeholder={"e.g. game.calendar.timers.start('find holmes')"} defaultValue={initial?.on_found} names={names} minLines={2} />
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="found" defaultChecked={!!initial?.found} className="checkbox checkbox-sm" />
          The party has found this (an objective it assigns becomes known to them)
        </label>
      </form>
      <div className="flex gap-2">
        <button form="discovery-form" className="btn btn-primary">Save discovery</button>
        {initial && (
          <form action={removeDiscovery.bind(null, initial.id)}>
            <button className="btn btn-ghost text-error">Delete</button>
          </form>
        )}
      </div>
    </div>
  );
}
