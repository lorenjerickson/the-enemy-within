import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { getEffectDef } from "@/lib/db";
import EffectForm from "../EffectForm";
import { deleteEffect } from "../actions";

export default async function EditEffect({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireGm();
  const effect = getEffectDef(Number((await params).id));
  if (!effect) notFound();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Edit effect</h2>
      <EffectForm key={JSON.stringify(effect)} initial={effect} />
      <form action={deleteEffect.bind(null, effect.id)}>
        <button className="btn btn-ghost btn-sm text-error">Delete effect</button>
      </form>
    </section>
  );
}
