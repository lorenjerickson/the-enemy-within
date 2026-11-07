import { characterContainers, listItems } from "@/lib/db";
import { addContainerItem, removeContainerStack } from "./actions";

/** The character's worn containers (a belt, a pack…), each with its own slots: what's in them, and putting items in. */
export default function Containers({ characterId }: { characterId: number }) {
  const containers = characterContainers(characterId);
  const items = listItems();
  return (
    <section className="max-w-3xl space-y-3" data-containers>
      <h2 className="text-lg font-semibold">Containers</h2>
      {containers.length === 0 && <p className="text-sm opacity-60">Nothing worn holds anything. Equip a container (a belt, a pack…) and save to give them slots.</p>}
      {containers.map((c) => (
        <div key={c.slot} className="space-y-2 rounded-box bg-base-200 p-3 text-sm" data-container={c.container.id}>
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">{c.container.name}</span>
            <span className="capitalize opacity-60">{c.slot}</span>
            <span className="ml-auto text-xs opacity-70">{c.stacks.length} of {c.container.capacity} slots</span>
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {c.stacks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded bg-base-100 px-2 py-1" data-stack={s.item.id}>
                <span className="flex-1">{s.item.name}{s.qty > 1 && <span className="opacity-60"> ×{s.qty}</span>}</span>
                <form action={removeContainerStack.bind(null, characterId, s.id)}>
                  <button className="btn btn-ghost btn-xs" title={s.qty > 1 ? "Take one out" : "Take it out"}>−</button>
                </form>
              </li>
            ))}
            {Array.from({ length: Math.max(0, c.container.capacity! - c.stacks.length) }, (_, i) => (
              <li key={`free-${i}`} className="rounded border border-dashed border-base-content/20 px-2 py-1 opacity-50">empty</li>
            ))}
          </ul>
          <form action={addContainerItem.bind(null, characterId, c.container.id)} className="flex flex-wrap items-center gap-2">
            <select name="item" className="select select-sm flex-1" required defaultValue="">
              <option value="" disabled>Add from the catalogue…</option>
              {items.filter((i) => i.id !== c.container.id).map((i) => (
                <option key={i.id} value={i.id}>{i.name}{(i.max_stack ?? 1) > 1 ? ` (stacks to ${i.max_stack})` : ""}</option>
              ))}
            </select>
            <input name="qty" type="number" min={1} defaultValue={1} className="input input-sm w-20" aria-label="How many" />
            <button className="btn btn-sm">Add</button>
          </form>
        </div>
      ))}
    </section>
  );
}
