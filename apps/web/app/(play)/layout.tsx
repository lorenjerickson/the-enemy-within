import type { ReactNode } from "react";

/** In a session: no app header; the map fills the browser and the UI floats over it. */
export default function PlayLayout({ children }: { children: ReactNode }) {
  return <main className="fixed inset-0 overflow-hidden bg-base-300">{children}</main>;
}
