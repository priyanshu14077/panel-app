"use client";

import { useCallback, useEffect, useState } from "react";
import type { KnowledgeEvent } from "@/lib/knowledge/cards";
import { readNdjson } from "@/lib/read-ndjson";
import { Card, Chevron } from "./ui";
import { CountUp } from "@/components/motion";

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
    <Card
      title="Knowledge base"
      className="bg-rail"
      action={
        <button className="btn btn--primary" disabled={busy} onClick={refresh}>
          {busy ? "Refreshing…" : k ? "Refresh" : "Build knowledge base"}
        </button>
      }
    >
      {!k && !busy && (
        <p className="text-sm text-muted">
          Build it so runs can pick projects from your GitHub repos and portfolio. The first build makes one Claude call per repo; later refreshes
          only re-read repos you have pushed to since.
        </p>
      )}
      {k && (
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="kpi-label">Repos in use</dt>
            <dd className="kpi-value text-xl">
              <CountUp to={used} duration={800} />
              <span className="text-sm text-muted"> / {k.repos.length}</span>
            </dd>
          </div>
          <div>
            <dt className="kpi-label">Portfolio pages</dt>
            <dd className="kpi-value text-xl">
              <CountUp to={k.site ? k.site.pages : 0} duration={800} />
            </dd>
          </div>
          <div>
            <dt className="kpi-label">Built</dt>
            <dd className="mono mt-2 text-sm">{new Date(k.builtAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</dd>
          </div>
        </dl>
      )}
      {log.length > 0 && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-sunken p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted" aria-live="polite">
          {log.join("\n")}
        </pre>
      )}
      {k && k.repos.length > 0 && (
        <details className="mt-4 border-t border-line pt-3" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="flex min-h-11 items-center gap-2 text-sm font-semibold">
            <Chevron />
            Choose which repos runs may use
          </summary>
          <ul className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {k.repos.map((r) => (
              <li key={r.fullName}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-hover ${r.summary ? "" : "text-muted"}`}>
                  <input type="checkbox" className="mt-1" checked={r.included} disabled={!r.summary} onChange={(e) => toggle(r.fullName, e.target.checked)} />
                  <span className="min-w-0 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <a href={r.url} target="_blank" rel="noreferrer" className="truncate font-semibold">
                        {r.fullName.split("/").pop()}
                      </a>
                      {r.maturity && <span className="badge badge--neutral">{r.maturity}</span>}
                    </span>
                    <span className="mono mt-0.5 block text-xs text-muted">
                      {r.userCommits} commits{r.isPrivate ? " · private" : ""}
                      {r.kind ? ` · ${r.kind}` : " · no commits by you"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
