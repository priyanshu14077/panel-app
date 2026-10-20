import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { jobFacets, type JobFacets } from "./jobs";
import { PANEL_DIR } from "./paths";
import type { Run } from "./pipeline";
import type { UsageRecord } from "./usage";

// One SQLite file holds every run, every conversation and the cost ledger.
// A run is stored whole as JSON; its messages are also written out as rows so
// they can be searched and filtered across runs.
export const DB_PATH = path.join(PANEL_DIR, "panel.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  thread TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_run ON messages(run_id, kind, thread, seq);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  run_id TEXT,
  action TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  web_searches INTEGER NOT NULL,
  cost REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_run ON usage(run_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(PANEL_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // Route handlers and streaming runs write from the same process; WAL lets
  // reads continue while a run saves.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  addFacetColumns(db);
  importLegacy(db);
  refreshFacets(db);
  return db;
}

function transaction<T>(d: DatabaseSync, body: () => T): T {
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = body();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

// ---------- runs ----------

export type MessageKind = "chat" | "project-interview" | "email" | "outreach";

interface MessageRow {
  kind: MessageKind;
  thread: string;
  seq: number;
  role: string;
  text: string;
  at: string;
}

// Every conversation and draft on a run, flattened for search. Turns saved
// before turns carried a time take the run's.
function messagesOf(run: Run): MessageRow[] {
  const rows: MessageRow[] = [];
  (run.chat ?? []).forEach((t, seq) => rows.push({ kind: "chat", thread: "Application Q&A", seq, role: t.role, text: t.text, at: t.at ?? run.createdAt }));
  for (const [project, chat] of Object.entries(run.projectChats ?? {}))
    chat.turns.forEach((t, seq) => rows.push({ kind: "project-interview", thread: project, seq, role: t.role, text: t.text, at: t.at ?? run.createdAt }));
  (run.emails ?? []).forEach((e, seq) => rows.push({ kind: "email", thread: e.kind, seq, role: "assistant", text: `${e.subject}\n\n${e.body}`, at: e.createdAt }));
  (run.outreach ?? []).forEach((s, i) =>
    s.steps.forEach((step, j) =>
      rows.push({ kind: "outreach", thread: s.target, seq: i * 100 + j, role: "assistant", text: [`Day ${step.day} · ${step.channel} · ${step.recipient}`, step.subject, step.body].filter(Boolean).join("\n"), at: s.createdAt }),
    ),
  );
  return rows;
}

function writeRun(d: DatabaseSync, run: Run): void {
  d.prepare(
    `INSERT INTO runs (id, created_at, company, role, stage, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET company = excluded.company, role = excluded.role, stage = excluded.stage, data = excluded.data`,
  ).run(run.id, run.createdAt, run.synthesis?.job.company ?? "", run.synthesis?.job.role ?? "", run.board?.stage ?? "", JSON.stringify(run));
  writeFacets(d, run.id, jobFacets(run));
  d.prepare("DELETE FROM messages WHERE run_id = ?").run(run.id);
  const insert = d.prepare("INSERT INTO messages (run_id, kind, thread, seq, role, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const m of messagesOf(run)) insert.run(run.id, m.kind, m.thread, m.seq, m.role, m.text, m.at);
}

export function putRun(run: Run): void {
  const d = getDb();
  transaction(d, () => writeRun(d, run));
}

export function getRun(id: string): Run | null {
  const row = getDb().prepare("SELECT data FROM runs WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

export function allRuns(): Run[] {
  return (getDb().prepare("SELECT data FROM runs ORDER BY created_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

// ---------- job filters ----------

// The board's filters are columns on runs, written with every save. Bump the
// version when the rules in jobs.ts change, and every run is re-read once.
const FACETS_VERSION = "1";
const FACET_COLUMNS: [string, string][] = [
  ["families", "TEXT NOT NULL DEFAULT ''"], // ",Backend,AI / ML," so one LIKE matches a family
  ["level", "TEXT NOT NULL DEFAULT ''"],
  ["mode", "TEXT NOT NULL DEFAULT ''"],
  ["region", "TEXT NOT NULL DEFAULT ''"],
  ["verdict", "TEXT NOT NULL DEFAULT ''"],
  ["ats", "INTEGER"],
  ["fit_risk", "INTEGER NOT NULL DEFAULT 0"],
  ["group_key", "TEXT NOT NULL DEFAULT ''"],
];

function addFacetColumns(d: DatabaseSync): void {
  const have = new Set((d.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of FACET_COLUMNS) if (!have.has(name)) d.exec(`ALTER TABLE runs ADD COLUMN ${name} ${type}`);
  d.exec("CREATE INDEX IF NOT EXISTS runs_group ON runs(group_key, created_at)");
}

function writeFacets(d: DatabaseSync, id: string, f: JobFacets): void {
  d.prepare("UPDATE runs SET families = ?, level = ?, mode = ?, region = ?, verdict = ?, ats = ?, fit_risk = ?, group_key = ? WHERE id = ?").run(
    `,${f.families.join(",")},`,
    f.level,
    f.mode,
    f.region,
    f.verdict,
    f.ats,
    f.fitRisk ? 1 : 0,
    f.groupKey,
    id,
  );
}

function refreshFacets(d: DatabaseSync): void {
  const row = d.prepare("SELECT value FROM meta WHERE key = 'job-facets'").get() as { value: string } | undefined;
  if (row?.value === FACETS_VERSION) return;
  transaction(d, () => {
    for (const r of d.prepare("SELECT id, data FROM runs").all() as { id: string; data: string }[]) writeFacets(d, r.id, jobFacets(JSON.parse(r.data)));
    d.prepare("INSERT INTO meta (key, value) VALUES ('job-facets', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(FACETS_VERSION);
  });
}

export interface JobFilter {
  q?: string; // company or role
  family?: string;
  level?: string;
  mode?: string;
  region?: string;
  verdict?: string;
  stage?: string;
  fit?: boolean; // only jobs with no fit risk
  minAts?: number;
  repeats?: boolean; // keep every run of a posting, not just the latest
}

export interface JobRow {
  id: string;
  groupKey: string;
  repeats: number; // other runs of the same posting
}

// Runs with a panel result that match every filter, newest first. Repeats of
// one posting collapse to the latest run unless asked for.
export function filterJobs(f: JobFilter): JobRow[] {
  const where = ["json_extract(data, '$.synthesis') IS NOT NULL"];
  const args: (string | number)[] = [];
  const add = (sql: string, ...values: (string | number)[]) => {
    where.push(sql);
    args.push(...values);
  };
  if (f.q?.trim()) add("(company LIKE ? OR role LIKE ?)", `%${f.q.trim()}%`, `%${f.q.trim()}%`);
  if (f.family) add("families LIKE ?", `%,${f.family},%`);
  if (f.level) add("level = ?", f.level);
  if (f.mode) add("mode = ?", f.mode);
  if (f.region) add("region = ?", f.region);
  if (f.verdict) add("verdict = ?", f.verdict);
  if (f.stage) add("stage = ?", f.stage);
  if (f.fit) where.push("fit_risk = 0");
  if (f.minAts) add("ats >= ?", f.minAts);
  const rows = getDb()
    .prepare(
      `SELECT id, group_key,
         COUNT(*) OVER (PARTITION BY group_key) - 1 AS repeats,
         ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY created_at DESC) AS nth
       FROM runs WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
    )
    .all(...args) as { id: string; group_key: string; repeats: number; nth: number }[];
  return rows.filter((r) => f.repeats || r.nth === 1).map((r) => ({ id: r.id, groupKey: r.group_key, repeats: r.repeats }));
}

// How many postings (not runs) carry each value, for the filter labels.
export function jobFacetCounts(): Record<"family" | "level" | "mode" | "region" | "verdict", Record<string, number>> {
  const rows = getDb()
    .prepare(
      `SELECT families, level, mode, region, verdict FROM runs
       WHERE json_extract(data, '$.synthesis') IS NOT NULL
       GROUP BY group_key HAVING created_at = MAX(created_at)`,
    )
    .all() as Record<string, string>[];
  const out = { family: {}, level: {}, mode: {}, region: {}, verdict: {} } as Record<"family" | "level" | "mode" | "region" | "verdict", Record<string, number>>;
  const bump = (k: keyof typeof out, v: string) => {
    if (v) out[k][v] = (out[k][v] ?? 0) + 1;
  };
  for (const r of rows) {
    for (const fam of r.families.split(",").filter(Boolean)) bump("family", fam);
    bump("level", r.level);
    bump("mode", r.mode);
    bump("region", r.region);
    bump("verdict", r.verdict);
  }
  return out;
}

// ---------- usage ----------

export function putUsage(r: UsageRecord): void {
  getDb()
    .prepare(
      "INSERT INTO usage (at, run_id, action, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(r.at, r.runId ?? null, r.action, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.webSearches, r.cost);
}

export function allUsage(): UsageRecord[] {
  const rows = getDb().prepare("SELECT * FROM usage ORDER BY at").all() as Record<string, string | number | null>[];
  return rows.map((r) => ({
    at: r.at as string,
    runId: (r.run_id as string | null) ?? undefined,
    action: r.action as string,
    model: r.model as string,
    inputTokens: r.input_tokens as number,
    outputTokens: r.output_tokens as number,
    cacheReadTokens: r.cache_read_tokens as number,
    cacheWriteTokens: r.cache_write_tokens as number,
    webSearches: r.web_searches as number,
    cost: r.cost as number,
  }));
}

export function runSpend(runId: string): number {
  const row = getDb().prepare("SELECT COALESCE(SUM(cost), 0) AS spent FROM usage WHERE run_id = ?").get(runId) as { spent: number };
  return row.spent;
}

// ---------- search ----------

export interface MessageFilter {
  q?: string;
  kind?: MessageKind;
  company?: string;
  stage?: string;
  role?: "user" | "assistant";
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
  limit?: number;
}

export interface MessageHit {
  id: number;
  runId: string;
  company: string;
  jobRole: string;
  stage: string;
  kind: MessageKind;
  thread: string;
  role: string;
  text: string;
  snippet: string;
  at: string;
}

// Free text becomes a prefix match on each word, so "celer retr" finds
// "Celery retries" and stray quotes or operators never break the query.
const ftsQuery = (q: string) =>
  q
    .split(/\s+/)
    .map((w) => w.replace(/["*^():]/g, ""))
    .filter(Boolean)
    .map((w) => `"${w}"*`)
    .join(" ");

export function searchMessages(f: MessageFilter): MessageHit[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const match = f.q?.trim() ? ftsQuery(f.q) : "";
  if (match) {
    where.push("m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)");
    args.push(match);
  }
  if (f.kind) {
    where.push("m.kind = ?");
    args.push(f.kind);
  }
  if (f.role) {
    where.push("m.role = ?");
    args.push(f.role);
  }
  if (f.company) {
    where.push("r.company = ?");
    args.push(f.company);
  }
  if (f.stage) {
    where.push("r.stage = ?");
    args.push(f.stage);
  }
  if (f.from) {
    where.push("m.at >= ?");
    args.push(f.from);
  }
  if (f.to) {
    where.push("m.at < date(?, '+1 day')");
    args.push(f.to);
  }
  args.push(Math.min(f.limit ?? 200, 500));
  const rows = getDb()
    .prepare(
      `SELECT m.id, m.run_id, r.company, r.role AS job_role, r.stage, m.kind, m.thread, m.role, m.text, m.at
       FROM messages m JOIN runs r ON r.id = m.run_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY m.at DESC, m.seq DESC LIMIT ?`,
    )
    .all(...args) as Record<string, string | number>[];
  return rows.map((r) => ({
    id: r.id as number,
    runId: r.run_id as string,
    company: r.company as string,
    jobRole: r.job_role as string,
    stage: r.stage as string,
    kind: r.kind as MessageKind,
    thread: r.thread as string,
    role: r.role as string,
    text: r.text as string,
    snippet: snippet(r.text as string, f.q),
    at: r.at as string,
  }));
}

// About 220 characters around the first matched word.
function snippet(text: string, q?: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const word = q?.trim().split(/\s+/)[0]?.toLowerCase();
  const at = word ? flat.toLowerCase().indexOf(word) : -1;
  const start = Math.max(0, at - 80);
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 220)}${start + 220 < flat.length ? "…" : ""}`;
}

export function facets(): { companies: string[]; stages: string[]; counts: Record<string, number> } {
  const d = getDb();
  const companies = (d.prepare("SELECT DISTINCT company FROM runs WHERE company != '' ORDER BY company").all() as { company: string }[]).map((r) => r.company);
  const stages = (d.prepare("SELECT DISTINCT stage FROM runs WHERE stage != ''").all() as { stage: string }[]).map((r) => r.stage);
  const counts = Object.fromEntries((d.prepare("SELECT kind, COUNT(*) AS n FROM messages GROUP BY kind").all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n]));
  return { companies, stages, counts };
}

// ---------- one-time import ----------

// Runs used to live in .hiring-panel/<id>/run.json and spend in usage.jsonl.
// They are copied in once; the files stay on disk as a backup.
function importLegacy(d: DatabaseSync): void {
  if (d.prepare("SELECT 1 FROM meta WHERE key = 'imported-files'").get()) return;
  transaction(d, () => {
    let names: string[] = [];
    try {
      names = readdirSync(PANEL_DIR);
    } catch {}
    for (const name of names) {
      try {
        writeRun(d, JSON.parse(readFileSync(path.join(PANEL_DIR, name, "run.json"), "utf8")));
      } catch {} // folders written by the skill have no run.json
    }
    try {
      for (const line of readFileSync(path.join(PANEL_DIR, "usage.jsonl"), "utf8").split("\n").filter(Boolean)) {
        const r = JSON.parse(line) as UsageRecord;
        d.prepare(
          "INSERT INTO usage (at, run_id, action, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, web_searches, cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(r.at, r.runId ?? null, r.action, r.model, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.webSearches, r.cost);
      }
    } catch {} // no ledger yet
    d.prepare("INSERT INTO meta (key, value) VALUES ('imported-files', ?)").run(new Date().toISOString());
  });
}
