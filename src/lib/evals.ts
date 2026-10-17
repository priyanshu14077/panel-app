import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { askStructured } from "./claude";
import { knowledgeDigest, loadKnowledge } from "./knowledge/cards";
import { readProfile, resumeText } from "./files";
import { KNOWLEDGE_DIR, PANEL_DIR, safeSegment } from "./paths";
import type { Run } from "./pipeline";
import { LIMITS, NEEDS, type ResumeDoc } from "./schemas";

export type Status = "pass" | "warn" | "fail" | "skip";

export interface EvalResult {
  id: string;
  name: string;
  category: "resume" | "grounding" | "panel" | "writing";
  status: Status;
  detail: string;
}

export interface JudgeResult {
  at: string;
  claims: { line: string; verdict: "supported" | "partly" | "unsupported"; evidence: string }[];
}

// Phrases that mark generic, padded writing. Checked in emails, outreach and chat answers.
export const BANNED = [
  "passionate",
  "thrilled",
  "excited to",
  "leverage",
  "delve",
  "synergy",
  "hope this email finds you",
  "hope this finds you",
  "just bumping",
  "i am writing to",
  "dynamic team",
  "fast-paced environment",
  "results-driven",
  "game-changer",
];

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[,\s]+/g, " ");

// Every line that reaches the PDF (lines waiting on a question do not).
function resumeLines(doc: ResumeDoc): string[] {
  const keep = (l: string) => !NEEDS.test(l);
  return [
    ...doc.summary,
    ...doc.experience.flatMap((x) => x.bullets),
    ...doc.projects.flatMap((p) => p.bullets),
  ].filter(keep);
}

// Everything the resume is allowed to draw on.
async function sourcesFor(run: Run): Promise<string> {
  const [original, profile, knowledge] = await Promise.all([
    resumeText(run.resumeFile).catch(() => ""),
    readProfile(),
    fs.readFile(path.join(KNOWLEDGE_DIR, "knowledge.md"), "utf8").catch(() => ""),
  ]);
  return norm(`${original}\n${profile}\n${knowledge}`);
}

// Numbers with their unit, e.g. "40%", "200 ms", "1,000+", "17,000x".
function numbersIn(line: string): string[] {
  const noUrls = line.replace(/https?:\/\/\S+|[\w.-]+\.(com|io|in|co|dev)\/\S*/g, "");
  return [...noUrls.matchAll(/(?<![\w.])\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => m[0].replace(/,/g, ""))
    .filter((n) => !/^(19|20)\d\d$/.test(n)); // years are checked by the dates themselves
}

function keywordsMissing(screenText: string | undefined): string[] | null {
  const m = screenText?.match(/KEYWORDS MISSING:\s*([^\n]*)/i);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
}

function result(id: string, name: string, category: EvalResult["category"], status: Status, detail: string): EvalResult {
  return { id, name, category, status, detail };
}

export async function evaluateRun(run: Run): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  const s = run.synthesis;

  // Panel
  const errors = run.reviews.filter((r) => r.verdict === "ERROR").length;
  out.push(result("reviewers", "All seven reviewers answered", "panel", run.reviews.length === 7 && !errors ? "pass" : "fail", `${run.reviews.length - errors}/7 answered`));
  if (!s) {
    out.push(result("rebuilt", "Resume rebuilt", "resume", "fail", run.error ?? "no rebuild"));
    return out;
  }
  const before = run.reviews.find((r) => r.id === "screen");
  const after = run.rescreens.at(-1);
  if (before && after) {
    const order = ["REJECT", "PASS"];
    const delta = order.indexOf(after.verdict) - order.indexOf(before.verdict);
    out.push(result("screen", "Automated screen did not get worse", "panel", delta < 0 ? "fail" : "pass", `${before.verdict} → ${after.verdict}`));
    const b = keywordsMissing(before.text);
    const a = keywordsMissing(after.text);
    if (b && a) {
      // The two lists come from separate screen calls and vary between them,
      // so a higher count alone is a warning; it fails only with a worse verdict.
      const status = a.length < b.length ? "pass" : a.length > b.length && delta < 0 ? "fail" : "warn";
      out.push(result("keywords", "Fewer posting keywords missing after the rebuild", "panel", status, `${b.length} missing → ${a.length} missing`));
    }
  }

  // Resume
  if (run.pdf) {
    const c = run.pdf.check;
    out.push(result("one-page", "PDF is one page", "resume", c.pages === 1 ? "pass" : "fail", `${c.pages} page(s)`));
    out.push(result("placeholders", "No placeholders in the PDF", "resume", c.placeholders.length ? "fail" : "pass", c.placeholders.join(", ") || "none"));
    const bad = c.links.filter((l) => /REPLACE|example\.com|\/x\/y|handle/.test(l));
    out.push(result("links-real", "No placeholder links", "resume", bad.length ? "fail" : "pass", bad.join(", ") || `${c.links.length} links`));
  } else {
    out.push(result("one-page", "PDF is one page", "resume", "fail", "no PDF"));
  }
  const open = s.questions.length;
  out.push(result("open-questions", "Open questions left", "resume", open === 0 ? "pass" : "warn", `${open} unanswered; their lines are left out of the PDF`));

  // Grounding: everything on the resume must trace back to a source.
  const sources = await sourcesFor(run);
  const lines = resumeLines(s.resume);
  const ungroundedNumbers = [...new Set(lines.flatMap(numbersIn).filter((n) => !sources.includes(n)))];
  out.push(
    result("numbers", "Every number traces to a source", "grounding", ungroundedNumbers.length ? "fail" : "pass", ungroundedNumbers.length ? `not found in resume, profile or knowledge base: ${ungroundedNumbers.join(", ")}` : `${lines.flatMap(numbersIn).length} numbers checked`),
  );
  const skills = s.resume.skills.flatMap((k) => k.items).filter((i) => !NEEDS.test(i));
  const ungroundedSkills = skills.filter((item) => {
    const core = norm(item.replace(/\(.*?\)/g, "")).trim();
    return core && !sources.includes(core) && !core.split(" ").every((w) => w.length < 3 || sources.includes(w));
  });
  out.push(
    result("skills", "Every skill traces to a source", "grounding", ungroundedSkills.length > 2 ? "fail" : ungroundedSkills.length ? "warn" : "pass", ungroundedSkills.length ? `not found: ${ungroundedSkills.join(", ")}` : `${skills.length} skills checked`),
  );
  const urls = [...s.resume.experience.map((x) => x.url), ...s.resume.projects.map((p) => p.url)].filter(Boolean);
  const unknownUrls = urls.filter((u) => !sources.includes(norm(u).replace(/\/$/, "").replace(/^https?:\/\/(www\.)?/, "")));
  out.push(result("urls", "Every link comes from your profile or repos", "grounding", unknownUrls.length ? "fail" : "pass", unknownUrls.join(", ") || `${urls.length} links checked`));

  if (run.judge) {
    // Older judge results named lines by number; map them back to the text.
    const claims = run.judge.claims.map((c) => (/^\d+\.?$/.test(c.line.trim()) ? { ...c, line: lines[Number.parseInt(c.line) - 1] ?? c.line } : c));
    const unsupported = claims.filter((c) => c.verdict === "unsupported");
    const partly = claims.filter((c) => c.verdict === "partly");
    out.push(
      result(
        "judge",
        "Grounding judge: every line is supported",
        "grounding",
        unsupported.length ? "fail" : partly.length ? "warn" : "pass",
        unsupported.length || partly.length
          ? [...unsupported.map((c) => `UNSUPPORTED: ${c.line}\n  → ${c.evidence}`), ...partly.map((c) => `PARTLY: ${c.line}\n  → ${c.evidence}`)].join("\n")
          : `${claims.length} lines supported`,
      ),
    );
  } else {
    out.push(result("judge", "Grounding judge: every line is supported", "grounding", "skip", "Not run. Run it from the Evals page (one Claude call)."));
  }

  // Writing
  const banned = (text: string) => BANNED.filter((p) => text.toLowerCase().includes(p));
  // Only the latest draft of each kind counts; earlier drafts were replaced.
  const latest = <T extends { createdAt: string }>(items: T[], key: (i: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];
  for (const e of latest(run.emails ?? [], (x) => x.kind)) {
    const hits = banned(e.body);
    const n = words(e.body);
    out.push(result(`email-${e.createdAt}`, `Email (${e.kind}): under 170 words, no clichés`, "writing", n > 170 || hits.length ? "fail" : "pass", `${n} words${hits.length ? `; clichés: ${hits.join(", ")}` : ""}`));
  }
  for (const seq of latest(run.outreach ?? [], (x) => x.target)) {
    const problems: string[] = [];
    for (const step of seq.steps) {
      if (step.channel === "linkedin-connect" && step.body.length > LIMITS["linkedin-connect"]) problems.push(`day ${step.day} connect note is ${step.body.length} chars`);
      if (step.channel === "linkedin-message" && step.body.length > LIMITS["linkedin-message"]) problems.push(`day ${step.day} message is ${step.body.length} chars`);
      if (step.channel === "email" && words(step.body) > LIMITS.emailWords + 15) problems.push(`day ${step.day} email is ${words(step.body)} words`);
      const hits = banned(step.body);
      if (hits.length) problems.push(`day ${step.day}: ${hits.join(", ")}`);
    }
    out.push(result(`outreach-${seq.createdAt}`, `Outreach (${seq.target}): within LinkedIn limits, no clichés`, "writing", problems.length ? "fail" : "pass", problems.join("; ") || `${seq.steps.length} steps`));
  }
  const chat = run.chat ?? [];
  for (let i = 1; i < chat.length; i += 2) {
    const question = chat[i - 1].text;
    const answer = chat[i].text.split(/\n---\n/)[0];
    const limit = Number(question.match(/(\d+)\s*words/i)?.[1] ?? 0);
    const n = words(answer.replace(/\*\(\d+ words\)\*/g, ""));
    const hits = banned(answer);
    const over = limit > 0 && n > limit;
    out.push(result(`chat-${i}`, `Answer: "${question.slice(0, 60)}${question.length > 60 ? "…" : ""}"`, "writing", over || hits.length ? "fail" : "pass", `${n} words${limit ? ` (limit ${limit})` : ""}${hits.length ? `; clichés: ${hits.join(", ")}` : ""}`));
  }
  return out;
}

const Judge = z.object({
  claims: z.array(
    z.object({
      line: z.string().describe("The full text of the resume line, copied exactly (not its number)."),
      verdict: z.enum(["supported", "partly", "unsupported"]),
      evidence: z.string().describe("The source text that supports it, or what is missing."),
    }),
  ),
});

const JUDGE_SYSTEM = `You are a strict fact-checker for a resume. For every resume line given, decide whether the source material supports it: "supported" when every fact in it (employer, tool, number, result, scope) appears in the sources; "partly" when the gist is there but a detail is stretched or added; "unsupported" when a fact has no source. Quote the evidence briefly. Judge facts only, not style.`;

export async function runJudge(run: Run): Promise<JudgeResult> {
  if (!run.synthesis) throw new Error("This run has no rebuilt resume.");
  // The same shortlisted knowledge the rebuild saw: anything the resume
  // claims must be in it, and it is a quarter the size of the full base.
  const [original, profile, knowledge] = await Promise.all([
    resumeText(run.resumeFile).catch(() => ""),
    readProfile(),
    loadKnowledge().then((k) => knowledgeDigest(k, run.shortlist)),
  ]);
  const lines = resumeLines(run.synthesis.resume);
  const { claims } = await askStructured({
    system: JUDGE_SYSTEM,
    prompt: `<sources>\n<original_resume>\n${original}\n</original_resume>\n<profile>\n${profile}\n</profile>\n<knowledge_base>\n${knowledge}\n</knowledge_base>\n</sources>\n\n<resume_lines>\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n</resume_lines>`,
    schema: Judge,
    effort: "medium",
    tier: "writer", tag: { runId: run.id, action: "eval:judge" },
  });
  const judge: JudgeResult = { at: new Date().toISOString(), claims };
  const file = path.join(PANEL_DIR, safeSegment(run.id), "run.json");
  const saved = JSON.parse(await fs.readFile(file, "utf8")) as Run;
  saved.judge = judge;
  await fs.writeFile(file, JSON.stringify(saved, null, 2));
  return judge;
}
