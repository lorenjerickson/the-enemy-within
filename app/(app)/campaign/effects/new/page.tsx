import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import EffectForm from "../EffectForm";
import { listConditionDefs } from "@/lib/db";

export default async function NewEffect() {
  await connection();
  await requireGm();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">New effect</h2>
      <EffectForm conditions={listConditionDefs()} />
    </section>
  );
}
