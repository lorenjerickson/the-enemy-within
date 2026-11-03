import Link from "next/link";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { requireGm } from "@/lib/auth";

const CAMPAIGN_NAV = [
  { href: "/campaign", label: "Overview" },
  { href: "/campaign/items", label: "Items" },
  { href: "/campaign/creatures", label: "Creatures" },
  { href: "/campaign/professions", label: "Professions" },
  { href: "/campaign/characters", label: "Characters" },
  { href: "/campaign/locations", label: "Locations" },
  { href: "/campaign/story", label: "Story" },
];

export default async function CampaignLayout({ children }: { children: ReactNode }) {
  await connection();
  await requireGm();

  return (
    <div className="flex gap-8 in-data-focus:gap-0">
      <ul className="menu bg-base-200 rounded-box w-48 shrink-0 in-data-focus:hidden">
        {CAMPAIGN_NAV.map((n) => (
          <li key={n.href}><Link href={n.href}>{n.label}</Link></li>
        ))}
      </ul>
      <div className="flex-1">{children}</div>
    </div>
  );
}
