import { askText } from "./claude";
import { isGeneric, lint } from "./guardrails";
import { displayUrl } from "./latex";
import type { Run } from "./pipeline";
import { REVIEWER_SYSTEM, SCREEN_BRIEF, reviewerPrompt, verdictOf } from "./reviewers";

// What one case of the suite measures on a finished run. Code checks come
// first and cost nothing; the screen is a model, so it votes three times.

export interface Check {
  id: string;
  pass: boolean;
  detail: string;
}

export interface ScreenVote {
  verdict: string;
  reasons: string[];
  wellFormed: boolean; // a REJECT that lists no reasons is a grader error
}

export interface CaseResult {
  caseId: string;
  runId: string;
  error?: string;
  checks: Check[];
  ats: { before: number | null; after: number | null };
  votes: ScreenVote[];
  verdict: string; // the majority of the votes
  knockout: string;
  questions: number;
  cost: number;
}

export const SCREEN_VOTES = 3;

// The checks that need no model: the parsed PDF and the saved resume.
export function codeChecks(run: Run, parsed: string): Check[] {
  const doc = run.synthesis?.resume;
  const pdf = run.pdf?.check;
  if (!doc || !pdf) return [{ id: "built", pass: false, detail: "no resume or PDF" }];
  const flat = parsed.replace(/\s+/g, " ");
  const urls = [...doc.experience.map((x) => x.url), ...doc.projects.map((p) => p.url)].filter(Boolean);
  // A link the parser reads only the start of ran off the page.
  const cut = urls.map(displayUrl).filter((u) => !flat.includes(u) && flat.includes(u.slice(0, Math.min(20, u.length - 3))));
  const generic = doc.skills.flatMap((r) => r.items).filter(isGeneric);
  const style = lint(doc, "Resume");
  const tense = style.filter((i) => i.problems.some((p) => p.includes("tense")));
  const after = run.ats?.after;
  const required = after?.terms.filter((t) => t.required && t.kind !== "soft-skill") ?? [];
  const hidden = required.filter((t) => t.placement === "material");
  const format = after?.checks.filter((c) => !c.pass) ?? [];
  return [
    { id: "one-page", pass: pdf.pages === 1, detail: `${pdf.pages} page(s)` },
    { id: "placeholders", pass: pdf.placeholders.length === 0, detail: pdf.placeholders.join(", ") || "none" },
    { id: "generic-skills", pass: generic.length === 0, detail: generic.join(", ") || "none" },
    { id: "cut-links", pass: cut.length === 0, detail: cut.join(", ") || "none" },
    { id: "tense", pass: tense.length === 0, detail: tense.map((i) => i.text).join(" | ") || "none" },
    { id: "style", pass: style.length === 0, detail: style.length ? `${style.length} line(s): ${[...new Set(style.flatMap((i) => i.problems))].join("; ")}` : "clean" },
    { id: "ats-score", pass: (after?.score ?? 0) >= 75, detail: after ? `${after.score}%` : "not scored" },
    { id: "ats-format", pass: Boolean(after) && format.length === 0, detail: format.map((c) => c.name).join(", ") || (after ? "all pass" : "not scored") },
    { id: "required-shown", pass: hidden.length === 0, detail: hidden.length ? `backed but missing: ${hidden.map((t) => t.term).join(", ")}` : `${required.length} required` },
  ];
}

function reasonsOf(text: string): string[] {
  const block = text.split(/REASONS[^\n]*:/i)[1]?.split(/KEYWORDS PRESENT/i)[0] ?? "";
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]/.test(l));
}

// The automated screen on the text a tracker parses out of the PDF.
export async function screenVotes(job: string, parsed: string, runId: string, n = SCREEN_VOTES): Promise<ScreenVote[]> {
  const prompt = reviewerPrompt(SCREEN_BRIEF, job, parsed);
  const texts = await Promise.all(Array.from({ length: n }, () => askText({ system: REVIEWER_SYSTEM, prompt, effort: "medium", tier: "fast", tag: { runId, action: "eval:screen" } })));
  return texts.map((t) => {
    const verdict = verdictOf(t);
    const reasons = reasonsOf(t);
    return { verdict, reasons, wellFormed: verdict === "PASS" || verdict === "REJECT" ? verdict === "PASS" || reasons.length > 0 : false };
  });
}

export function majority(votes: ScreenVote[]): string {
  const pass = votes.filter((v) => v.verdict === "PASS").length;
  return pass * 2 > votes.length ? "PASS" : "REJECT";
}

export interface SuiteSummary {
  cases: number;
  errors: number;
  pass: number; // majority PASS
  faultRejects: number; // majority REJECT on a case with no known knockout
  knockoutRejects: number;
  checkFails: Record<string, number>;
  meanAts: number | null;
  graderErrors: number;
  cost: number;
}

export function summarize(results: CaseResult[]): SuiteSummary {
  const ok = results.filter((r) => !r.error);
  const scored = ok.map((r) => r.ats.after).filter((s): s is number => s !== null);
  const checkFails: Record<string, number> = {};
  for (const r of ok) for (const c of r.checks) if (!c.pass) checkFails[c.id] = (checkFails[c.id] ?? 0) + 1;
  return {
    cases: results.length,
    errors: results.length - ok.length,
    pass: ok.filter((r) => r.verdict === "PASS").length,
    faultRejects: ok.filter((r) => r.verdict === "REJECT" && !r.knockout).length,
    knockoutRejects: ok.filter((r) => r.verdict === "REJECT" && r.knockout).length,
    checkFails,
    meanAts: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    graderErrors: ok.reduce((n, r) => n + r.votes.filter((v) => !v.wellFormed).length, 0),
    cost: Math.round(results.reduce((a, r) => a + r.cost, 0) * 1000) / 1000,
  };
}
