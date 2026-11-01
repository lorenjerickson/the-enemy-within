import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getProfession, listAdvancements, listPrerequisites, listProfessionModifiers, listProfessions, type Profession } from "@/lib/db";
import { MODIFIER_PATTERN } from "@/lib/itemTypes";
import { MODIFIER_TARGET_GROUPS, targetLabel } from "@/lib/modifiers";
import { addAdvancement, addModifier, deleteModifier, removeAdvancement } from "../actions";
import ProfessionFields from "../ProfessionFields";

function ProfessionLinks({ professions, onRemove }: { professions: Profession[]; onRemove?: (p: Profession) => () => Promise<void> }) {
  if (professions.length === 0) return <p className="text-sm opacity-60">None</p>;
  return (
    <ul className="space-y-1">
      {professions.map((p) => (
        <li key={p.id} className="flex items-center gap-2">
          <Link href={`/campaign/professions/${p.id}`} className="link link-hover font-medium">{p.name}</Link>
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

export default async function EditProfession({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const profession = getProfession(Number((await params).id));
  if (!profession) notFound();
  const advancements = listAdvancements(profession.id);
  const linked = new Set([profession.id, ...advancements.map((a) => a.id)]);
  const candidates = listProfessions().filter((p) => !linked.has(p.id));
  const modifiers = listProfessionModifiers(profession.id);

  return (
    <section className="space-y-6 max-w-2xl">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Edit profession</h2>
        <ProfessionFields initial={profession} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Modifiers</h3>
        <p className="text-xs opacity-60">Granted by this profession: a signed number (+1, -2) or dice (1d4, -1d6).</p>
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
        <h3 className="font-semibold">Prerequisites</h3>
        <p className="text-xs opacity-60">Professions that advance to this one.</p>
        <ProfessionLinks professions={listPrerequisites(profession.id)} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Advances to</h3>
        {advancements.length > 1 && <p className="text-xs opacity-60">Choose one of:</p>}
        <ProfessionLinks professions={advancements} onRemove={(p) => removeAdvancement.bind(null, profession.id, p.id)} />
        <form key={advancements.length} action={addAdvancement.bind(null, profession.id)} className="flex flex-wrap items-center gap-2 pt-2">
          <select name="to_id" defaultValue="" className="select select-sm">
            <option value="">Link existing profession…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-sm opacity-60">or</span>
          <input name="new_name" placeholder="New profession name" className="input input-sm" />
          <button className="btn btn-primary btn-sm">Add advancement</button>
        </form>
      </div>
    </section>
  );
}
