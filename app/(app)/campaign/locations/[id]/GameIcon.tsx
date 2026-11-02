"use client";

import * as Gi from "react-icons/gi";
import type { IconType } from "react-icons";

/** Icon library for control buttons: react-icons' Game Icons set (~4,000 icons). */
const ICONS = Gi as unknown as Record<string, IconType>;
export const ICON_NAMES = Object.keys(ICONS).filter((k) => k.startsWith("Gi")).sort();

/** "GiOpenTreasureChest" → "open treasure chest" (for search). */
export const iconWords = (name: string) => name.slice(2).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

export default function GameIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Gi.GiClick;
  return <Icon className={className} aria-hidden />;
}
