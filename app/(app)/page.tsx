import { connection } from "next/server";
import { requireUser } from "@/lib/auth";

export default async function Home() {
  await connection();
  const user = await requireUser();
  return <p>Welcome, {user.name}.</p>;
}
