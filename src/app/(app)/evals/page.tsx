"use client";

import { useEffect, useState } from "react";
import type { EvalResult, Status } from "@/lib/evals";
import { Chevron, Notice, PageHeader } from "@/app/ui";

interface Row {
  id: string;
  createdAt: string;
  label: string;
  results: EvalResult[];
}

const BADGE: Record<Status, string> = {
  pass: "badge badge--pass",
  warn: "badge badge--warn",
  fail: "badge badge--fail",
  skip: "badge badge--neutral text-muted",
};
const rateTone = (rate: number) => (rate === 1 ? "var(--eval-pass)" : rate >= 0.5 ? "var(--eval-warn)" : "var(--eval-fail)");

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

  const checks = [...suite.entries()];
  const totals = checks.reduce((t, [, v]) => ({ pass: t.pass + v.pass, total: t.total + v.total }), { pass: 0, total: 0 });

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      <PageHeader title="Evals">
        Checks that run on every saved run. All are free except the grounding judge, which is one Claude call per run. Grounding checks guard
        against the main risk of this app: a resume line that isn&rsquo;t true.
      </PageHeader>
      {error && <Notice tone="fail">{error}</Notice>}
      {!rows && <p className="streaming text-muted">Loading evals…</p>}

      {rows && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2>Suite pass rates</h2>
            <span className="mono text-sm text-muted">
              {totals.pass} / {totals.total} checks passed across {rows.length} runs
            </span>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {checks.map(([k, v]) => {
              const rate = v.total ? v.pass / v.total : 0;
              return (
                <div key={k} className="card flex flex-col gap-2 p-5">
                  <p className="kpi-label mono">{k}</p>
                  <p className="kpi-value">
                    {Math.round(rate * 100)}
                    <span className="text-lg text-muted">%</span>
                  </p>
                  <div className="progress" role="img" aria-label={`${v.pass} of ${v.total} passed`}>
                    <span style={{ width: `${rate * 100}%`, background: rateTone(rate) }} />
                  </div>
                  <p className="mono text-xs text-muted">
                    {v.pass} / {v.total} runs
                  </p>
                  <p className="text-sm text-muted">{DESCRIPTIONS[k] ?? ""}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rows && rows.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2>By run</h2>
          <div className="card overflow-hidden p-0">
            {rows.map((r) => {
              const counts = { pass: 0, warn: 0, fail: 0, skip: 0 } as Record<Status, number>;
              for (const e of r.results) counts[e.status]++;
              return (
                <details key={r.id} className="border-b border-line-subtle last:border-b-0" open={counts.fail > 0}>
                  <summary className="flex min-h-14 flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                    <Chevron />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.label}</span>
                      <span className="mono block text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
                    </span>
                    <span className="flex gap-1.5">
                      {(["pass", "warn", "fail"] as Status[]).map((s) =>
                        counts[s] ? (
                          <span key={s} className={BADGE[s]}>
                            {counts[s]} {s}
                          </span>
                        ) : null,
                      )}
                    </span>
                  </summary>
                  <div className="table-scroll px-5 pb-5">
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="w-20">Result</th>
                          <th>Check</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.results.map((e) => (
                          <tr key={e.id}>
                            <td className="align-top">
                              <span className={BADGE[e.status]}>{e.status}</span>
                            </td>
                            <td className="align-top font-semibold">{e.name}</td>
                            <td className="align-top text-sm whitespace-pre-wrap text-muted">{e.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {r.results.some((e) => e.id === "judge") && (
                      <button className="btn mt-4" disabled={judging !== null} onClick={() => judge(r.id)}>
                        {judging === r.id ? "Judging…" : "Run the grounding judge (1 Claude call)"}
                      </button>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
