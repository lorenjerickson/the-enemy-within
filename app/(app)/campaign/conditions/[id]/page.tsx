import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getConditionDef, listEffectDefs } from "@/lib/db";
import ConditionForm from "../ConditionForm";
import { deleteCondition } from "../actions";

export default async function EditCondition({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const condition = getConditionDef(Number((await params).id));
  if (!condition) notFound();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Edit condition</h2>
      <ConditionForm key={JSON.stringify(condition)} initial={condition} effects={listEffectDefs()} />
      {!condition.builtin && (
        <form action={deleteCondition.bind(null, condition.id)}>
          <button className="btn btn-ghost btn-sm text-error">Delete condition</button>
        </form>
      )}
    </section>
  );
}
