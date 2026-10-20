// Runs the resume pipeline on a frozen set of real postings and measures the
// result, so a prompt or code change can be compared against the last run.
//
//   npx tsx --env-file=.env.local scripts/eval-suite.mts --seed     freeze the cases (no Claude calls)
//   npx tsx --env-file=.env.local scripts/eval-suite.mts            run every case (~$0.08 each)
//   ... --only kalepa,n26 --notes "why this run" --concurrency 3
//
// Cases run in a sandbox copy of resume/ (profile, PDFs, knowledge base) under
// .hiring-panel/evals/<suite>/, so no real run, PDF or board card is touched.
// Cases and results are stored in the real panel.db.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { openEvalStore, type EvalCase } from "../src/lib/eval-store.ts";
import type { CaseResult, SuiteSummary } from "../src/lib/eval-suite.ts";

const REAL_ROOT = process.env.JOB_HUNT_ROOT ?? path.resolve(process.cwd(), "..");
const REAL_DB = path.join(REAL_ROOT, ".hiring-panel", "panel.db");

// The frozen set: real runs, each restarted from the base resume it began
// with. A knockout is a posting requirement no resume can meet; a REJECT on
// such a case is not the resume's fault.
const SEED: { id: string; run: string; knockout?: string }[] = [
  { id: "kalepa", run: "2026-10-20-app-080302", knockout: "Hires in Europe only, no visa sponsorship; the candidate is in India" },
  { id: "kraken", run: "2026-10-18-app-201200", knockout: "Australian work rights required; Engineer II asks for 4-8 years" },
  { id: "n26", run: "2026-10-17-app-201333", knockout: "A JVM language and Spring Boot in large-scale production are required" },
  { id: "livekit", run: "2026-10-17-app-201737" },
  { id: "spark", run: "2026-10-18-app-160524" },
  { id: "microsoft", run: "2026-10-18-app-152434" },
  { id: "cursor", run: "2026-10-20-app-053658" },
  { id: "docplanner", run: "2026-10-19-app-122557" },
  { id: "trigger", run: "2026-10-18-app-160852" },
  { id: "squadstack", run: "2026-10-19-app-142021" },
];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const store = openEvalStore(REAL_DB);

if (args.includes("--seed")) {
  for (const s of SEED) {
    const row = store.db.prepare("SELECT company, data FROM runs WHERE id = ?").get(s.run) as { company: string; data: string } | undefined;
    if (!row) throw new Error(`No run ${s.run}`);
    const run = JSON.parse(row.data);
    const resumeFile = String(run.originResume ?? run.resumeFile).replace(/^base:/, "");
    if (resumeFile.startsWith("improved:")) throw new Error(`${s.id}: starts from an improved resume, not a base one`);
    store.putCase({ id: s.id, label: `${row.company} · ${run.synthesis?.job.role ?? ""}`, sourceRun: s.run, resumeFile, jobText: run.jobText, knockout: s.knockout ?? "", createdAt: new Date().toISOString() });
    console.log(`${s.id.padEnd(11)} ${resumeFile.padEnd(34)} ${row.company}`);
  }
  process.exit(0);
}

const only = flag("only")?.split(",").filter(Boolean);
const cases = store.cases().filter((c) => !only || only.includes(c.id));
if (!cases.length) throw new Error("No cases. Run with --seed first.");

const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const version = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--untracked-files=no") ? "+dirty" : ""}`;
const suiteId = new Date().toISOString().replace(/[:.]/g, "-");
const sandbox = path.join(REAL_ROOT, ".hiring-panel", "evals", suiteId);
mkdirSync(sandbox, { recursive: true });
cpSync(path.join(REAL_ROOT, "resume"), path.join(sandbox, "resume"), { recursive: true });

// Every module below reads its paths from JOB_HUNT_ROOT when first imported.
process.env.JOB_HUNT_ROOT = sandbox;
const { runPanel } = await import("../src/lib/pipeline.ts");
const { parsedText } = await import("../src/lib/ats.ts");
const { runSpend } = await import("../src/lib/db.ts");
const { IMPROVED_DIR } = await import("../src/lib/paths.ts");
const { codeChecks, majority, screenVotes, summarize } = await import("../src/lib/eval-suite.ts");

store.startSuite(suiteId, version, flag("notes") ?? "", sandbox);
console.log(`Suite ${suiteId} on ${version}: ${cases.length} cases in ${sandbox}\n`);

async function runCase(c: EvalCase): Promise<CaseResult> {
  const empty = { checks: [], ats: { before: null, after: null }, votes: [], verdict: "", knockout: c.knockout, questions: 0 };
  let runId = "";
  try {
    let done = null;
    for await (const e of runPanel({ jobText: c.jobText, resumeFile: c.resumeFile })) {
      if (e.type === "started") runId = e.runId;
      if (e.type === "error") throw new Error(e.message);
      if (e.type === "done") done = e.run;
    }
    if (!done?.pdf) throw new Error("the run finished without a PDF");
    const parsed = await parsedText(path.join(IMPROVED_DIR, done.pdf.folder, done.pdf.file));
    const votes = await screenVotes(c.jobText, parsed, runId);
    return {
      caseId: c.id,
      runId,
      checks: codeChecks(done, parsed),
      ats: { before: done.ats?.before?.score ?? null, after: done.ats?.after?.score ?? null },
      votes,
      verdict: majority(votes),
      knockout: c.knockout,
      questions: done.synthesis?.questions.length ?? 0,
      cost: runSpend(runId),
    };
  } catch (err) {
    return { caseId: c.id, runId, error: err instanceof Error ? err.message : String(err), ...empty, cost: runId ? runSpend(runId) : 0 };
  }
}

// A run id is the start time to the second, so starts are spaced apart.
const concurrency = Math.max(1, Number(flag("concurrency")) || 3);
const results: CaseResult[] = [];
const queue = [...cases];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async (_, worker) => {
    await new Promise((r) => setTimeout(r, worker * 1500));
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await runCase(c);
      store.putResult(suiteId, c.id, r.runId, r);
      results.push(r);
      const fails = r.checks.filter((k) => !k.pass).map((k) => k.id);
      console.log(
        r.error
          ? `${c.id.padEnd(11)} ERROR ${r.error}`
          : `${c.id.padEnd(11)} ${r.verdict.padEnd(6)} votes ${r.votes.map((v) => v.verdict[0]).join("")}  ATS ${r.ats.before ?? "-"}→${r.ats.after ?? "-"}  $${r.cost.toFixed(3)}  ${fails.length ? `fails: ${fails.join(", ")}` : "all checks pass"}`,
      );
      // Wait out the second this run started in before the next starts.
      await new Promise((res) => setTimeout(res, 1100));
    }
  }),
);

const summary = summarize(results);
store.finishSuite(suiteId, summary);
const prev = store.previous(suiteId) as { id: string; version: string; summary: SuiteSummary; results: Record<string, CaseResult> } | null;

const line = (label: string, now: number | null, before?: number | null, lowerIsBetter = false) => {
  const delta = now !== null && before !== undefined && before !== null ? now - before : null;
  const mark = delta === null || delta === 0 ? "" : (delta < 0) === lowerIsBetter ? "  better" : "  worse";
  console.log(`  ${label.padEnd(30)} ${String(now ?? "-").padStart(6)}${before !== undefined ? `   was ${String(before ?? "-").padStart(5)}${delta ? ` (${delta > 0 ? "+" : ""}${Math.round(delta * 1000) / 1000})` : ""}${mark}` : ""}`);
};
console.log(`\nSummary${prev ? ` vs ${prev.id} (${prev.version})` : " (baseline)"}`);
const p = prev?.summary;
line("Screen PASS (majority of 3)", summary.pass, p?.pass);
line("REJECT, resume's fault", summary.faultRejects, p?.faultRejects, true);
line("REJECT, known knockout", summary.knockoutRejects, p?.knockoutRejects);
line("Mean ATS match after", summary.meanAts, p?.meanAts);
line("Grader errors (bad format)", summary.graderErrors, p?.graderErrors, true);
line("Run errors", summary.errors, p?.errors, true);
line("Cost, $", summary.cost, p?.cost, true);
for (const id of new Set([...Object.keys(summary.checkFails), ...Object.keys(p?.checkFails ?? {})])) line(`Check fails: ${id}`, summary.checkFails[id] ?? 0, p ? (p.checkFails[id] ?? 0) : undefined, true);
if (prev) {
  const flips = results.filter((r) => prev.results[r.caseId] && prev.results[r.caseId].verdict !== r.verdict);
  for (const r of flips) console.log(`  ${r.caseId}: ${prev.results[r.caseId].verdict} → ${r.verdict}`);
}
