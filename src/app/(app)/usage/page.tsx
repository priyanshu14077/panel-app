"use client";

import { useEffect, useState } from "react";
import type { UsageRecord } from "@/lib/usage";
import { Card, Chevron, PageHeader } from "@/app/ui";
import { CountUp } from "@/components/motion";

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
  "project-chat": "Project interviews",
  shortlist: "Repo shortlist",
  details: "Job details",
};

// Which tier each feature runs on, for the cost-by-tier colours.
type Tier = "fast" | "writer" | "research";
const TIER_OF: Record<string, Tier> = {
  review: "fast",
  findings: "fast",
  rescreen: "fast",
  details: "fast",
  shortlist: "fast",
  knowledge: "fast",
  outreach: "writer",
  rebuild: "writer",
  ideas: "writer",
  answers: "writer",
  "add-project": "writer",
  "company-ideas": "writer",
  "project-chat": "writer",
  chat: "writer",
  email: "writer",
  eval: "writer",
  "company-research": "research",
};
const TIERS: { id: Tier; label: string; series: string }[] = [
  { id: "writer", label: "Writing", series: "series-1" },
  { id: "research", label: "Web research", series: "series-2" },
  { id: "fast", label: "Reading and grading", series: "series-3" },
];
const tierOf = (action: string): Tier => TIER_OF[action] ?? "writer";

export default function UsagePage() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    fetch("/api/usage").then((r) => r.json()).then(setU);
  }, []);

  const byTier = TIERS.map((t) => ({ ...t, cost: u?.byAction.filter((a) => tierOf(a.action) === t.id).reduce((s, a) => s + a.cost, 0) ?? 0 }));
  const top = Math.max(...(u?.byAction.map((a) => a.cost) ?? [0]), 0.0001);
  const cached = u?.byRun.reduce((s, r) => s + r.calls_detail.reduce((t, c) => t + c.cacheReadTokens, 0), 0) ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      <PageHeader title="Usage & cost">
        Every Claude call the app makes, priced at list rates per million input / output tokens: Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus
        5.5 $4 / $20; web search $10 per 1,000. Thinking tokens bill as output.
      </PageHeader>
      {u && (
        <p className="text-sm">
          Model profile <span className="badge badge--primary">{u.profile}</span>
          <span className="text-muted">
            {" "}
            reads and grades on <span className="mono">{u.models.fast}</span>, writes on <span className="mono">{u.models.writer}</span>, researches
            on <span className="mono">{u.models.research}</span>. Change it with <code>MODEL_PROFILE</code> in <code>.env.local</code>.
          </span>
        </p>
      )}
      {!u && <p className="streaming text-muted">Loading usage…</p>}
      {u && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ["Total spend", <CountUp key="c" to={u.total.cost} decimals={2} prefix="$" />, true],
                ["Claude calls", <CountUp key="n" to={u.total.calls} />, false],
                ["Tokens in / out", `${k(u.total.inputTokens)} / ${k(u.total.outputTokens)}`, false],
                ["Web searches", <CountUp key="w" to={u.total.webSearches} />, false],
              ] as [string, React.ReactNode, boolean][]
            ).map(([label, value, cost], i) => (
              <div key={label} className="card hp-enter p-5" style={{ "--i": i } as React.CSSProperties}>
                <p className="kpi-label">{label}</p>
                <p className={`kpi-value mono mt-2 whitespace-nowrap ${cost ? "kpi-value--cost" : ""} ${label === "Tokens in / out" ? "text-[clamp(18px,1.7vw,26px)]" : ""}`}>{value}</p>
                {label === "Tokens in / out" && cached > 0 && <p className="mono mt-1 text-xs text-muted">{k(cached)} read from cache</p>}
              </div>
            ))}
          </div>

          <Card title="Cost by feature">
            <div className="flex flex-col gap-3">
              <div className="flex h-3 overflow-hidden rounded-full bg-track" role="img" aria-label="Total spend split by tier">
                {byTier.map((t) => (
                  <span key={t.id} className={`hp-grow ${t.series}`} style={{ width: `${(t.cost / (u.total.cost || 1)) * 100}%` }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {byTier.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${t.series}`} aria-hidden />
                    {t.label}
                    <span className="mono text-muted">{usd(t.cost)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="table-scroll mt-6">
              <table className="table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th className="w-[40%]">Share</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Tokens in / out</th>
                    <th className="text-right">Avg per call</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {u.byAction.map((a) => (
                    <tr key={a.action}>
                      <td className="font-semibold">{ACTION_LABELS[a.action] ?? a.action}</td>
                      <td>
                        <div className="h-2 rounded-full bg-track">
                          <span
                            className={`hp-grow block h-2 rounded-full ${TIERS.find((t) => t.id === tierOf(a.action))!.series}`}
                            style={{ width: `${Math.max((a.cost / top) * 100, 1)}%` }}
                          />
                        </div>
                      </td>
                      <td className="mono text-right">{a.calls}</td>
                      <td className="mono text-right">
                        {k(a.inputTokens)} / {k(a.outputTokens)}
                      </td>
                      <td className="mono text-right">{usd(a.cost / a.calls)}</td>
                      <td className="mono text-right font-semibold">{usd(a.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section className="flex flex-col gap-4">
            <h2>By run</h2>
            {u.byRun.length === 0 && <p className="text-muted">No metered calls yet. Start a run from the Workspace.</p>}
            <div className="card overflow-hidden p-0">
              {u.byRun.map((r) => (
                <details key={r.runId || "other"} className="border-b border-line-subtle last:border-b-0">
                  <summary className="flex min-h-14 flex-wrap items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                    <Chevron />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.label}</span>
                      <span className="mono block text-xs text-muted">
                        {r.calls} calls · {new Date(r.lastAt).toLocaleString()}
                      </span>
                    </span>
                    <span className="mono font-semibold text-[var(--cost-total)]">{usd(r.cost)}</span>
                  </summary>
                  <div className="table-scroll px-5 pb-5">
                    <table className="table mono text-xs">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Action</th>
                          <th>Model</th>
                          <th className="text-right">In</th>
                          <th className="text-right">Cached</th>
                          <th className="text-right">Out</th>
                          <th className="text-right">Searches</th>
                          <th className="text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.calls_detail.map((c, i) => (
                          <tr key={i}>
                            <td>{new Date(c.at).toLocaleTimeString()}</td>
                            <td>{c.action}</td>
                            <td className="text-muted">{c.model}</td>
                            <td className="text-right">{k(c.inputTokens + c.cacheWriteTokens)}</td>
                            <td className="text-right">{c.cacheReadTokens ? k(c.cacheReadTokens) : ""}</td>
                            <td className="text-right">{k(c.outputTokens)}</td>
                            <td className="text-right">{c.webSearches || ""}</td>
                            <td className="text-right">{usd(c.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
