import { PROFILE, PROFILE_MODELS } from "@/lib/claude";
import { listRuns } from "@/lib/pipeline";
import { readUsage, type UsageRecord } from "@/lib/usage";

function sum(records: UsageRecord[]) {
  return records.reduce(
    (a, r) => ({
      calls: a.calls + 1,
      cost: a.cost + r.cost,
      inputTokens: a.inputTokens + r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens,
      outputTokens: a.outputTokens + r.outputTokens,
      webSearches: a.webSearches + r.webSearches,
    }),
    { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0, webSearches: 0 },
  );
}

// "review:ceo" and "review:rival" group as "review"; "email:application" as "email".
const family = (action: string) => action.split(":")[0];

export async function GET() {
  const [records, runs] = await Promise.all([readUsage(), listRuns()]);
  const labels = new Map(runs.map((r) => [r.id, r.synthesis ? `${r.synthesis.job.company} · ${r.synthesis.job.role}` : r.id]));

  const byRunId = new Map<string, UsageRecord[]>();
  for (const r of records) byRunId.set(r.runId ?? "", [...(byRunId.get(r.runId ?? "") ?? []), r]);
  const byFamily = new Map<string, UsageRecord[]>();
  for (const r of records) byFamily.set(family(r.action), [...(byFamily.get(family(r.action)) ?? []), r]);

  return Response.json({
    profile: PROFILE,
    models: PROFILE_MODELS,
    total: sum(records),
    byAction: [...byFamily.entries()].map(([action, rs]) => ({ action, ...sum(rs) })).sort((a, b) => b.cost - a.cost),
    byRun: [...byRunId.entries()]
      .map(([runId, rs]) => ({
        runId,
        label: runId ? (labels.get(runId) ?? runId) : "Knowledge base and other",
        lastAt: rs.at(-1)!.at,
        ...sum(rs),
        calls_detail: rs,
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
  });
}
