"use client";

import { useEffect, useState } from "react";
import type { EvalResult, Status } from "@/lib/evals";

interface Row {
  id: string;
  createdAt: string;
  label: string;
  results: EvalResult[];
}

const TONE: Record<Status, string> = {
  pass: "text-good border-good",
  warn: "text-warn border-warn",
  fail: "text-bad border-bad",
  skip: "text-muted border-border",
};

// Checks that repeat per item (one per email, per chat answer) share a prefix.
const checkKey = (id: string) => id.replace(/-\d.*$/, "").replace(/^(email|outreach|chat)-.*/, "$1");

const DESCRIPTIONS: Record<string, string> = {
  reviewers: "All seven panel calls returned a verdict.",
  rebuilt: "The run produced a rebuilt resume (fails when the run errored).",
  screen: "The automated screen's verdict after the rebuild is no worse than before.",
  keywords: "The re-screen lists fewer missing posting keywords than the first screen.",
  "one-page": "The compiled PDF is exactly one page.",
  placeholders: "No [ADD], TODO or REPLACE text reached the PDF.",
  "links-real": "No placeholder URLs in the PDF.",
  "open-questions": "Questions still waiting on you (their lines are held back).",
  numbers: "Every number on the resume appears in your original resume, profile or knowledge base.",
  skills: "Every listed skill appears in your sources.",
  urls: "Every company and project link comes from your profile or repos.",
  judge: "A Claude fact-checker reads every resume line against your sources.",
  email: "Emails stay under 170 words with no stock phrases.",
  outreach: "Connection notes ≤ 200 chars, messages ≤ 600 chars, emails short, no stock phrases.",
  chat: "Form answers respect the stated word limit and avoid stock phrases.",
};

export default function EvalsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [judging, setJudging] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/evals").then((r) => r.json()).then(setRows);
  }, []);

  async function judge(id: string) {
    setJudging(id);
    setError("");
    try {
      const res = await fetch(`/api/runs/${id}/judge`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, results: data } : r)) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJudging(null);
    }
  }

  // Pass rate per check across all runs.
  const suite = new Map<string, { name: string; pass: number; total: number }>();
  for (const r of rows ?? [])
    for (const e of r.results) {
      if (e.status === "skip") continue;
      const k = checkKey(e.id);
      const cur = suite.get(k) ?? { name: k, pass: 0, total: 0 };
      suite.set(k, { ...cur, pass: cur.pass + (e.status === "pass" ? 1 : 0), total: cur.total + 1 });
    }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Evals</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Checks that run on every saved run. All are free except the grounding judge, which is one Claude call per run. Grounding checks guard
        against the main risk of this app: a resume line that isn&rsquo;t true.
      </p>
      {error && <p className="mt-4 rounded-md border border-bad px-3 py-2 text-sm text-bad">{error}</p>}
      {!rows && <p className="mt-6 text-sm text-muted">Loading…</p>}

      {rows && (
        <section className="mt-6 rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Suite: pass rate across {rows.length} runs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {[...suite.entries()].map(([k, v]) => {
                  const rate = v.total ? v.pass / v.total : 0;
                  return (
                    <tr key={k} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-medium">{k}</td>
                      <td className="py-1.5 pr-3 text-xs text-muted">{DESCRIPTIONS[k] ?? ""}</td>
                      <td className="w-40 py-1.5">
                        <div className="h-1.5 rounded bg-background">
                          <div className={`h-1.5 rounded ${rate === 1 ? "bg-good" : rate >= 0.5 ? "bg-warn" : "bg-bad"}`} style={{ width: `${rate * 100}%` }} />
                        </div>
                      </td>
                      <td className="w-16 py-1.5 text-right text-xs tabular-nums">
                        {v.pass}/{v.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-6 space-y-4">
        {rows?.map((r) => {
          const counts = { pass: 0, warn: 0, fail: 0, skip: 0 } as Record<Status, number>;
          for (const e of r.results) counts[e.status]++;
          return (
            <details key={r.id} className="rounded-lg border border-border bg-surface p-4" open={counts.fail > 0}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{r.label}</span>
                <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
                <span className="ml-auto flex gap-1">
                  {(["pass", "warn", "fail"] as Status[]).map((s) =>
                    counts[s] ? (
                      <span key={s} className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${TONE[s]}`}>
                        {counts[s]} {s}
                      </span>
                    ) : null,
                  )}
                </span>
              </summary>
              <ul className="mt-3 space-y-2">
                {r.results.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase ${TONE[e.status]}`}>{e.status}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{e.name}</span>
                      <span className="block whitespace-pre-wrap text-xs text-muted">{e.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {r.results.some((e) => e.id === "judge") && (
                <button
                  className="mt-3 rounded-md border border-border px-2 py-1 text-xs font-medium disabled:opacity-50"
                  disabled={judging !== null}
                  onClick={() => judge(r.id)}
                >
                  {judging === r.id ? "Judging…" : "Run grounding judge (1 Claude call)"}
                </button>
              )}
            </details>
          );
        })}
      </div>
    </main>
  );
}
