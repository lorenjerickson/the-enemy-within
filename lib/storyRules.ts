import { tryGameScript, type ScriptResult } from "./game";
import { findDiscovery, getDiscovery } from "./story";

/**
 * The party finds a discovery: it's marked found (and an objective it assigns becomes known), and its
 * "when found" script runs, e.g. to start a timer. Finding it again does nothing.
 * Returns the script's result, if it had one and ran.
 */
export function revealDiscovery(id: number): ScriptResult | null {
  const d = getDiscovery(id);
  if (!d || d.found) return null;
  findDiscovery(id);
  return d.on_found.trim() ? tryGameScript(d.on_found) : null;
}
