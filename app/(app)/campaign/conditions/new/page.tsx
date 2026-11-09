import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import { listEffectDefs } from "@/lib/db";
import ConditionForm from "../ConditionForm";

export default async function NewCondition() {
  await connection();
  await requireGm();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">New condition</h2>
      <ConditionForm effects={listEffectDefs()} />
    </section>
  );
}
