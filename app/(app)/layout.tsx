import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { playAs } from "./sessions/actions";
import { getGm, getOpenGameSession, isRemovedFrom, listPresentPlayers } from "@/lib/db";
import JoinPrompt from "./lobby/JoinPrompt";
import { logout, requireUser } from "@/lib/auth";

async function doLogout() {
  "use server";
  await logout();
  redirect("/login");
}

const GM_NAV = [
  { href: "/campaign", label: "Campaign" },
  { href: "/sessions", label: "Sessions" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  await connection();
  if (!getGm()) redirect("/setup");
  const user = await requireUser();
  // A session open that this player hasn't joined (they're asked to).
  const session = user.role === "player" ? getOpenGameSession() : undefined;
  const open = session && !user.playedBy && !isRemovedFrom(session.id, user.id) && !listPresentPlayers(session.id).includes(user.id) ? session : undefined;

  return (
    <>
      <header className="navbar bg-base-200 px-4">
        <Link href="/" className="text-lg font-bold mr-6">The Enemy Within</Link>
        {user.role === "gm" && (
          <nav className="flex-1">
            <ul className="menu menu-horizontal gap-1">
              {GM_NAV.map((n) => (
                <li key={n.href}><Link href={n.href}>{n.label}</Link></li>
              ))}
            </ul>
          </nav>
        )}
        {user.playedBy && (
          <form action={playAs.bind(null, null)} className="ml-auto flex items-center gap-2 text-sm" data-acting-as>
            <span className="badge badge-info">Playing as {user.name}</span>
            <button className="btn btn-xs">Back to GM</button>
          </form>
        )}
        <details className={`dropdown dropdown-end ${user.playedBy ? "" : "ml-auto"}`}>
          <summary className="btn btn-ghost btn-sm">{user.name}</summary>
          <ul className="menu dropdown-content bg-base-100 rounded-box z-10 w-40 p-2 shadow">
            <li>
              <form action={doLogout}>
                <button className="w-full text-left">Log out</button>
              </form>
            </li>
          </ul>
        </details>
      </header>
      <main className="p-8 in-data-focus:p-4">{children}</main>
      {user.role === "player" && <JoinPrompt initial={open ? { id: open.id, number: open.number, began: !!open.began_at } : null} />}
    </>
  );
}
