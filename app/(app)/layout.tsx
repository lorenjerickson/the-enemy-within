import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getGm } from "@/lib/db";
import { logout, requireUser } from "@/lib/auth";

async function doLogout() {
  "use server";
  await logout();
  redirect("/login");
}

const GM_NAV = [
  { href: "/users", label: "Users" },
  { href: "/campaign", label: "Campaign" },
  { href: "/session", label: "Session" },
  { href: "/journal", label: "Journals" },
];
const PLAYER_NAV = [{ href: "/journal", label: "Journal" }];

export default async function AppLayout({ children }: { children: ReactNode }) {
  await connection();
  if (!getGm()) redirect("/setup");
  const user = await requireUser();

  return (
    <>
      <header className="navbar bg-base-200 px-4">
        <Link href="/" className="text-lg font-bold mr-6">The Enemy Within</Link>
        <nav className="flex-1">
          <ul className="menu menu-horizontal gap-1">
            {(user.role === "gm" ? GM_NAV : PLAYER_NAV).map((n) => (
              <li key={n.href}><Link href={n.href}>{n.label}</Link></li>
            ))}
          </ul>
        </nav>
        <details className="dropdown dropdown-end ml-auto">
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
    </>
  );
}
