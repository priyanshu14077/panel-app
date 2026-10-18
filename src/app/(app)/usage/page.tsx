"use client";

import { useEffect, useState } from "react";
import type { UsageRecord } from "@/lib/usage";

interface Totals {
  calls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}
interface Usage {
  profile: string;
  models: Record<string, string>;
  total: Totals;
  byAction: (Totals & { action: string })[];
  byRun: (Totals & { runId: string; label: string; lastAt: string; calls_detail: UsageRecord[] })[];
}

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const ACTION_LABELS: Record<string, string> = {
  review: "Panel reviewers",
  findings: "Merge findings",
  rebuild: "Resume rebuild",
  ideas: "Project ideas",
  rescreen: "Re-screen",
  answers: "Answer questions",
  "add-project": "Add a project",
  "company-research": "Company research (web)",
  "company-ideas": "Company project ideas",
  chat: "Application Q&A turns",
  email: "Emails",
  outreach: "Outreach sequences",
  knowledge: "Knowledge base",
  eval: "Evals (judge)",
};

export default function UsagePage() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    fetch("/api/usage").then((r) => r.json()).then(setU);
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Usage &amp; cost</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Every Claude call the app makes, priced at list rates per million input / output tokens: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus
        5.5 $4 / $20; web search $10 per 1,000. Thinking tokens bill as output. Calls made before metering was added are not counted.
      </p>
      {u && (
        <p className="mt-3 text-sm">
          Model profile: <span className="font-medium">{u.profile}</span>
          <span className="text-muted">
            {" "}
            · reading and grading on {u.models.fast} · writing on {u.models.writer} · web research on {u.models.research}. Change it with{" "}
            <code>MODEL_PROFILE=economy|balanced|quality</code> in <code>.env.local</code>.
          </span>
        </p>
      )}
      {!u && <p className="mt-6 text-sm text-muted">Loading…</p>}
      {u && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {[
              ["Total spend", usd(u.total.cost)],
              ["Claude calls", String(u.total.calls)],
              ["Tokens in / out", `${k(u.total.inputTokens)} / ${k(u.total.outputTokens)}`],
              ["Web searches", String(u.total.webSearches)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          <section className="mt-6 rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">By feature</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Feature</th>
                    <th className="py-1 pr-3 text-right font-medium">Calls</th>
                    <th className="py-1 pr-3 text-right font-medium">Tokens in / out</th>
                    <th className="py-1 pr-3 text-right font-medium">Avg per call</th>
                    <th className="py-1 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {u.byAction.map((a) => (
                    <tr key={a.action} className="border-t border-border">
                      <td className="py-1.5 pr-3">{ACTION_LABELS[a.action] ?? a.action}</td>
                      <td className="py-1.5 pr-3 text-right">{a.calls}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {k(a.inputTokens)} / {k(a.outputTokens)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{usd(a.cost / a.calls)}</td>
                      <td className="py-1.5 text-right font-medium">{usd(a.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">By run, every call</h2>
            {u.byRun.map((r) => (
              <details key={r.runId || "other"} className="rounded-lg border border-border bg-surface p-4">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs text-muted">{r.calls} calls</span>
                  <span className="ml-auto font-medium tabular-nums">{usd(r.cost)}</span>
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead className="text-left text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Time</th>
                        <th className="py-1 pr-3 font-medium">Action</th>
                        <th className="py-1 pr-3 font-medium">Model</th>
                        <th className="py-1 pr-3 text-right font-medium">In</th>
                        <th className="py-1 pr-3 text-right font-medium">Cached</th>
                        <th className="py-1 pr-3 text-right font-medium">Out</th>
                        <th className="py-1 pr-3 text-right font-medium">Searches</th>
                        <th className="py-1 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.calls_detail.map((c, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1 pr-3">{new Date(c.at).toLocaleTimeString()}</td>
                          <td className="py-1 pr-3">{c.action}</td>
                          <td className="py-1 pr-3 text-muted">{c.model}</td>
                          <td className="py-1 pr-3 text-right">{k(c.inputTokens + c.cacheWriteTokens)}</td>
                          <td className="py-1 pr-3 text-right">{k(c.cacheReadTokens)}</td>
                          <td className="py-1 pr-3 text-right">{k(c.outputTokens)}</td>
                          <td className="py-1 pr-3 text-right">{c.webSearches || ""}</td>
                          <td className="py-1 text-right">{usd(c.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
            {u.byRun.length === 0 && <p className="text-sm text-muted">No metered calls yet.</p>}
          </section>
        </>
      )}
    </main>
  );
}
