import { connection } from "next/server";
import { requireGm } from "@/lib/auth";

export default async function Items() {
  await connection();
  await requireGm();
  return <h2 className="text-xl font-semibold">Items</h2>;
}
