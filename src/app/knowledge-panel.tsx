"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnowledgeEvent } from "@/lib/knowledge/cards";
import { readNdjson } from "@/lib/read-ndjson";

interface RepoRow {
  fullName: string;
  url: string;
  isPrivate: boolean;
  pushedAt: string;
  userCommits: number;
  included: boolean;
  summary: string | null;
  kind: string | null;
  maturity: string | null;
  stack: string[];
}
interface KnowledgeSummary {
  builtAt: string;
  login: string;
  site: { url: string; pages: number; positioning: string } | null;
  repos: RepoRow[];
}

export function KnowledgePanel() {
  const [k, setK] = useState<KnowledgeSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/knowledge").then((r) => r.json()).then(setK);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    setLog([]);
    const add = (line: string) => setLog((l) => [...l.slice(-200), line]);
    try {
      await readNdjson<KnowledgeEvent>(await fetch("/api/knowledge/refresh", { method: "POST" }), (e) => {
        if (e.type === "stage") add(e.stage);
        if (e.type === "repo") add(`${e.status.padEnd(6)} ${e.name}${e.detail ? `: ${e.detail.slice(0, 120)}` : ""}`);
        if (e.type === "done") add(`Done: ${e.summary.included} of ${e.summary.repos} repos in use, ${e.summary.sitePages} portfolio pages.`);
        if (e.type === "error") add(`Error: ${e.message}`);
      });
    } catch (err) {
      add(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      load();
    }
  }

  async function toggle(fullName: string, included: boolean) {
    setK((cur) => cur && { ...cur, repos: cur.repos.map((r) => (r.fullName === fullName ? { ...r, included } : r)) });
    await fetch("/api/knowledge/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName, included }) });
  }

  const used = k?.repos.filter((r) => r.included && r.summary).length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Knowledge base</h2>
        <button className="rounded-md border border-border px-2 py-1 text-xs font-medium disabled:opacity-50" disabled={busy} onClick={refresh}>
          {busy ? "Refreshing…" : k ? "Refresh" : "Build"}
        </button>
      </div>
      {!k && !busy && (
        <p className="text-sm text-muted">
          Not built yet. Build it to let runs pick projects from your GitHub repos and portfolio. The first build makes one Claude call per repo; later
          refreshes only re-read repos you have pushed to since.
        </p>
      )}
      {k && (
        <p className="text-sm text-muted">
          {used} of {k.repos.length} repos in use{k.site ? ` · ${k.site.pages} portfolio pages` : " · no portfolio"} · built{" "}
          {new Date(k.builtAt).toLocaleDateString()}
        </p>
      )}
      {log.length > 0 && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px] leading-relaxed text-muted">
          {log.join("\n")}
        </pre>
      )}
      {k && k.repos.length > 0 && (
        <button className="mt-3 text-xs font-medium text-accent" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide repos" : "Choose which repos runs may use"}
        </button>
      )}
      {open && k && (
        <ul className="mt-2 max-h-[28rem] space-y-2 overflow-auto pr-1">
          {k.repos.map((r) => (
            <li key={r.fullName} className="rounded-md border border-border p-2">
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={r.included} disabled={!r.summary} onChange={(e) => toggle(r.fullName, e.target.checked)} />
                <span className="min-w-0">
                  <a href={r.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {r.fullName}
                  </a>
                  <span className="text-muted">
                    {" "}
                    · {r.userCommits} commits{r.isPrivate ? " · private" : ""}
                    {r.kind ? ` · ${r.kind}, ${r.maturity}` : " · empty"}
                  </span>
                  {r.summary && <span className="mt-0.5 block text-muted">{r.summary}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
