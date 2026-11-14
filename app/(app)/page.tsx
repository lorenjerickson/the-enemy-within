import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOpenGameSession } from "@/lib/db";
import Logo from "@/app/Logo";

export default async function Home() {
  await connection();
  const user = await requireUser();
  const session = user.role === "player" ? getOpenGameSession() : undefined;
  return (
    <div className="space-y-4">
      <Logo variant="wide" width={576} className="w-full max-w-xl h-auto" priority />
      <p>Welcome, {user.name}.</p>
      {session && (
        <div className="rounded-box bg-base-200 p-4 max-w-xl flex items-center gap-4">
          <span>Session {session.number} {session.began_at ? "is under way." : "is about to begin."}</span>
          <Link href="/lobby" className="btn btn-primary btn-sm ml-auto">Join</Link>
        </div>
      )}
    </div>
  );
}
