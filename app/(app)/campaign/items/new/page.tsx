import { connection } from "next/server";
import { requireGm } from "@/lib/auth";

export default async function NewItem() {
  await connection();
  await requireGm();
  return <h2 className="text-xl font-semibold">New item</h2>;
}
