"use client";

import { useState } from "react";

/**
 * Uploads a campaign export to /campaign/import as the request body (with progress: an export with all the media can
 * be a few hundred MB), then sends the GM to log in again, since the accounts were replaced.
 */
export default function CampaignImport() {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = () => {
    if (!file || !confirmed) return;
    setBusy(true);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/campaign/import?replace=1");
    xhr.setRequestHeader("Content-Type", "application/zip");
    xhr.upload.onprogress = (e) => e.lengthComputable && setStatus({ text: `Uploading… ${Math.round((e.loaded / e.total) * 100)}%` });
    xhr.upload.onload = () => setStatus({ text: "Importing…" });
    xhr.onload = () => {
      let r: { ok: boolean; error?: string; rows?: number; files?: number } = { ok: false, error: `Server answered ${xhr.status}` };
      try {
        r = JSON.parse(xhr.responseText);
      } catch {}
      if (r.ok) {
        setStatus({ text: `Imported ${r.rows} records and ${r.files} files. Log in again…` });
        setTimeout(() => (window.location.href = "/login"), 1500);
      } else {
        setStatus({ text: `Import failed: ${r.error}`, error: true });
        setBusy(false);
      }
    };
    xhr.onerror = () => {
      setStatus({ text: "Import failed: the upload was cut off (connection lost or the server restarted)", error: true });
      setBusy(false);
    };
    xhr.send(file);
  };

  return (
    <div className="space-y-2 pt-2" data-campaign-import>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".zip,application/zip" className="file-input file-input-sm" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label className="flex items-center gap-1">
          <input type="checkbox" className="checkbox checkbox-sm" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />
          Replace everything on this server with it
        </label>
        <button type="button" className="btn btn-sm btn-warning" disabled={!file || !confirmed || busy} onClick={upload}>Import</button>
      </div>
      {status && <p className={status.error ? "text-error" : "opacity-80"} data-import-status>{status.text}</p>}
    </div>
  );
}
