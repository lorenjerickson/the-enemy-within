import Link from "next/link";
import { getStandingEffects, listEffectDefs } from "@/lib/db";
import { describeEffect } from "@/lib/conditions";
import { saveStandingEffects } from "./standingActions";

/**
 * The catalog effects an item gives whoever has it equipped, or a creature always has (fire resistance, immune to
 * poison, +1 defense): no rounds, no save; they last as long as the item is worn or the creature exists.
 */
export default function StandingEffects({ owner }: { owner: { item_id: number } | { creature_id: number } }) {
  const effects = listEffectDefs(), on = getStandingEffects(owner);
  return (
    <div className="space-y-2" data-standing-effects>
      <h3 className="font-semibold">{"item_id" in owner ? "Effects while equipped" : "Always has these effects"}</h3>
      <form key={on.join()} action={saveStandingEffects.bind(null, owner)} className="space-y-1">
        {effects.length ? (
          effects.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="effect" value={e.id} defaultChecked={on.includes(e.id)} className="checkbox checkbox-sm mt-0.5" />
              <span><span className="font-medium">{e.name}</span> <span className="opacity-60">{describeEffect(e) || e.description}</span></span>
            </label>
          ))
        ) : (
          <p className="text-sm opacity-60">No effects in the catalog yet.</p>
        )}
        <div className="flex items-center gap-3">
          {effects.length > 0 && <button className="btn btn-primary btn-xs">Save effects</button>}
          <Link href="/campaign/effects/new" className="link link-hover text-xs">+ New effect</Link>
        </div>
      </form>
    </div>
  );
}
