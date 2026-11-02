"use client";

/** Lighting layer editor: the map's global illumination level. Previews live; saved on release. */
export default function LightingEditor({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit(Number(e.currentTarget.value));
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-3 text-sm">
        Global illumination
        <span className="text-xs opacity-60">dark</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label="Global illumination"
          value={value}
          onChange={(e) => onPreview(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="range range-sm w-64"
        />
        <span className="text-xs opacity-60">bright</span>
        <span className="w-10 text-right">{Math.round(value * 100)}%</span>
      </label>
      <p className="text-xs opacity-60">Applies to the whole level. Light sources can come later.</p>
    </div>
  );
}
