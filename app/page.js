import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getGm } from "@/lib/db";

export default async function Home() {
  await connection();
  const gm = getGm();
  if (!gm) redirect("/setup");

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">The Enemy Within</h1>
      <p className="mt-2">GM: {gm.name} ({gm.username})</p>
    </main>
  );
}
