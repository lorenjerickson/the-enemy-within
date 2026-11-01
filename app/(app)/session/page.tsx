import { redirect } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";

export default async function Session() {
  await connection();
  const user = await requireUser();
  if (user.role !== "gm") redirect("/");
  return <h2 className="text-xl font-semibold">Session</h2>;
}
