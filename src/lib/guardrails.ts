import { z } from "zod";
import { askStructured } from "./claude";
import { NEEDS, type ResumeDoc } from "./schemas";

// The writer is asked for a short, scannable resume; these checks make sure
// it got one. Deterministic fixes run first, then one cheap call rewrites only
// the lines that still break a rule, then hard limits clamp whatever is left.

export type DocKind = "Resume" | "CV";

const LIMITS = {
  Resume: { bullet: 150, summary: 260, roleBullets: 4, projectBullets: 2, projects: 3, stack: 4, skillRows: 4, skillItems: 8 },
  CV: { bullet: 170, summary: 320, roleBullets: 6, projectBullets: 4, projects: 6, stack: 5, skillRows: 5, skillItems: 10 },
} as const;

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

export const skillCap = (kind: DocKind) => LIMITS[kind].skillItems;

// A category, not a skill: "programming language" in a Languages row reads as
// template residue to a screener.
const GENERIC = /^(?:(?:a|an|any|one|other|modern|relevant|popular|major|general[- ]purpose|scripting|object[- ]oriented|programming|coding|cloud|software|backend|frontend)\s+)*(?:languages?|frameworks?|librar(?:y|ies)|tools?|tooling|databases?|platforms?|technolog(?:y|ies)|software|stack|cloud)$/i;
export const isGeneric = (term: string) => GENERIC.test(term.trim());

// Words that pad a resume line without saying anything a reader can check.
const FILLER = [...BANNED, "spearheaded", "utilized", "responsible for", "various", "cutting-edge", "seamless", "robust", "world-class", "synergies", "helped to"];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "Jun 2026" -> the first of that month; null when it isn't a month and year.
function monthOf(text: string): Date | null {
  const m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && month >= 0 ? new Date(Date.UTC(Number(m[2]), month, 1)) : null;
}

// A date already behind us reads as done: "Graduating Jun 2026" in October
// 2026 tells a recruiter the degree is unfinished.
const FUTURE_TENSE = /\b(graduating|expected(?: graduation)?|expected to graduate|anticipated|will graduate(?: in)?)\s*(?:in\s+)?(?=[A-Za-z]{3}[a-z]*\.?\s+\d{4})/gi;

function pastTense(text: string, today: Date, lower: boolean): string {
  return text.replace(FUTURE_TENSE, (match, _w, offset: number, whole: string) => {
    const when = monthOf(whole.slice(offset + match.length));
    if (!when || when > today) return match;
    const word = lower || match[0] === match[0].toLowerCase() ? "graduated " : "Graduated ";
    return word;
  });
}

const sentenceCount = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim()).length;
const toolList = /\(([^()]*,){2,}[^()]*\)/; // "(Redis, Postgres, Celery)"
const placeholder = /<N>|\{\{|\}\}|\bTODO\b|\bXX+\b|«|»/;
const bare = (l: string) => l.replace(NEEDS, "").trim();

export interface Issue {
  id: string; // where the line lives, e.g. "experience.0.bullets.2"
  text: string;
  problems: string[];
}

export interface GuardReport {
  fixed: string[]; // deterministic fixes, one line each
  rewritten: number; // lines the repair call rewrote
  remaining: Issue[]; // still breaking a rule after the repair
}

function linesOf(doc: ResumeDoc): { id: string; text: string }[] {
  return [
    ...doc.summary.map((text, i) => ({ id: `summary.${i}`, text })),
    ...doc.experience.flatMap((x, i) => x.bullets.map((text, j) => ({ id: `experience.${i}.bullets.${j}`, text }))),
    ...doc.projects.flatMap((p, i) => p.bullets.map((text, j) => ({ id: `projects.${i}.bullets.${j}`, text }))),
    ...doc.education.flatMap((e, i) => e.details.map((text, j) => ({ id: `education.${i}.details.${j}`, text }))),
  ];
}

function setLine(doc: ResumeDoc, id: string, text: string): void {
  const [section, i, field, j] = id.split(".");
  if (section === "summary") doc.summary[Number(i)] = text;
  else if (section === "experience" && field === "bullets") doc.experience[Number(i)].bullets[Number(j)] = text;
  else if (section === "projects" && field === "bullets") doc.projects[Number(i)].bullets[Number(j)] = text;
  else if (section === "education" && field === "details") doc.education[Number(i)].details[Number(j)] = text;
}

export function lint(doc: ResumeDoc, kind: DocKind, today = new Date()): Issue[] {
  const lim = LIMITS[kind];
  const issues: Issue[] = [];
  for (const { id, text } of linesOf(doc)) {
    const line = bare(text);
    const problems: string[] = [];
    const isSummary = id.startsWith("summary");
    if (!isSummary && line.length > lim.bullet) problems.push(`${line.length} characters; keep it under ${lim.bullet}`);
    if (toolList.test(line)) problems.push("a bracketed list of tools; name at most two tools in the sentence and leave the rest to Skills");
    const filler = FILLER.filter((w) => line.toLowerCase().includes(w));
    if (filler.length) problems.push(`filler words: ${filler.join(", ")}`);
    if (placeholder.test(line)) problems.push("a placeholder");
    if (pastTense(line, today, true) !== line) problems.push("future tense for a date that has passed");
    if (problems.length) issues.push({ id, text, problems });
  }
  const summary = doc.summary.map(bare).join(" ");
  if (summary.length > lim.summary || sentenceCount(summary) > 2)
    issues.push({ id: "summary.0", text: doc.summary.join(" "), problems: [`summary is ${summary.length} characters in ${sentenceCount(summary)} sentences; one or two sentences under ${lim.summary}`] });
  return issues;
}

// Fixes that need no model: tense, duplicates, unknown links, and the counts
// that keep a page from looking crowded.
export function tidy(doc: ResumeDoc, kind: DocKind, opts: { today: Date; urls: Set<string> }): { doc: ResumeDoc; fixed: string[] } {
  const lim = LIMITS[kind];
  const d: ResumeDoc = structuredClone(doc);
  const fixed: string[] = [];
  const note = (s: string) => fixed.push(s);

  for (const e of d.education) {
    let dates = pastTense(e.dates, opts.today, false).trim();
    // A lone month and year already behind us is a finished degree; say so.
    const when = /^[A-Za-z]{3}[a-z]*\.?\s+\d{4}$/.test(dates) ? monthOf(dates) : null;
    if (when && when <= opts.today) dates = `Graduated ${dates}`;
    if (dates !== e.dates) note(`Education dates "${e.dates}" → "${dates}"`);
    e.dates = dates;
  }
  for (const { id, text } of linesOf(d)) {
    const next = pastTense(text, opts.today, true);
    if (next !== text) {
      note(`Past tense for a finished degree in ${id.split(".")[0]}`);
      setLine(d, id, next);
    }
  }

  // Links must come from the profile or the knowledge base; an invented URL
  // is worse than none.
  const known = (url: string) => !url || opts.urls.has(normUrl(url));
  for (const x of d.experience)
    if (!known(x.url)) {
      note(`Dropped an unknown link for ${x.company}: ${x.url}`);
      x.url = "";
    }
  for (const p of d.projects)
    if (!known(p.url)) {
      note(`Dropped an unknown link for ${p.name}: ${p.url}`);
      p.url = "";
    }

  const seen = new Set<string>();
  const unique = (lines: string[]) =>
    lines.filter((l) => {
      const k = bare(l).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(k)) {
        note(`Dropped a repeated line: "${bare(l).slice(0, 60)}…"`);
        return false;
      }
      seen.add(k);
      return true;
    });
  for (const x of d.experience) x.bullets = unique(x.bullets);
  for (const p of d.projects) p.bullets = unique(p.bullets);

  // Bullets are ranked best-first, so cuts take from the end.
  for (const x of d.experience)
    if (x.bullets.length > lim.roleBullets) {
      note(`${x.company}: kept the best ${lim.roleBullets} of ${x.bullets.length} bullets`);
      x.bullets = x.bullets.slice(0, lim.roleBullets);
    }
  if (d.projects.length > lim.projects) {
    note(`Kept the best ${lim.projects} of ${d.projects.length} projects`);
    d.projects = d.projects.slice(0, lim.projects);
  }
  for (const p of d.projects) {
    if (p.bullets.length > lim.projectBullets) {
      note(`${p.name}: kept the best ${lim.projectBullets} of ${p.bullets.length} bullets`);
      p.bullets = p.bullets.slice(0, lim.projectBullets);
    }
    const stack = p.stack.split(",").map((s) => s.trim()).filter(Boolean);
    if (stack.length > lim.stack) {
      note(`${p.name}: stack cut to ${lim.stack} tools`);
      p.stack = stack.slice(0, lim.stack).join(", ");
    }
  }

  const used = new Set<string>();
  d.skills = d.skills
    .map((row) => ({
      label: row.label,
      items: row.items.filter((s) => {
        const k = s.trim().toLowerCase();
        if (!k || used.has(k)) return false;
        used.add(k);
        if (isGeneric(k)) {
          note(`Skills: dropped "${s.trim()}", a category rather than a skill`);
          return false;
        }
        return true;
      }),
    }))
    .filter((row) => row.items.length);
  if (d.skills.length > lim.skillRows) {
    note(`Skills cut to ${lim.skillRows} rows`);
    d.skills = d.skills.slice(0, lim.skillRows);
  }
  for (const row of d.skills)
    if (row.items.length > lim.skillItems) {
      note(`Skills "${row.label}" cut to ${lim.skillItems} items`);
      row.items = row.items.slice(0, lim.skillItems);
    }

  return { doc: d, fixed };
}

const normUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.git$/, "").replace(/\/+$/, "");

// Every URL the candidate's own material contains.
export function knownUrls(...sources: string[]): Set<string> {
  const urls = new Set<string>();
  for (const s of sources) for (const m of s.matchAll(/https?:\/\/[^\s)<>"'\]]+/g)) urls.add(normUrl(m[0].replace(/[.,;]+$/, "")));
  return urls;
}

const Repairs = z.object({ lines: z.array(z.object({ id: z.string(), text: z.string() })) });

const REPAIR_SYSTEM = `You tighten resume lines that break the style rules. Rewrite ONLY the lines given, each to fix every problem listed for it. Keep every fact, number, tool and result the line states and add none; when a line is too long, drop the least important detail rather than compress into jargon. A bullet reads: strong past-tense verb, what was built, the result. Name at most two tools per bullet. No filler words. Return each line with its id unchanged.`;

// The orchestration: tidy → lint → repair (fast tier, only flagged lines) →
// tidy again. Each step reports what it did so the run can show it.
export async function guard(doc: ResumeDoc, kind: DocKind, opts: { today?: Date; urls: Set<string>; runId: string }): Promise<{ doc: ResumeDoc; report: GuardReport }> {
  const today = opts.today ?? new Date();
  const first = tidy(doc, kind, { today, urls: opts.urls });
  const issues = lint(first.doc, kind, today);
  let rewritten = 0;
  let current = first.doc;
  if (issues.length) {
    const lim = LIMITS[kind];
    const ask = issues.map((i) => `<line id="${i.id}" problems="${i.problems.join("; ")}">\n${i.id === "summary.0" && i.problems[0].startsWith("summary") ? bare(current.summary.join(" ")) : bare(i.text)}\n</line>`).join("\n");
    try {
      const { lines } = await askStructured({
        tier: "fast",
        system: REPAIR_SYSTEM,
        prompt: `Bullets stay under ${lim.bullet} characters; the summary is one or two sentences under ${lim.summary} characters.\n\n${ask}`,
        schema: Repairs,
        effort: "low",
        tag: { runId: opts.runId, action: "guard:repair" },
      });
      current = structuredClone(current);
      const wanted = new Map(issues.map((i) => [i.id, i]));
      for (const { id, text } of lines) {
        const issue = wanted.get(id);
        if (!issue || !text.trim()) continue;
        // The question marker belongs to the app, not the writer: keep it.
        const marker = issue.text.match(NEEDS)?.[0];
        const next = marker ? `${text.trim()} ${marker}` : text.trim();
        if (id === "summary.0" && issue.problems[0].startsWith("summary")) current.summary = [next];
        else setLine(current, id, next);
        rewritten++;
      }
    } catch {} // the repair is a polish; the tidy result still stands
  }
  const last = tidy(current, kind, { today, urls: opts.urls });
  return { doc: last.doc, report: { fixed: [...first.fixed, ...last.fixed.filter((f) => !first.fixed.includes(f))], rewritten, remaining: lint(last.doc, kind, today) } };
}

// Shared with the writer prompts so the model aims at the same targets the
// checks enforce.
export function styleRules(kind: DocKind, today = new Date()): string {
  const lim = LIMITS[kind];
  return `Today is ${today.toISOString().slice(0, 10)}. A date before today is in the past: write "Graduated Jun 2026", never "Graduating" or "Expected", for a degree that has finished.

Style, so a reader can scan it in 30 seconds:
- Each bullet is one idea on one line: past-tense verb, what was built, the result. Under ${lim.bullet} characters.
- Name at most two tools in a bullet, in the sentence. Never a bracketed list of tools; tools belong in Skills.
- Summary: one or two sentences, under ${lim.summary} characters, or empty.
- At most ${lim.roleBullets} bullets per role, ${lim.projects} projects with ${lim.projectBullets} bullets each, a project stack of at most ${lim.stack} tools.
- Skills: at most ${lim.skillRows} rows of at most ${lim.skillItems} items, each item once, the posting's tools first.
- No filler: ${FILLER.slice(0, 12).join(", ")}.`;
}
