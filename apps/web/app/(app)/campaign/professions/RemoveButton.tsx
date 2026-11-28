"use client";

import { useState, useTransition } from "react";

/** Remove with a confirmation step (no browser dialog): the button → the warning, Yes / Cancel. */
export default function RemoveButton({ label, warning, onConfirm }: { label: string; warning: string; onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!asking) return <button type="button" className="btn btn-sm btn-outline btn-error" onClick={() => setAsking(true)} data-remove>{label}</button>;
  return (
    <div role="alert" className="alert alert-error max-w-xl" data-confirm-remove>
      <span>{warning}</span>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => setAsking(false)}>Cancel</button>
        <button type="button" className="btn btn-sm btn-error" disabled={pending} onClick={() => startTransition(() => onConfirm())} data-confirm>Yes, remove</button>
      </div>
    </div>
  );
}
