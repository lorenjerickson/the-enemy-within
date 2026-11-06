import { downTokens, getGmLevelId, listTokens } from "@/lib/db";
import { tokenHealth } from "@/lib/health";
import { setHealth } from "./gmActions";
import HealthFields from "../../(app)/HealthFields";

/** The GM's Health tool: each token on the active map, with current / maximum / temporary health and Restore. */
export default function HealthPanel() {
  const levelId = getGmLevelId();
  if (levelId === undefined) return <p className="text-sm opacity-70">No map loaded.</p>;
  const down = downTokens(levelId);
  return (
    <ul className="space-y-2 text-sm" data-health-panel>
      {listTokens(levelId).map((t) => {
        const h = tokenHealth(t.id);
        if (!h) return null;
        return (
          <li key={t.id} data-health-token={t.id} className="rounded bg-base-100/60 px-2 py-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-semibold">{t.name}</span>
              {down.has(t.id) && <span className="badge badge-xs badge-error">down</span>}
              <span className="text-xs opacity-70">{h.current}/{h.maximum}{h.temporary ? ` +${h.temporary}` : ""}</span>
            </div>
            <form action={setHealth.bind(null, t.id)} className="mt-1 flex items-end gap-1 text-xs">
              <HealthFields health={h} size="xs" />
              <button className="btn btn-xs">Set</button>
              <button name="restore" value="1" className="btn btn-xs ml-auto" disabled={h.current >= h.maximum} title="Current back to maximum">Restore</button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
