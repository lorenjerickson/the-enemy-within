import { effectText } from "@/lib/effectGrammar";
import Link from "next/link";
import { getStandingEffects, listEffectDefs } from "@/lib/db";
import { saveStandingEffects } from "./standingActions";

/**
 * The catalog effects an item gives whoever has it equipped (effects that last "while equipped"), or a creature always
 * has (effects that last "always"): fire resistance, immune to poison, +1 defense. No rounds, no saves.
 */
export default function StandingEffects({ owner }: { owner: { item_id: number } | { creature_id: number } }) {
  const on = getStandingEffects(owner), lasting = "item_id" in owner ? "equipped" : "always";
  const effects = listEffectDefs().filter((e) => e.duration === lasting || on.includes(e.id)); // (and any it already has)
  return (
    <div className="space-y-2" data-standing-effects>
      <h3 className="font-semibold">{"item_id" in owner ? "Effects while equipped" : "Always has these effects"}</h3>
      <form key={on.join()} action={saveStandingEffects.bind(null, owner)} className="space-y-1">
        {effects.length ? (
          effects.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="effect" value={e.id} defaultChecked={on.includes(e.id)} className="checkbox checkbox-sm mt-0.5" />
              <span><span className="font-medium">{e.name}</span> <span className="opacity-60">{effectText(e) || e.description}</span></span>
            </label>
          ))
        ) : (
          <p className="text-sm opacity-60">No effects that last {"item_id" in owner ? "while equipped" : "always"} yet.</p>
        )}
        <div className="flex items-center gap-3">
          {effects.length > 0 && <button className="btn btn-primary btn-xs">Save effects</button>}
          <Link href="/campaign/effects/new" className="link link-hover text-xs">+ New effect</Link>
        </div>
      </form>
    </div>
  );
}
