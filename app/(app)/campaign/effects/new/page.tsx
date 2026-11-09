import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import EffectForm from "../EffectForm";

export default async function NewEffect() {
  await connection();
  await requireGm();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">New effect</h2>
      <EffectForm />
    </section>
  );
}
