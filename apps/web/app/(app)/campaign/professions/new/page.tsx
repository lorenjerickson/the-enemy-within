import { connection } from "next/server";
import { requireGm } from "@/lib/auth";
import ProfessionFields from "../ProfessionFields";

export default async function NewProfession() {
  await connection();
  await requireGm();
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">New profession</h2>
      <ProfessionFields />
    </section>
  );
}
