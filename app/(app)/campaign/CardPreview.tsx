"use client";

import { useEffect, useRef, useState } from "react";
import { AREA_SHAPES, areaFires, type AreaShape } from "@/lib/aoe";
import { ATTRIBUTES, type Attribute } from "@/lib/attributes";
import { DAMAGE_TYPES, ROLL_MODES, type DamageType, type RollMode } from "@/lib/actions";
import { gearOf, type ActionFields } from "@/lib/actionCard";
import { gearSummary } from "@/lib/actionSummary";
import type { Condition } from "@/lib/conditions";

/** The action form's fields as the card needs them (lenient: the server checks them on save). */
function readForm(f: FormData): ActionFields {
  const s = (k: string) => String(f.get(k) ?? "").trim();
  const n = (k: string, d: number) => Number(f.get(k)) || d;
  const pick = <T extends string>(list: readonly T[], v: string, d: T) => (list.includes(v as T) ? (v as T) : d);
  return {
    name: s("name") || "This action", description: s("description"),
    roll: pick<RollMode>(ROLL_MODES, s("roll"), "normal"), attack: s("attack").replace(/\s/g, "") || null, damage: s("damage").replace(/\s/g, "") || null,
    damage_type: pick<DamageType | "">(DAMAGE_TYPES, s("damage_type"), ""), radius: 0, split: 0, boosts: [], roll_grants: [],
    duration_amount: Math.max(1, n("duration_amount", 1)), duration_unit: s("duration_unit") as ActionFields["duration_unit"],
    seconds: Math.min(6, Math.max(0.5, n("seconds", 2))), range_ft: Math.max(0, n("range_ft", 0)),
    area_shape: pick<AreaShape | "">(AREA_SHAPES, s("area_shape"), ""), area_ft: Math.max(0, n("area_ft", 0)),
    save_dc: Math.max(1, Math.round(n("save_dc", 12))), save_attr: pick<Attribute>(ATTRIBUTES, s("save_attr"), "agility"),
    save_half: f.get("save_half") === "on" ? 1 : 0, area_lasts: f.get("area_lasts") === "on" ? 1 : 0,
    area_fires: areaFires(f.getAll("area_fires").map(String).join(",")).join(","),
    target_who: pick(["", "friendly", "enemy"] as const, s("target_who"), ""), target_count: pick(["one", "exactly", "upto", "all"] as const, s("target_count"), "one"),
    target_n: Math.max(1, Math.round(n("target_n", 1))), kind: s("kind") === "reaction" ? "reaction" : "action",
    targets: pick(["", "self", "others", "anyone"] as const, s("targets"), ""),
    conditions: (["self", "target"] as const).flatMap((on) => f.getAll(`condition_${on}`).map((v) => ({ id: Number(v), on })).filter((c) => c.id > 0)),
  };
}

/** The player's card for the action being written, updated as the GM types and ticks (it sits inside the form). */
export default function CardPreview({ conditions }: { conditions: Condition[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const byId = new Map(conditions.map((c) => [c.id, c]));
    // Only a changed card is set: the card is inside the form, so redrawing it must not set off the watch again.
    const update = () => { const next = gearSummary(gearOf(readForm(new FormData(form)), (id) => byId.get(id))); setLines((l) => (l.join("\n") === next.join("\n") ? l : next)); };
    update();
    // Typing and ticking fire input / change; effect chips add and remove hidden inputs, which only a DOM watch sees.
    for (const e of ["input", "change"]) form.addEventListener(e, update);
    const chips = new MutationObserver(update);
    chips.observe(form, { childList: true, subtree: true });
    return () => { for (const e of ["input", "change"]) form.removeEventListener(e, update); chips.disconnect(); };
  }, [conditions]);
  const [lead, ...rest] = lines;
  return (
    <div ref={ref} className="col-span-2 rounded-box border border-base-300 bg-base-100 p-3 text-sm" aria-live="polite">
      <div className="text-xs uppercase opacity-60 mb-1">The card reads</div>
      <p className="font-semibold">{lead}</p>
      {rest.map((l, i) => <p key={i} className="opacity-80">{l}</p>)}
    </div>
  );
}
