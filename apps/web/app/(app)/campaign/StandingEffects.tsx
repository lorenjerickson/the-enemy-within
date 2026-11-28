import { getStandingUses, listEffectDefs } from "@/lib/db/effects";
import { saveStandingEffects } from "./standingActions";
import StandingEffectsForm from "./StandingEffectsForm";

/**
 * The effects an item gives whoever has it equipped (effects that last "while equipped"), or a creature always has
 * (effects that last "always"): fire resistance, immune to poison, +1 defense. No rounds, no saves. Each is the item's
 * or creature's own copy, tunable in place (backlog W).
 */
export default function StandingEffects({ owner }: { owner: { item_id: number } | { creature_id: number } }) {
  const uses = getStandingUses(owner), lasting = "item_id" in owner ? "equipped" : "always";
  const effects = listEffectDefs().filter((e) => e.duration === lasting || uses.some((u) => u.id === e.id)); // (and any it already has)
  return (
    <div className="space-y-2" data-standing-effects>
      <h3 className="font-semibold">{"item_id" in owner ? "Effects while equipped" : "Always has these effects"}</h3>
      <StandingEffectsForm key={uses.map((u) => u.id).join()} action={saveStandingEffects.bind(null, owner)} effects={effects} uses={uses} kind={"item_id" in owner ? "item" : "creature"} />
    </div>
  );
}
