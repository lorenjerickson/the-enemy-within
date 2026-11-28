import type { Summary } from "@/lib/sessionLog";

/** What happened in a session, written when it ended. */
export default function SessionSummary({ summary }: { summary: string | null }) {
  const sections: Summary = summary ? JSON.parse(summary) : [];
  if (!sections.length) return <p className="text-sm opacity-70">Nothing was recorded.</p>;
  return (
    <div className="space-y-3 text-sm">
      {sections.map((s) => (
        <div key={s.heading}>
          <h4 className="font-semibold">{s.heading}</h4>
          <ul className="list-disc pl-5 opacity-80">
            {s.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
