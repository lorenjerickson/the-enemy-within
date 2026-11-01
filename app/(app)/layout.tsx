import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getGm } from "@/lib/db";
import { requireUser } from "@/lib/auth";

const GM_NAV = [
  { href: "/users", label: "Users" },
  { href: "/campaign", label: "Campaign" },
  { href: "/session", label: "Session" },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  await connection();
  if (!getGm()) redirect("/setup");
  const user = await requireUser();

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
        <span className="ml-auto text-sm opacity-70">{user.name}</span>
      </header>
      <main className="p-8">{children}</main>
    </>
  );
}
