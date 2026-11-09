"use client";

import { useEffect, useState, useTransition } from "react";
import type { EquipSlot } from "@/lib/itemTypes";
import type { InventoryOp } from "@/lib/inventory";
import { catalogue, changeCarried } from "./inventoryActions";
import type { Sheet } from "@/lib/sheet";
import ArtModal from "./ArtModal";

/** A character (or creature) sheet: portrait (click for the artwork), health, active effects, equipment and what they carry. */
// manage: change what they carry from here (stow, equip, move; the GM also adds and takes out). locked: why a player
// can't right now (in an encounter, gear is swapped with Refit).
export default function CharacterSheet({ sheet, manage }: { sheet: Sheet; manage?: { gm: boolean; locked?: string | null; onChanged?: () => void } }) {
  const [art, setArt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const canManage = !!manage && sheet.characterId !== null && !manage.locked;
  const change = (op: InventoryOp) =>
    startTransition(async () => {
      const r = await changeCarried(sheet.characterId!, op);
      setError(r.error ?? null);
      manage?.onChanged?.();
    });
  const pic = sheet.image ?? sheet.token;
  const h = sheet.health;
  const pct = h && h.maximum > 0 ? Math.max(0, Math.min(1, h.current / h.maximum)) : 0;
  return (
    <div className="space-y-3 text-sm" data-character-sheet={sheet.tokenId}>
      <div className="flex items-center gap-3">
        {pic ? (
          <button type="button" className="shrink-0 overflow-hidden rounded-box ring-1 ring-base-content/20 hover:ring-primary" title="Show artwork" onClick={() => setArt(true)} data-portrait>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pic} alt="" className="size-20 object-cover" />
          </button>
        ) : (
          <div className="size-20 shrink-0 rounded-box bg-base-300" />
        )}
        <div className="min-w-0 space-y-1">
          <div className="truncate text-base font-semibold">{sheet.name}</div>
          {sheet.player && <div className="text-xs opacity-60">played by {sheet.player}</div>}
          {sheet.down ? (
            <span className="badge badge-error badge-sm">down</span>
          ) : h ? (
            <div className="space-y-0.5" data-sheet-health>
              <progress className={`progress w-36 ${pct > 0.5 ? "progress-success" : pct > 0.25 ? "progress-warning" : "progress-error"}`} value={h.current} max={h.maximum} />
              <div className="text-xs opacity-80">{h.current} / {h.maximum} health{h.temporary ? ` (+${h.temporary} temporary)` : ""}</div>
            </div>
          ) : null}
        </div>
      </div>
      <section className="space-y-1">
        <div className="text-xs font-semibold opacity-80">Active effects</div>
        {sheet.effects.length ? (
          <ul className="space-y-0.5" data-sheet-effects>
            {sheet.effects.map((e, i) => (
              <li key={i}><span className="badge badge-warning badge-sm mr-1">{e.source}</span>{e.text} {e.left !== "always" && <span className="opacity-60">({/^\d/.test(e.left) ? `${e.left} left` : e.left})</span>}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-60">None.</p>
        )}
      </section>
      <section className="space-y-1">
        <div className="text-xs font-semibold opacity-80">Equipped</div>
        {sheet.equipment.length ? (
          <ul className="space-y-0.5 text-xs" data-sheet-equipment>
            {sheet.equipment.map((e) => (
              <li key={e.slot} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate"><span className="capitalize opacity-60">{e.slot}:</span> {e.name}</span>
                {canManage && (
                  <ItemMenu
                    label={`What to do with ${e.name}`}
                    options={sheet.containers.filter((c) => c.id !== e.id).map((c) => ({ value: `stow:${e.slot}:${c.id}`, text: `Stow in ${c.name}` }))}
                    onPick={(v) => { const [, slot, into] = v.split(":"); change({ op: "stow", slot: slot as EquipSlot, into: Number(into) }); }}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs opacity-60">Nothing.</p>
        )}
      </section>
      {sheet.containers.map((c) => (
        <section key={c.id} className="space-y-1" data-sheet-container={c.id}>
          <div className="text-xs font-semibold opacity-80">{c.name} <span className="font-normal opacity-60">({c.stacks.length}/{c.capacity}, {c.slot})</span></div>
          {c.stacks.length ? (
            <ul className="space-y-0.5 text-xs">
              {c.stacks.map((s) => (
                <li key={s.id} className="flex items-center gap-2" data-stack={s.id}>
                  <span className="min-w-0 flex-1 truncate">{s.name}{s.qty > 1 ? ` ×${s.qty}` : ""}</span>
                  {canManage && (
                    <ItemMenu
                      label={`What to do with ${s.name}`}
                      options={[
                        ...sheet.slots.filter((slot) => s.slots.includes(slot)).map((slot) => ({ value: `equip:${s.id}:${slot}`, text: `Equip: ${slot}${sheet.equipment.some((e) => e.slot === slot) ? " (swap)" : ""}` })),
                        ...sheet.containers.filter((o) => o.id !== c.id).map((o) => ({ value: `move:${s.id}:${o.id}`, text: `Move to ${o.name}` })),
                        ...(manage?.gm ? [{ value: `remove:${s.id}`, text: s.qty > 1 ? "Take one out" : "Take it out" }] : []),
                      ]}
                      onPick={(v) => {
                        const [op, stack, x] = v.split(":");
                        if (op === "equip") change({ op: "equip", stack: Number(stack), slot: x as EquipSlot });
                        if (op === "move") change({ op: "move", stack: Number(stack), to: Number(x) });
                        if (op === "remove") change({ op: "remove", stack: Number(stack) });
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs opacity-60">Empty.</p>
          )}
          {manage?.gm && <AddFromCatalogue onAdd={(item, qty) => change({ op: "add", item, into: c.id, qty })} />}
        </section>
      ))}
      {manage && sheet.characterId !== null && manage.locked && <p className="text-xs opacity-60">{manage.locked}</p>}
      {error && <p className="text-xs text-error" data-inventory-error>{error}</p>}
      {art && pic && <ArtModal src={pic} title={sheet.name} onClose={() => setArt(false)} />}
    </div>
  );
}

/** A small "…" menu of what can be done with an item (picking one does it). */
function ItemMenu({ label, options, onPick }: { label: string; options: { value: string; text: string }[]; onPick: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <select aria-label={label} title={label} className="select select-xs w-24" value="" onChange={(e) => e.target.value && onPick(e.target.value)} data-item-menu>
      <option value="">Move…</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
    </select>
  );
}

/** The GM putting something from the item catalogue into a container. */
function AddFromCatalogue({ onAdd }: { onAdd: (item: number, qty: number) => void }) {
  const [items, setItems] = useState<{ id: number; name: string }[] | null>(null);
  const [pick, setPick] = useState("");
  useEffect(() => { catalogue().then(setItems); }, []);
  if (!items) return null;
  return (
    <div className="flex items-center gap-1" data-add-item>
      <select className="select select-xs flex-1" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add from the catalogue">
        <option value="">Add from the catalogue…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <button type="button" className="btn btn-xs" disabled={!pick} onClick={() => { onAdd(Number(pick), 1); setPick(""); }}>Add</button>
    </div>
  );
}
