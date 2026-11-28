import { TEMPLATE_KINDS, TEMPLATE_LABELS, TEMPLATE_OPACITY, type TemplateColors } from "@/lib/maps";
import { submitTemplateColors } from "../actions";

/** Templates layer editor: the colour for each kind of template (movement, action AoE, vision). */
export default function TemplatesEditor({ locationId, levelId, colors }: { locationId: number; levelId: number; colors: TemplateColors }) {
  return (
    <form action={submitTemplateColors.bind(null, locationId, levelId)} className="space-y-3">
      <div className="flex items-center gap-6 text-sm">
        {TEMPLATE_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input name={k} type="color" defaultValue={colors[k]} className="h-8 w-14 cursor-pointer rounded" />
            {TEMPLATE_LABELS[k]}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs opacity-80">
        <span>As drawn on the map (very dim):</span>
        {TEMPLATE_KINDS.map((k) => (
          <span key={k} className="size-6 rounded border border-base-content/20" style={{ background: colors[k], opacity: TEMPLATE_OPACITY }} title={TEMPLATE_LABELS[k]} />
        ))}
      </div>
      <button className="btn btn-primary btn-sm">Save template colours</button>
    </form>
  );
}
