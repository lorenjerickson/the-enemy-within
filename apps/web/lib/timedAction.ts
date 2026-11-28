import { headers } from "next/headers";
import { nameAction, timed, timingOn } from "@/lib/timing";

/** A server action timed as the "server" boundary; its id (as the browser sees it) is noted against its name. */
export async function timedAction<T>(name: string, f: () => Promise<T>): Promise<T> {
  if (timingOn()) {
    const id = await headers().then((h) => h.get("next-action"), () => null); // none outside a request
    if (id) nameAction(id, name);
  }
  return timed("server", name, f);
}
