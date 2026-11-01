import { connection } from "next/server";
import { requireGm } from "@/lib/auth";

export default async function Creatures() {
  await connection();
  await requireGm();
  return <h2 className="text-xl font-semibold">Creatures</h2>;
}
