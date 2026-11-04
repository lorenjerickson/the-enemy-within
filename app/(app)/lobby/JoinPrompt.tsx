"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { waitingSession } from "./actions";

type Waiting = Awaited<ReturnType<typeof waitingSession>>;
const DISMISSED = "dismissedSession";

/**
 * For players: when a session is open (on login, or when the GM opens one later), asks them to join it.
 * "Not now" hides it for that session until the browser tab is closed; the home page still offers Join.
 */
export default function JoinPrompt({ initial }: { initial: Waiting }) {
  const [waiting, setWaiting] = useState(initial);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    try {
      setDismissed(Number(sessionStorage.getItem(DISMISSED)) || null);
    } catch {}
    const timer = setInterval(() => waitingSession().then(setWaiting).catch(() => {}), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Not on the pages that join (the lobby, and creating a character first).
  if (!waiting || waiting.id === dismissed || pathname === "/lobby" || pathname === "/character/new") return null;
  const notNow = () => {
    setDismissed(waiting.id);
    try {
      sessionStorage.setItem(DISMISSED, String(waiting.id));
    } catch {}
  };
  return (
    <dialog open className="modal modal-open" aria-labelledby="join-title">
      <div className="modal-box space-y-3">
        <h3 id="join-title" className="text-lg font-semibold">Session {waiting.number} {waiting.began ? "is under way" : "is waiting for you"}</h3>
        <p className="opacity-80">{waiting.began ? "The GM has begun. Join the others?" : "The GM has opened the session. Join the others in the lobby?"}</p>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={notNow}>Not now</button>
          <button type="button" className="btn btn-primary" onClick={() => router.push("/lobby")}>Join</button>
        </div>
      </div>
    </dialog>
  );
}
