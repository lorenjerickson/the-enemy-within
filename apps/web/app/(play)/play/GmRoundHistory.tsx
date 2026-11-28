/**
 * The GM's account of every round of the encounter so far, newest first: each round in the order things happened
 * (who did what, and what befell them, with exact damage), a line per second.
 */
export type GmRound = { round: number; seconds: { sec: number; lines: string[] }[] };

export default function GmRoundHistory({ rounds }: { rounds: GmRound[] }) {
  if (!rounds.length) return null;
  const shown = [...rounds].sort((a, b) => b.round - a.round);
  return (
    <section data-gm-round-history className="space-y-1">
      <div className="text-xs font-semibold opacity-80">Rounds so far</div>
      <ol className="max-h-96 space-y-2 overflow-y-auto pr-1">
        {shown.map((r, i) => (
          <li key={r.round} data-gm-round={r.round} className={`rounded-box p-2 text-xs leading-relaxed ${i === 0 ? "bg-base-100/80" : "bg-base-100/40 opacity-80"}`}>
            <div className="font-semibold opacity-70">Round {r.round}{i === 0 ? " · latest" : ""}</div>
            {r.seconds.length ? (
              r.seconds.map((s) => (
                <p key={s.sec}><span className="opacity-60">{s.sec} s</span> {s.lines.join(" ")}</p>
              ))
            ) : (
              <p className="opacity-70">Nothing happened.</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
