import { gmDropImprovisation } from "./gmActions";

/** The GM's notice: who wants to improvise, and what (settled at the table). */
export default function ImprovisingCard({ asks }: { asks: { id: number; intent: string; who: string }[] }) {
  if (!asks.length) return null;
  return (
    <div data-improvising-card className="fixed right-4 top-14 z-40 w-80 space-y-2 rounded-box bg-warning/95 p-3 text-sm text-warning-content shadow-xl">
      <div className="font-semibold">💡 Improvising</div>
      {asks.map((a) => (
        <div key={a.id} className="space-y-1 rounded-box bg-base-100/30 p-2">
          <div><b>{a.who}</b>: “{a.intent}”</div>
          <div className="flex gap-2">
            <form action={gmDropImprovisation.bind(null, a.id)}><button className="btn btn-xs">Turn down</button></form>
          </div>
        </div>
      ))}
      <p className="text-xs opacity-80">Talk it over; their planning clock waits meanwhile.</p>
    </div>
  );
}
