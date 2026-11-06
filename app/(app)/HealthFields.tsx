import type { HealthValues } from "@/lib/health";

/**
 * Current / maximum / temporary health inputs, for a form whose action reads them with parseHealthForm
 * (the Health dock tool and the character page). Remounts when the saved values change, so they show the new ones.
 */
export default function HealthFields({ health, size = "sm" }: { health: HealthValues; size?: "xs" | "sm" }) {
  return (
    <>
      {(["current", "maximum", "temporary"] as const).map((k) => (
        <label key={k} className="flex flex-col">
          <span className="text-xs opacity-60">{k}</span>
          <input name={k} type="number" defaultValue={health[k]} key={`${k}${health[k]}`} className={`input ${size === "xs" ? "input-xs w-16" : "input-sm w-20"}`} />
        </label>
      ))}
    </>
  );
}
