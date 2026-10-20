import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { askStructured } from "./claude";
import { isGeneric, skillCap } from "./guardrails";
import { z } from "zod";
import { AtsTerms, type AtsTerm, type ResumeDoc } from "./schemas";

const run = promisify(execFile);

// An applicant tracking system parses the PDF to plain text, then matches the
// posting's terms against it. This does the same, deterministically, so the
// score does not drift between calls the way a model's keyword list does.

const TERMS_SYSTEM = `You list the terms an applicant tracking system would match a resume against for this job posting: languages, frameworks, tools, platforms, engineering practices, domain terms, certifications, the degree, and soft skills the posting names. Spell each exactly as the posting does. Skip generic words ("software", "team", "code", "experience"), category words that name no specific skill ("programming language", "frameworks", "cloud platform", "databases"), and anything the posting does not say. At most 30 terms, requirements first.`;

export async function extractTerms(jobText: string, runId: string): Promise<AtsTerms> {
  const out = await askStructured({ tier: "fast", system: TERMS_SYSTEM, prompt: `<job_posting>\n${jobText}\n</job_posting>`, schema: AtsTerms, effort: "low", tag: { runId, action: "ats-terms" } });
  return { ...out, terms: out.terms.filter((t) => !isGeneric(t.term)) };
}

// The plain text a parser gets out of a PDF: reading order, no layout.
export async function parsedText(pdfPath: string): Promise<string> {
  return (await run("pdftotext", [pdfPath, "-"])).stdout;
}

// ---------- matching ----------

// Tool names that are also everyday words match only with their own casing,
// so "Go" counts and "go to market" does not.
const EVERYDAY = new Set(["go", "rest", "swift", "spark", "express", "dart", "chef", "puppet", "ant", "make", "next", "flow", "gin", "echo", "salt", "keras", "ember"]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(term: string): RegExp {
  const t = term.trim();
  // "real-time" matches "real time"; "microservice" matches "microservices".
  const body = t.split(/[\s-]+/).map(escape).join("[\\s-]+");
  const plural = /[a-z]$/i.test(t) && t.length > 3 ? "(?:s|es)?" : "";
  const sensitive = t.length <= 2 || EVERYDAY.has(t.toLowerCase());
  return new RegExp(`(?<![A-Za-z0-9])${body}${plural}(?![A-Za-z0-9+#])`, sensitive ? "g" : "gi");
}

const spellings = (t: AtsTerm) => [t.term, ...t.aliases].filter((s) => s.trim());

// Distinct places any spelling matches: "LLM-based applications" and its
// alias "LLM" in the same spot count once.
export function count(text: string, t: AtsTerm): number {
  const starts = new Set<number>();
  for (const s of spellings(t)) for (const m of text.matchAll(pattern(s))) starts.add(m.index);
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.filter((at, i) => i === 0 || at - sorted[i - 1] > 3).length;
}

const found = (text: string, t: AtsTerm) => count(text, t) > 0;

// Links say nothing about skills: "github.com/…" is not GitHub Actions.
const withoutUrls = (s: string) => s.replace(/\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.[a-z]{2,6}\/\S*/gi, " ");

// ---------- sections ----------

const HEADING = /^\s*(summary|profile|objective|(?:professional |work )?experience|employment(?: history)?|projects?|(?:technical )?skills|core (?:skills|competencies)|education|certifications?)\s*:?\s*$/i;
const SKILLS = /skills|competencies/i;

interface Sections {
  header: string; // name, title and contact, before the first heading
  body: string; // summary, experience, projects, education
  skills: string;
  headings: string[];
}

function sectionsOf(text: string): Sections {
  const out: Sections = { header: "", body: "", skills: "", headings: [] };
  let into: "header" | "body" | "skills" = "header";
  for (const line of text.split("\n")) {
    // The plain-text render marks headings "## Experience"; a PDF has none.
    const h = line.replace(/^#+\s*/, "").match(HEADING);
    if (h) {
      out.headings.push(h[1].toLowerCase());
      into = SKILLS.test(h[1]) ? "skills" : "body";
      continue;
    }
    out[into] += `${line}\n`;
  }
  return out;
}

// ---------- evidence ----------

// Facts the candidate has given. Unanswered prompts in the profile ("Java:
// (where used, or none)") are not evidence, and "Java: none" is evidence of
// the opposite.
export function materialOf(sources: { profile: string; resume: string; knowledge: string }): { text: string; declined: string } {
  const kept: string[] = [];
  const declined: string[] = [];
  for (const line of sources.profile.split("\n")) {
    const answer = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    if (answer && /^(none|no|n\/a)\b/i.test(answer[2].trim())) declined.push(answer[1]);
    else if (answer && (!answer[2].trim() || /^\(.*\)$/.test(answer[2].trim()))) continue;
    else kept.push(line);
  }
  return { text: withoutUrls([kept.join("\n"), sources.resume, sources.knowledge].join("\n")), declined: declined.join("\n") };
}

// A term the material shows in other words ("SSE token streaming" for
// "real-time systems") is supported only with a quote that is really there.
const Evidence = z.object({
  supported: z.array(z.object({ term: z.string(), quote: z.string().describe("Under 20 words copied verbatim from the material.") })),
});

const EVIDENCE_SYSTEM = `You check which job-posting terms a candidate's own material shows they have done or used. For each term the material shows, return it with a short quote copied character for character from the material. Leave out terms the material only mentions as an open question or answers "none". Do not stretch: "async FastAPI services" shows "asynchronous programming", not "distributed systems".`;

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function verifyEvidence(terms: AtsTerm[], material: { text: string; declined: string }, runId: string): Promise<Record<string, string>> {
  const unmatched = terms.filter((t) => !found(material.text, t) && t.kind !== "soft-skill");
  if (!unmatched.length) return {};
  const { supported } = await askStructured({
    tier: "fast",
    system: EVIDENCE_SYSTEM,
    prompt: `<material>\n${material.text}\n</material>\n\n<terms>\n${unmatched.map((t) => `- ${t.term}`).join("\n")}\n</terms>`,
    schema: Evidence,
    effort: "low",
    tag: { runId, action: "ats-evidence" },
  });
  const haystack = flat(material.text);
  const wanted = new Set(unmatched.map((t) => t.term));
  return Object.fromEntries(supported.filter((e) => wanted.has(e.term) && e.quote.trim().length > 8 && haystack.includes(flat(e.quote))).map((e) => [e.term, e.quote.trim()]));
}

// ---------- the report ----------

// Where a term stands: shown in use in a bullet, listed only in Skills, absent
// from the resume but backed by the candidate's material, or not theirs to claim.
export type Placement = "body" | "skills" | "material" | "absent";
export interface TermResult extends AtsTerm {
  placement: Placement;
  count: number;
  evidence?: string; // the quote that backs a term the material shows in other words
}
export interface AtsCheck {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}
export interface AtsReport {
  score: number;
  title: { posting: string; match: boolean };
  terms: TermResult[];
  checks: AtsCheck[];
  added: string[]; // supported terms the app put into Skills
  at: string;
}

const CREDIT: Record<Placement, number> = { body: 1, skills: 0.7, material: 0, absent: 0 };
const weight = (t: AtsTerm) => (t.required ? 3 : 1);
// Soft skills are listed but not scored: a tracker can match "communication",
// a reader cannot verify it, and padding a resume with them reads badly.
const scored = (t: AtsTerm) => t.kind !== "soft-skill";

// The best score the candidate's material allows: every term it backs shown
// in a bullet. The gap to it is the resume's fault; the rest is fit.
export function atsCeiling(report: AtsReport): number {
  const weighted = report.terms.filter(scored);
  const total = weighted.reduce((a, t) => a + weight(t), 0);
  const best = (t: TermResult) => (t.placement === "absent" ? 0 : t.placement === "skills" ? (t.evidence ? 1 : CREDIT.skills) : 1);
  return total ? Math.round((100 * weighted.reduce((a, t) => a + best(t) * weight(t), 0)) / total) : 0;
}
// Past this, a reader sees repetition; trackers that penalise stuffing do too.
const STUFFED = 6;

// "Senior Backend Engineer II" -> ["backend", "engineer"]
const SENIORITY = /\b(senior|sr|junior|jr|lead|staff|principal|associate|entry[- ]level|intern|i{1,3}|iv|[1-4])\b\.?/gi;
const titleWords = (title: string) =>
  title
    .replace(/\(.*?\)/g, " ")
    .replace(SENIORITY, " ")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((w) => w.length > 1 && !["and", "the", "of", "for", "at", "-"].includes(w));

const DATE = String.raw`(?:[A-Z][a-z]{2,8}\.? \d{4}|\d{4})`;
const RANGE = new RegExp(`^${DATE} (?:–|—|-|to) (?:${DATE}|Present)$`);

export interface AtsInput {
  terms: AtsTerms;
  evidence?: Record<string, string>;
}

export function scoreAts(text: string, ats: AtsInput, material: { text: string; declined: string }, doc?: ResumeDoc, added: string[] = []): AtsReport {
  const terms = ats.terms;
  text = withoutUrls(text);
  const s = sectionsOf(text);
  // Terms saved before the generic filter existed are dropped here too.
  const results: TermResult[] = terms.terms.filter((t) => !isGeneric(t.term)).map((t) => {
    const n = count(text, t);
    const placement: Placement = found(s.body, t)
      ? "body"
      : found(s.skills, t) || found(s.header, t)
        ? "skills"
        : (found(material.text, t) || ats.evidence?.[t.term]) && !found(material.declined, t)
          ? "material"
          : "absent";
    return { ...t, placement, count: n, evidence: ats.evidence?.[t.term] };
  });
  const weighted = results.filter(scored);
  const total = weighted.reduce((a, t) => a + weight(t), 0);
  const score = total ? Math.round((100 * weighted.reduce((a, t) => a + CREDIT[t.placement] * weight(t), 0)) / total) : 0;

  const header = s.header.toLowerCase();
  const wanted = titleWords(terms.title);
  const titleMatch = wanted.length > 0 && wanted.every((w) => header.includes(w));

  const checks: AtsCheck[] = [];
  const check = (id: string, name: string, pass: boolean, detail: string) => checks.push({ id, name, pass, detail });
  const has = (re: RegExp) => s.headings.some((h) => re.test(h));
  const missingHeadings = [
    !has(/experience|employment/) && "Experience",
    !has(/education/) && "Education",
    !has(/skills|competencies/) && "Skills",
  ].filter(Boolean);
  check("headings", "Standard section headings", missingHeadings.length === 0, missingHeadings.length ? `no ${missingHeadings.join(", ")} heading` : s.headings.join(", "));
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.test(s.header);
  const phone = /\+?\d[\d\s().-]{7,}\d/.test(s.header);
  check("contact", "Contact details in the text, above the first section", email && phone, [email ? "email" : "no email", phone ? "phone" : "no phone"].join(", "));
  check("title", "Title under the name matches the posting", titleMatch, titleMatch ? terms.title : `posting says "${terms.title}"`);
  if (doc) {
    const odd = doc.experience.filter((x) => !RANGE.test(x.dates.trim())).map((x) => `${x.company}: "${x.dates}"`);
    check("dates", "Every role dated Mon YYYY – Mon YYYY", odd.length === 0, odd.join("; ") || `${doc.experience.length} roles`);
  }
  const stuffed = results.filter((t) => t.count > STUFFED).map((t) => `${t.term} ×${t.count}`);
  check("stuffing", `No term repeated more than ${STUFFED} times`, stuffed.length === 0, stuffed.join(", ") || "none");
  const required = results.filter((t) => t.required && scored(t));
  const covered = required.filter((t) => t.placement === "body" || t.placement === "skills");
  check("required", "Every required term you can back is on the page", !required.some((t) => t.placement === "material"), `${covered.length} of ${required.length} required terms`);

  return { score, title: { posting: terms.title, match: titleMatch }, terms: results, checks, added, at: new Date().toISOString() };
}

// ---------- writing to the terms ----------

// For the writer: which terms the resume already shows, which the candidate's
// material supports but the resume leaves out, and which are not theirs.
export function termsBlock(report: AtsReport): string {
  const line = (t: TermResult) =>
    `- ${t.term}${t.aliases.length ? ` (also: ${t.aliases.join(", ")})` : ""}${t.required ? " [required]" : ""}${t.placement === "material" && t.evidence ? `; backed by: "${t.evidence}"` : ""}`;
  const group = (p: Placement) => report.terms.filter((t) => t.placement === p && scored(t)).map(line).join("\n") || "(none)";
  return `<ats_terms posting_title="${report.title.posting}">
Already on the resume:
${group("body")}
Listed only in Skills (show each in use in a bullet where a fact supports it):
${group("skills")}
In the candidate's material but missing from the resume (work each in, spelled as the posting spells it):
${group("material")}
Not in the candidate's material (never claim these; for a required one, ask a question instead):
${group("absent")}
</ats_terms>`;
}

export const ATS_RULES = `Applicant tracking: the resume is parsed to plain text and matched term by term against the posting.
- Spell every term exactly as the posting does ("PostgreSQL", not "Postgres"). Where the posting uses an acronym, write the full form once with the acronym, e.g. "continuous integration (CI/CD)".
- A term counts most inside a bullet that shows it in use; Skills alone counts less. Put each supported required term in a bullet and in Skills.
- Use each term two or three times at most. Never add a term the candidate's material does not support; for a missing required term, add a question.`;

// Skills is where a supported tool can go without inventing a sentence about
// it. Fills the row that already holds tools of its kind, else the last row.
export function fillSkills(doc: ResumeDoc, report: AtsReport, kind: "Resume" | "CV"): { doc: ResumeDoc; added: string[] } {
  const d = structuredClone(doc);
  const cap = skillCap(kind);
  const posting = report.terms;
  const inPosting = (item: string) => posting.some((t) => found(item, t));
  const added: string[] = [];
  const rowFor = (t: AtsTerm) =>
    d.skills.find((r) => r.items.some((i) => posting.some((p) => p.kind === t.kind && found(i, p)))) ??
    d.skills.find((r) => (t.kind === "language" ? /lang/i : t.kind === "framework" ? /frame|backend|frontend|web|librar/i : /tool|cloud|devops|infra|platform|data/i).test(r.label)) ??
    d.skills.at(-1);
  for (const t of posting.filter((t) => t.placement === "material" && ["language", "framework", "tool", "platform"].includes(t.kind))) {
    const row = rowFor(t);
    if (!row) break;
    if (row.items.length >= cap) {
      // Make room by dropping the last item the posting does not ask for.
      const spare = row.items.map((item, i) => ({ item, i })).reverse().find(({ item }) => !inPosting(item));
      if (!spare) continue;
      row.items.splice(spare.i, 1);
    }
    // Posting terms lead the row.
    const firstOther = row.items.findIndex((i) => !inPosting(i));
    row.items.splice(firstOther === -1 ? row.items.length : firstOther, 0, t.term);
    added.push(t.term);
  }
  return { doc: d, added };
}
