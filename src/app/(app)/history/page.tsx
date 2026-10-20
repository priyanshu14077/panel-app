"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MessageHit, MessageKind } from "@/lib/db";
import { Card, Chevron, CopyButton, Notice, PageHeader } from "@/app/ui";

interface Result {
  hits: MessageHit[];
  companies: string[];
  stages: string[];
  counts: Record<string, number>;
}

const KINDS: [MessageKind | "", string][] = [
  ["", "Everything"],
  ["chat", "Application Q&A"],
  ["project-interview", "Project interviews"],
  ["email", "Emails"],
  ["outreach", "Outreach"],
];

// Where each kind of message lives in the workspace.
const TAB: Record<MessageKind, string> = { chat: "qa", "project-interview": "interview", email: "email", outreach: "email" };

export default function HistoryPage() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<MessageKind | "">("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState("");
  const [role, setRole] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  // Typing waits a beat before searching; the filters apply at once.
  useEffect(() => {
    const params = new URLSearchParams(Object.entries({ q, kind, company, stage, role, from, to }).filter(([, v]) => v));
    const timer = setTimeout(() => {
      fetch(`/api/history?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((r: Result) => {
          setResult(r);
          setError("");
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, kind, company, stage, role, from, to]);

  const filtered = Boolean(q || kind || company || stage || role || from || to);
  const clear = () => {
    setQ("");
    setKind("");
    setCompany("");
    setStage("");
    setRole("");
    setFrom("");
    setTo("");
  };

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      <PageHeader title="History">Every Q&A answer, project interview, email and outreach message across your runs, stored in one SQLite file and searchable.</PageHeader>

      <Card className="p-5">
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="field-label">Search</span>
            <input className="input w-full" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="celery retries, referral, notice period…" />
          </label>
          <div role="tablist" aria-label="Kind" className="segmented self-start">
            {KINDS.map(([id, label]) => (
              <button key={id || "all"} role="tab" aria-selected={kind === id} onClick={() => setKind(id)}>
                {label}
                {id && result?.counts[id] ? <span className="mono ml-2 text-xs text-muted">{result.counts[id]}</span> : null}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block">
              <span className="field-label">Company</span>
              <select className="input w-full" value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">Any</option>
                {result?.companies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Board stage</span>
              <select className="input w-full" value={stage} onChange={(e) => setStage(e.target.value)}>
                <option value="">Any</option>
                {result?.stages.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Written by</span>
              <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Anyone</option>
                <option value="user">You</option>
                <option value="assistant">Claude</option>
              </select>
            </label>
            <label className="block">
              <span className="field-label">From</span>
              <input className="input w-full" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">To</span>
              <input className="input w-full" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        </div>
      </Card>

      {error && <Notice tone="fail">{error}</Notice>}

      <section className="flex flex-col gap-3" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h2>{result ? `${result.hits.length}${result.hits.length === 200 ? "+" : ""} message${result.hits.length === 1 ? "" : "s"}` : "Loading"}</h2>
          {filtered && (
            <button type="button" className="link-btn text-sm" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
        {result?.hits.length === 0 && <p className="text-sm text-muted">Nothing matches. Try fewer words or clear a filter.</p>}
        <ul className="flex flex-col gap-3">
          {result?.hits.map((h) => (
            <li key={h.id}>
              <details className="card p-4">
                <summary className="flex cursor-pointer flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{h.company || h.runId}</span>
                    <span className="badge badge--neutral">{KINDS.find(([id]) => id === h.kind)?.[1]}</span>
                    {h.kind !== "chat" && <span className="text-muted">{h.thread}</span>}
                    <span className={`badge ${h.role === "user" ? "badge--accent" : "badge--neutral"}`}>{h.role === "user" ? "You" : "Claude"}</span>
                    <span className="mono ml-auto text-xs text-muted">{new Date(h.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                    <Chevron />
                  </span>
                  <span className="text-sm text-muted">{h.snippet}</span>
                </summary>
                <p className="mt-3 whitespace-pre-wrap border-t border-line-subtle pt-3 text-sm leading-relaxed">{h.text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <CopyButton text={h.text} />
                  <Link className="link-btn text-sm" href={`/workspace?run=${h.runId}&tab=${TAB[h.kind]}`}>
                    Open in the run
                  </Link>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
