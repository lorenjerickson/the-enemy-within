import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import {
  charactersAtRank, getProfession, getProfessionGroup, laterRanks, listActions, listProfessionGroups, listAdvancements, listItems, listPrerequisites, listProfessionItems,
  listProfessionModifiers, listRanks, rankChain, type Profession,
} from "@/lib/db";
import { MODIFIER_PATTERN } from "@/lib/itemTypes";
import { MODIFIER_TARGET_GROUPS, targetLabel } from "@/lib/modifiers";
import { addAdvancement, addGrantedItem, addModifier, deleteModifier, moveRankTo, removeAdvancement, removeGrantedItem, removeRank } from "../../actions";
import RemoveButton from "../../RemoveButton";
import ActionsSection from "../../../ActionsSection";
import RankFields from "../../RankFields";

function ProfessionLinks({ professions, onRemove }: { professions: Profession[]; onRemove?: (p: Profession) => () => Promise<void> }) {
  if (professions.length === 0) return <p className="text-sm opacity-60">None</p>;
  return (
    <ul className="space-y-1">
      {professions.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <Link href={`/campaign/professions/ranks/${p.id}`} className="link link-hover font-medium">{p.name}</Link>
          <span className="text-sm opacity-70">{p.description}</span>
          {onRemove && (
            <form action={onRemove(p)}>
              <button className="btn btn-ghost btn-xs">Remove</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A rank: what it gives (on top of the ranks before it), and the ranks it leads to. */
export default async function EditRank({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const profession = getProfession(Number((await params).id));
  if (!profession) notFound();
  const advancements = listAdvancements(profession.id);
  const group = profession.group_id !== null ? getProfessionGroup(profession.group_id) : undefined;
  const chain = rankChain(profession.id), parent = chain.length > 1 ? getProfession(chain[chain.length - 2]) : undefined;
  const earlier = chain.slice(0, -1).map((id) => getProfession(id)?.name ?? "?");
  const linked = new Set([...chain, ...advancements.map((a) => a.id)]);
  const candidates = (profession.group_id !== null ? listRanks(profession.group_id) : []).filter((p) => !linked.has(p.id)); // ranks of the same profession (no loops)
  const otherRoutes = listPrerequisites(profession.id).filter((p) => p.id !== parent?.id);
  // Where it can move: after any rank but itself and those it leads to, or to the start of any profession.
  const later = new Set([profession.id, ...laterRanks(profession.id)]);
  const groups = listProfessionGroups(), here = parent ? `r:${parent.id}` : `start:${profession.group_id}`;
  const held = charactersAtRank(profession.id), nextCount = advancements.length;
  const warning = `Remove ${profession.name} for good? ${nextCount ? `Its next rank${nextCount === 1 ? "" : "s"} (${advancements.map((a) => a.name).join(", ")}) will ${parent ? `come after ${parent.name}` : "become starting ranks"}. ` : ""}${held.length ? `${held.map((c) => c.name).join(", ")} will ${parent ? `drop back to ${parent.name}` : "have no profession"}. ` : ""}Its modifiers, granted items and actions go too.`;
  const modifiers = listProfessionModifiers(profession.id);
  const grantedItems = listProfessionItems(profession.id);
  const grantedIds = new Set(grantedItems.map((i) => i.id));
  const itemCandidates = listItems().filter((i) => !grantedIds.has(i.id));

  return (
    <section className="space-y-6 max-w-2xl">
      {parent ? <Link href={`/campaign/professions/ranks/${parent.id}`} className="link link-hover text-sm" data-back>← Back to {parent.name}</Link>
        : group && <Link href={`/campaign/professions/${group.id}`} className="link link-hover text-sm" data-back>← Back to {group.name}</Link>}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{group ? `${group.name}: ` : ""}{profession.name}</h2>
        <p className="text-xs opacity-60" data-cumulative>{earlier.length ? `Holds everything from the ranks before it too: ${earlier.join(" › ")}.` : "The starting rank."}</p>
        <RankFields initial={profession} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Modifiers</h3>
        <p className="text-xs opacity-60">Granted by this rank: a signed number (+1, -2) or dice (1d4, -1d6).</p>
        {modifiers.length === 0 ? (
          <p className="text-sm opacity-60">None</p>
        ) : (
          <ul className="space-y-1">
            {modifiers.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="badge badge-neutral font-mono">{m.value}</span>
                <span>{targetLabel(m.target)}</span>
                <form action={deleteModifier.bind(null, profession.id, m.id)}>
                  <button className="btn btn-ghost btn-xs">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form key={modifiers.length} action={addModifier.bind(null, profession.id)} className="flex flex-wrap items-center gap-2 pt-2">
          <select name="target" required defaultValue="" className="select select-sm">
            <option value="" disabled>Modifies…</option>
            {MODIFIER_TARGET_GROUPS.map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input name="value" required pattern={MODIFIER_PATTERN} placeholder="+1 or 1d4" className="input input-sm w-28" />
          <button className="btn btn-primary btn-sm">Add modifier</button>
        </form>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Granted items</h3>
        {grantedItems.length === 0 ? (
          <p className="text-sm opacity-60">None</p>
        ) : (
          <ul className="space-y-1">
            {grantedItems.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <Link href={`/campaign/items/${i.id}`} className="link link-hover font-medium">{i.name}</Link>
                <span className="text-sm opacity-70">{i.description}</span>
                <form action={removeGrantedItem.bind(null, profession.id, i.id)}>
                  <button className="btn btn-ghost btn-xs">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form key={grantedItems.length} action={addGrantedItem.bind(null, profession.id)} className="flex items-center gap-2 pt-2">
          <select name="item_id" required defaultValue="" className="select select-sm">
            <option value="" disabled>Grant item…</option>
            {itemCandidates.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm">Grant item</button>
        </form>
      </div>

      <ActionsSection owner={{ profession_id: profession.id }} actions={listActions({ profession_id: profession.id })} />

      {otherRoutes.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-semibold">Also reached from</h3>
          <ProfessionLinks professions={otherRoutes} />
        </div>
      )}

      <div className="space-y-2" data-move-rank>
        <h3 className="font-semibold">Move</h3>
        <p className="text-xs opacity-60">Put this rank after another one, or make it a starting rank. The ranks it leads to move with it.</p>
        <form action={moveRankTo.bind(null, profession.id)} className="flex flex-wrap items-center gap-2">
          <select name="to" defaultValue={here} className="select select-sm w-auto">
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={`start:${g.id}`}>A starting rank of {g.name}</option>
                {listRanks(g.id).filter((r) => !later.has(r.id)).map((r) => <option key={r.id} value={`r:${r.id}`}>After {r.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="btn btn-primary btn-sm">Move</button>
        </form>
      </div>

      <div className="space-y-2" data-next-ranks>
        <h3 className="font-semibold">Next ranks</h3>
        {advancements.length > 1 && <p className="text-xs opacity-60">Choose one of:</p>}
        <ProfessionLinks professions={advancements} onRemove={(p) => removeAdvancement.bind(null, profession.id, p.id)} />
        <form key={advancements.length} action={addAdvancement.bind(null, profession.id)} className="flex flex-wrap items-center gap-2 pt-2">
          <select name="to_id" defaultValue="" className="select select-sm">
            <option value="">Link another {group?.name ?? ""} rank…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-sm opacity-60">or</span>
          <input name="new_name" placeholder="New rank name" className="input input-sm" />
          <button className="btn btn-primary btn-sm">Add next rank</button>
        </form>
      </div>
      <RemoveButton label="Remove rank" warning={warning} onConfirm={removeRank.bind(null, profession.id)} />
    </section>
  );
}
