import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getEffectDef } from "@/lib/db";
import EffectForm from "../EffectForm";
import { effectSentences } from "@/lib/effectGrammar";
import { listConditionDefs } from "@/lib/db";
import { deleteEffect } from "../actions";

export default async function EditEffect({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const effect = getEffectDef(Number((await params).id));
  if (!effect) notFound();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Edit effect</h2>
      {!effect.builtin && (
        <div className="max-w-2xl rounded-box bg-base-200 p-3 text-sm" data-effect-rules>
          <div className="mb-1 font-semibold">Rules</div>
          {effect.modifiers.length ? <ul className="list-inside list-disc">{effectSentences(effect.modifiers).map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="opacity-60">None yet.</p>}
        </div>
      )}
      <EffectForm key={JSON.stringify(effect)} initial={effect} conditions={listConditionDefs()} />
      {!effect.builtin && (
        <form action={deleteEffect.bind(null, effect.id)}>
          <button className="btn btn-ghost btn-sm text-error">Delete effect</button>
        </form>
      )}
    </section>
  );
}
