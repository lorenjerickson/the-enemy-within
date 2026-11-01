import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getGm } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export default async function Home() {
  await connection();
  if (!getGm()) redirect("/setup");
  const user = await requireUser();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">The Enemy Within</h1>
      <p className="mt-2">Logged in as {user.name} ({user.role})</p>
    </main>
  );
}
