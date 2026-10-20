import { connection, type NextRequest } from "next/server";
import { filterJobs, jobFacetCounts, type JobFilter } from "@/lib/db";
import { evaluateRun } from "@/lib/evals";
import { jobFacets, similarJobs } from "@/lib/jobs";
import { loadAllRuns, type Run } from "@/lib/pipeline";
import type { Board } from "@/lib/schemas";
import { readUsage } from "@/lib/usage";

const DAY = 86_400_000;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);

// What needs doing on this card today.
function dueFor(run: Run, board: Board): string[] {
  const due: string[] = [];
  const d = run.details;
  const emailed = (kind: string) => (run.emails ?? []).some((e) => e.kind === kind);
  if (board.stage === "To apply") {
    if (d?.applyEmail && !board.sent["application-email"]) due.push(`Email your application to ${d.applyEmail}`);
    else if (!board.sent["application-email"]) due.push("Apply, then move the card to Applied");
  }
  if (board.stage === "Applied") {
    const since = daysSince(board.sent["application-email"] ?? board.movedAt);
    if (since >= 5 && !board.sent["follow-up"]) due.push(`Follow up: applied ${since} days ago`);
  }
  const outreachSent = board.sent.outreach;
  const sequence = run.outreach?.at(-1);
  if (outreachSent && sequence && board.stage !== "Closed") {
    const elapsed = daysSince(outreachSent);
    const step = [...sequence.steps].reverse().find((s) => s.day > 0 && s.day <= elapsed);
    const last = Math.max(...sequence.steps.map((s) => s.day));
    if (step && elapsed <= last + 1) due.push(`Outreach day ${step.day}: ${step.channel} to ${step.recipient} (${step.sendIf})`);
  }
  if (board.stage === "Interviewing" && !board.sent["thank-you"] && !emailed("thank-you")) due.push("Send a thank-you note after the interview");
  return due;
}

function filterOf(p: URLSearchParams): JobFilter {
  const text = (k: string) => p.get(k) || undefined;
  return {
    q: text("q"),
    family: text("family"),
    level: text("level"),
    mode: text("mode"),
    region: text("region"),
    verdict: text("verdict"),
    stage: text("stage"),
    fit: p.get("fit") === "1",
    minAts: Number(p.get("minAts")) || undefined,
    repeats: p.get("repeats") === "1",
  };
}

export async function GET(req: NextRequest) {
  await connection(); // the database is read synchronously; never prerender it
  const [all, usage] = await Promise.all([loadAllRuns(), readUsage()]);
  const byId = new Map(all.map((r) => [r.id, r]));
  const matches = filterJobs(filterOf(req.nextUrl.searchParams));
  const runs = matches.map((m) => byId.get(m.id)).filter((r): r is Run => Boolean(r));
  const repeats = new Map(matches.map((m) => [m.id, all.filter((r) => r.id !== m.id && r.synthesis && jobFacets(r).groupKey === m.groupKey).map((r) => ({ id: r.id, createdAt: r.createdAt }))]));
  const cost = new Map<string, number>();
  for (const u of usage) if (u.runId) cost.set(u.runId, (cost.get(u.runId) ?? 0) + u.cost);

  const cards = [];
  for (const run of runs) {
    if (!run.synthesis) continue;
    const board: Board = run.board ?? { stage: "To apply", movedAt: run.createdAt, notes: "", sent: {} };
    const evals = await evaluateRun(run);
    cards.push({
      id: run.id,
      createdAt: run.createdAt,
      company: run.synthesis.job.company,
      role: run.synthesis.job.role,
      details: run.details ?? null,
      board,
      screen: { before: run.reviews.find((r) => r.id === "screen")?.verdict ?? "?", after: run.rescreens.at(-1)?.verdict ?? "?" },
      evalFails: evals.filter((e) => e.status === "fail").length,
      cost: cost.get(run.id) ?? 0,
      drafted: {
        "application-email": (run.emails ?? []).some((e) => e.kind === "application"),
        outreach: Boolean(run.outreach?.length),
        referral: (run.emails ?? []).some((e) => e.kind === "referral"),
        "form-answers": Boolean(run.chat?.length),
        "follow-up": (run.emails ?? []).some((e) => e.kind === "follow-up"),
        "thank-you": (run.emails ?? []).some((e) => e.kind === "thank-you"),
      },
      due: dueFor(run, board),
      hasPdf: Boolean(run.pdf),
      facets: jobFacets(run),
      repeats: repeats.get(run.id) ?? [],
      similar: similarJobs(run, all),
    });
  }
  return Response.json({ cards, counts: jobFacetCounts(), postings: new Set(all.filter((r) => r.synthesis).map((r) => jobFacets(r).groupKey)).size });
}
