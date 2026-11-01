import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getProfession, listRanks, type Rank } from "@/lib/db";
import { submitNewRank, submitRank } from "../actions";
import ProfessionFields from "../ProfessionFields";

/** Small inline name + description form, hidden behind a toggle. */
function RankForm({ label, action, initial }: { label: string; action: (f: FormData) => Promise<void>; initial?: Rank }) {
  return (
    <details>
      <summary className="btn btn-ghost btn-xs">{label}</summary>
      <form action={action} className="flex flex-wrap gap-2 mt-2">
        <input name="name" placeholder="Name (e.g. Sergeant)" required defaultValue={initial?.name} className="input input-sm" />
        <input name="description" placeholder="Description" defaultValue={initial?.description} className="input input-sm flex-1" />
        <button className="btn btn-primary btn-sm">Save</button>
      </form>
    </details>
  );
}

function Advancements({ professionId, parentId, ranks }: { professionId: number; parentId: number | null; ranks: Rank[] }) {
  const children = ranks.filter((r) => r.parent_id === parentId);
  return (
    <div className="ml-6 border-l border-base-300 pl-4 space-y-2">
      {children.length > 1 && <div className="text-xs opacity-60">Choose one of:</div>}
      {children.map((r) => (
        <div key={r.id} className="space-y-1">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{r.name}</span>
            <span className="text-sm opacity-70">{r.description}</span>
          </div>
          <RankForm key={`${r.name}|${r.description}`} label="Edit" action={submitRank.bind(null, professionId, r.id)} initial={r} />
          <Advancements professionId={professionId} parentId={r.id} ranks={ranks} />
        </div>
      ))}
      {/* key changes after each save so the toggle closes again */}
      <RankForm key={ranks.length} label="+ Add advancement option" action={submitNewRank.bind(null, professionId, parentId)} />
    </div>
  );
}

export default async function EditProfession({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const profession = getProfession(Number((await params).id));
  if (!profession) notFound();
  const ranks = listRanks(profession.id);

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Edit profession</h2>
        <ProfessionFields initial={profession} />
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">Advancement</h3>
        <div className="font-medium">{profession.name} <span className="text-xs opacity-60">(starting level)</span></div>
        <Advancements professionId={profession.id} parentId={null} ranks={ranks} />
      </div>
    </section>
  );
}
