import { DatabaseSync } from "node:sqlite";

// The eval suite's own tables, kept in panel.db beside the runs they were
// drawn from. Opened by path, because the suite runs its cases in a sandbox
// whose paths point elsewhere.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_run TEXT NOT NULL,
  resume_file TEXT NOT NULL,
  job_text TEXT NOT NULL,
  knockout TEXT NOT NULL DEFAULT '', -- why no resume can pass this posting, when that is known
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  version TEXT NOT NULL, -- git commit, with "+dirty" for uncommitted changes
  notes TEXT NOT NULL DEFAULT '',
  sandbox TEXT NOT NULL,
  summary TEXT -- JSON, written when the suite finishes
);
CREATE TABLE IF NOT EXISTS eval_results (
  suite_id TEXT NOT NULL REFERENCES eval_suites(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES eval_cases(id),
  run_id TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL, -- JSON CaseResult
  PRIMARY KEY (suite_id, case_id)
);
`;

export interface EvalCase {
  id: string;
  label: string;
  sourceRun: string;
  resumeFile: string;
  jobText: string;
  knockout: string;
  createdAt: string;
}

export function openEvalStore(dbPath: string) {
  const d = new DatabaseSync(dbPath);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  d.exec(SCHEMA);
  return {
    db: d,
    cases(): EvalCase[] {
      return (d.prepare("SELECT * FROM eval_cases ORDER BY id").all() as Record<string, string>[]).map((r) => ({
        id: r.id,
        label: r.label,
        sourceRun: r.source_run,
        resumeFile: r.resume_file,
        jobText: r.job_text,
        knockout: r.knockout,
        createdAt: r.created_at,
      }));
    },
    putCase(c: EvalCase): void {
      d.prepare(
        `INSERT INTO eval_cases (id, label, source_run, resume_file, job_text, knockout, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, knockout = excluded.knockout`,
      ).run(c.id, c.label, c.sourceRun, c.resumeFile, c.jobText, c.knockout, c.createdAt);
    },
    startSuite(id: string, version: string, notes: string, sandbox: string): void {
      d.prepare("INSERT INTO eval_suites (id, started_at, version, notes, sandbox) VALUES (?, ?, ?, ?, ?)").run(id, new Date().toISOString(), version, notes, sandbox);
    },
    putResult(suiteId: string, caseId: string, runId: string, result: unknown): void {
      d.prepare("INSERT OR REPLACE INTO eval_results (suite_id, case_id, run_id, result) VALUES (?, ?, ?, ?)").run(suiteId, caseId, runId, JSON.stringify(result));
    },
    finishSuite(id: string, summary: unknown): void {
      d.prepare("UPDATE eval_suites SET summary = ? WHERE id = ?").run(JSON.stringify(summary), id);
    },
    // The latest finished suite before this one that ran the same cases.
    previous(beforeId: string): { id: string; version: string; summary: unknown; results: Record<string, unknown> } | null {
      const mine = (d.prepare("SELECT case_id FROM eval_results WHERE suite_id = ? ORDER BY case_id").all(beforeId) as { case_id: string }[]).map((r) => r.case_id).join(",");
      const suites = d.prepare("SELECT id, version, summary FROM eval_suites WHERE summary IS NOT NULL AND id < ? ORDER BY id DESC").all(beforeId) as { id: string; version: string; summary: string }[];
      for (const s of suites) {
        const rows = d.prepare("SELECT case_id, result FROM eval_results WHERE suite_id = ? ORDER BY case_id").all(s.id) as { case_id: string; result: string }[];
        if (rows.map((r) => r.case_id).join(",") !== mine) continue;
        return { id: s.id, version: s.version, summary: JSON.parse(s.summary), results: Object.fromEntries(rows.map((r) => [r.case_id, JSON.parse(r.result)])) };
      }
      return null;
    },
  };
}
