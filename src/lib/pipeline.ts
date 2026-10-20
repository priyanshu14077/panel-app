import { promises as fs } from "node:fs";
import path from "node:path";
import { askResearch, askStructured, askText, streamChat } from "./claude";
import { compileResume, pdfName, type DocKind, type PdfCheck } from "./compile";
import { appendProfileSection, improvedFolderOf, parseContact, readProfile, resumeText } from "./files";
import { knowledgeDigest, knowledgeItems, loadKnowledge, shortlistRepos } from "./knowledge/cards";
import { renderLatex, renderText } from "./latex";
import { IMPROVED_DIR, PANEL_DIR, safeSegment } from "./paths";
import { REVIEWERS, REVIEWER_SYSTEM, SCREEN_BRIEF, reviewerPrompt, verdictOf, type ReviewerId } from "./reviewers";
import { CvPicks, Email, Findings, Ideas, JobDetails, LIMITS, NEEDS, ProjectTurn, Rebuild, ResumeDoc, Sequence, STAGES, type Board, type CvOption, type ProjectIdea, type Stage, type Synthesis, type Writeup } from "./schemas";
import { importJob } from "./import-job";
import { allRuns, getRun, putRun } from "./db";

export interface Review {
  id: ReviewerId;
  name: string;
  verdict: string;
  text: string;
}

export interface Screen {
  verdict: string;
  text: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  at?: string;
}

export interface DraftedEmail extends Email {
  kind: string;
  createdAt: string;
}

export interface AddedProject {
  name: string;
  url: string;
  status: "built" | "in progress";
  stack: string;
  details: string;
}

export interface ProjectProposal {
  name: string;
  stack: string;
  url: string;
  bullets: string[];
  keywords: ProjectTurn["keywords"];
}

// An interview about one resume project, keyed by the project's name.
export interface ProjectChat {
  turns: ChatTurn[];
  facts: string[];
  proposal?: ProjectProposal;
}

export interface DraftedSequence extends Sequence {
  target: string;
  createdAt: string;
}

export interface Run {
  id: string;
  createdAt: string;
  resumeFile: string;
  // The base resume this run's chain started from. Differs from resumeFile when
  // the panel reviews a PDF an earlier run produced; evals ground against it.
  originResume?: string;
  // Where the PDF goes. Set when reviewing an improved PDF for the same posting,
  // so each iteration replaces (and archives) the previous one in one folder.
  outputFolder?: string;
  jobText: string;
  reviews: Review[];
  synthesis?: Synthesis;
  rescreens: Screen[];
  pdf?: { folder: string; file: string; check: PdfCheck };
  // The longer CV, built on request from the resume plus knowledge-base picks.
  cv?: { folder: string; file: string; check: PdfCheck; picks: string[] };
  cvOptions?: CvOption[];
  companyBrief?: string;
  companyResearchedAt?: string;
  companyIdeas?: ProjectIdea[];
  chat?: ChatTurn[];
  projectChats?: Record<string, ProjectChat>;
  emails?: DraftedEmail[];
  outreach?: DraftedSequence[];
  judge?: import("./evals").JudgeResult;
  shortlist?: string[];
  details?: JobDetails;
  board?: Board;
  error?: string;
}

export type RunEvent =
  | { type: "started"; runId: string }
  | { type: "stage"; stage: string }
  | { type: "review"; review: Review }
  | { type: "synthesis"; synthesis: Synthesis }
  | { type: "rescreen"; screen: Screen }
  | { type: "pdf"; pdf: NonNullable<Run["pdf"]> }
  | { type: "cv"; cv: NonNullable<Run["cv"]> }
  | { type: "company"; brief: string; ideas: ProjectIdea[] }
  | { type: "imported"; folder: string; title: string; company: string }
  | { type: "details"; details: JobDetails }
  | { type: "email"; email: DraftedEmail }
  | { type: "outreach"; sequence: DraftedSequence }
  | { type: "error"; message: string }
  | { type: "done"; run: Run };

const runDir = (id: string) => path.join(PANEL_DIR, safeSegment(id));

export async function loadRun(id: string): Promise<Run> {
  const run = getRun(safeSegment(id));
  if (!run) throw new Error(`No run ${id}`);
  return run;
}

export async function saveRun(run: Run): Promise<void> {
  putRun(run);
}

export async function listRuns(): Promise<Pick<Run, "id" | "createdAt" | "synthesis" | "pdf">[]> {
  return (await loadAllRuns()).map((r) => ({ id: r.id, createdAt: r.createdAt, synthesis: r.synthesis, pdf: r.pdf }));
}

export async function loadAllRuns(): Promise<Run[]> {
  return allRuns();
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------- prompts ----------

const FACT_RULES = `Use ONLY facts from the resume, the candidate profile and the knowledge base. Never invent employers, titles, dates, numbers, tools, users or results. A profile answer of "none" means the candidate lacks that skill: never claim it.`;

const FINDINGS_SYSTEM = `You run the merge stage of a seven-member hiring panel. From the seven reviews, produce one list of the resume's mistakes, worst first, merging duplicates. Each has the quoted resume line (or "missing: <term>"), why it gets the resume rejected, and the reviewers who flagged it as a comma-separated list. Also extract the company, the role, and the posting's official job id (empty string if none).`;

const REBUILD_SYSTEM = `You rebuild a resume for one job posting, fixing every mistake the hiring panel found. ${FACT_RULES}

Reword and reorder freely, and use the posting's own vocabulary wherever an existing fact supports it. When a fix needs a fact you do not have, still write the best line, end it with [[needs:<question-id>]], and add that question to "questions" (short kebab-case id). Never ask what the profile already answers. Set "headline" to the role title for this posting; it is printed under the name. Leave out the candidate's name and contact details; they are added separately. Use "" for a missing url. Keep it to one page: at most 5 bullets per role and 2-3 per project.

Choose the Projects section from the whole knowledge base, not just the projects already on the resume: pick the 2-4 repos that best answer this posting and the panel's gaps, preferring repos with real commits by the candidate and higher maturity, and use the repo URL from the knowledge base. A repo of kind "template-or-copy" or "learning" is not evidence of professional skill. Work in an employer's org repo supports that employer's experience bullets, not a separate project. The portfolio's case studies and posts are the candidate's own writing; their technical details may back a bullet, but a claim found only on the portfolio needs a question. Projects the candidate added in the app (see the profile) are theirs: mark one "(in progress)" in its name if its status says so.`;

const IDEAS_SYSTEM = `You suggest 3 to 5 short projects a candidate could BUILD to close the biggest gaps a hiring panel found for one job posting. Each must be finishable in under a week by one person, use the posting's stack where possible, and build on what the candidate already knows. Prefer extending one of the candidate's existing repos (set "extends" to its full name) when that is faster. Never suggest something the knowledge base shows they have already built. "bulletOnceBuilt" is a resume bullet for after it is built, with measurable results left as placeholders like <N>.`;

const COMPANY_IDEAS_SYSTEM = `${IDEAS_SYSTEM}

This time, lean every idea toward the hiring company: mirror its product, its customers' problems, its integrations or its stack, using the company research provided, so the project doubles as a conversation starter in the interview. Explain the link in "companyAngle". Do not use the company's name or branding as the project's name.`;

const RESEARCH_SYSTEM = `You research a company for a job applicant. Use web search. Report, in plain bullet points with source URLs: what the company sells and to whom; its main product surfaces and integrations; its tech stack and engineering signals (engineering blog, job posts, GitHub); recent launches or news from the last 12 months; and what the team for this role likely builds. Say "unknown" rather than guess.`;

const REVISE_SYSTEM = `You update a resume after the candidate answered open questions. For every line that ends with [[needs:<id>]] for an answered question: rewrite the line using the answer and remove the marker. If the answer is "none", "no" or "skip", delete that line. Leave lines for unanswered questions unchanged. Never add facts that are not in the answers, the profile or the existing resume. Keep it to one page.`;

const CV_PICKS_SYSTEM = `You help a candidate choose what to add to a CV for one job posting. From the list of their repositories and portfolio pages, pick up to 15 items that best prove fit for this posting, most relevant first. Prefer real products, client work and repos with many commits by the candidate over learning repos and templates. Leave out anything with no link to the posting. Return exact ids from the list.`;

const CV_SYSTEM = `You write a CV for one job posting: a fuller version of the candidate's tailored resume, up to two pages. ${FACT_RULES}

Start from the tailored resume: keep its headline, experience, education and order, and keep its best lines. Then go deeper: up to 6 bullets per role, and a Projects entry for each repository the candidate selected (3-4 bullets each, the repo URL from the knowledge base), most relevant to the posting first. Keep the resume's own projects unless a selected item covers the same work. A selected portfolio page becomes a project when it describes something the candidate built, and otherwise backs bullets elsewhere. Use the posting's vocabulary wherever an existing fact supports it. Never write a line that needs a fact you do not have: leave it out. Leave out the candidate's name and contact details; they are added separately. Use "" for a missing url.`;

const CHAT_SYSTEM = `You help a job candidate with one application: answering application-form questions, tightening answers, and preparing for screening calls. Write as the candidate, in the first person, in crisp technical language. No filler, no clichés ("passionate", "leverage", "delve", "thrilled", "I'm excited to"), no generic claims a reader can't check. Prefer specific systems, numbers and decisions from the candidate's real work.

${FACT_RULES} If an answer needs a fact you don't have, write the answer with a bracketed gap like [your team size] and say in one line what to fill in. When a form question has a word or character limit, respect it and state the count. Return answers ready to paste, without preamble.`;

const EMAIL_SYSTEM = `You draft one email for a job candidate. Plain text, first person, under 170 words, no filler or clichés ("I hope this email finds you well", "passionate", "thrilled"). Open with why this role at this company, give two concrete proof points from the candidate's real work that match the posting, and close with one clear ask. ${FACT_RULES} Use [Name] for an unknown recipient name. The subject line is specific to the role.`;

// ---------- context ----------

// The knowledge base is cut to the run's shortlist: a dozen relevant repos
// instead of every repo keeps each writing call about 18k tokens smaller.
async function candidateContext(run?: Run) {
  const [profile, knowledge] = await Promise.all([readProfile(), loadKnowledge()]);
  const contact = parseContact(profile);
  return { profile, contact, knowledge: knowledgeDigest(knowledge, run?.shortlist) };
}

function contextBlock(run: Run, ctx: Awaited<ReturnType<typeof candidateContext>>, resume: string): string {
  return [
    `<job_posting>\n${run.jobText}\n</job_posting>`,
    `<resume>\n${resume}\n</resume>`,
    `<candidate_profile>\n${ctx.profile}\n</candidate_profile>`,
    `<knowledge_base>\n${ctx.knowledge}\n</knowledge_base>`,
    run.companyBrief ? `<company_research>\n${run.companyBrief}\n</company_research>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const panelBlock = (reviews: Review[]) =>
  `<panel>\n${reviews.map((r) => `<review reviewer="${r.name}">\n${r.text}\n</review>`).join("\n\n")}\n</panel>`;

const mistakesBlock = (s: Pick<Synthesis, "mistakes">) =>
  `<mistakes>\n${s.mistakes.map((m, i) => `${i + 1}. ${m.quote}: ${m.why}`).join("\n")}\n</mistakes>`;

// The rebuilt resume as plain text, for chat, email and the re-screen.
function improvedText(run: Run, ctx: Awaited<ReturnType<typeof candidateContext>>): string {
  return run.synthesis ? renderText(run.synthesis.resume, ctx.contact, false) : "";
}

// ---------- outputs ----------

function outputFolder(s: Synthesis, createdAt: string): string {
  const parts = s.job.jobId ? [s.job.jobId, s.job.company, s.job.role] : [s.job.company, s.job.role, createdAt.slice(0, 10)];
  // "LimeChat SDE" + "LimeChat" + "Software Development Engineer (...)" -> limechat-sde-software-development-engineer
  const words = [...new Set(safeSegment(parts.join("-")).split("-"))];
  return safeSegment(words.slice(0, 7).join("-"));
}

// Cuts that shrink a resume, gentlest first. Bullets are ranked best-first,
// so each cut drops the last one.
const TRIMS: ((d: ResumeDoc) => boolean)[] = [
  (d) => d.summary.length > 2 && !!d.summary.pop(),
  (d) => d.projects.length > 3 && !!d.projects.pop(),
  (d) => d.projects.some((p) => p.bullets.length > 2) && !!d.projects.find((p) => p.bullets.length > 2)!.bullets.pop(),
  (d) => d.experience.some((x) => x.bullets.length > 4) && !!d.experience.find((x) => x.bullets.length > 4)!.bullets.pop(),
  (d) => d.skills.length > 4 && !!d.skills.pop(),
  (d) => d.summary.length > 0 && !!d.summary.pop(),
  (d) => d.projects.length > 2 && !!d.projects.pop(),
  (d) => {
    const longest = [...d.experience].sort((a, b) => b.bullets.length - a.bullets.length)[0];
    return !!longest && longest.bullets.length > 2 && !!longest.bullets.pop();
  },
  (d) => d.projects.some((p) => p.bullets.length > 1) && !!d.projects.find((p) => p.bullets.length > 1)!.bullets.pop(),
];

// Compiles the PDF, trimming the lowest-ranked lines until it fits one page
// (two for a CV). Only the PDF is trimmed: the full rebuild stays in the run
// for later edits.
export async function compileFitted(doc: ResumeDoc, profile: string, folder: string, kind: DocKind = "Resume"): Promise<NonNullable<Run["pdf"]>> {
  const contact = parseContact(profile);
  const maxPages = kind === "CV" ? 2 : 1;
  await archivePrevious(path.join(IMPROVED_DIR, folder), pdfName(contact.name, kind));
  const fitted: ResumeDoc = structuredClone(doc);
  for (let attempt = 0; ; attempt++) {
    const { pdf, check } = await compileResume(path.join(IMPROVED_DIR, folder), await renderLatex(fitted, contact), contact.name, kind);
    if (check.pages <= maxPages || attempt >= 12 || !TRIMS.some((cut) => cut(fitted))) return { folder, file: path.basename(pdf), check };
  }
}

// Keeps the PDF a rebuild is about to replace, which may be the very file the
// panel just reviewed. Runs once per rebuild, not per fit-to-page attempt.
async function archivePrevious(dir: string, name: string): Promise<void> {
  const current = path.join(dir, name);
  try {
    const stat = await fs.stat(current);
    const stamp = stat.mtime.toISOString().replace(/[:.]/g, "-");
    await fs.mkdir(path.join(dir, "archive"), { recursive: true });
    await fs.rename(current, path.join(dir, "archive", `${stamp}-${name}`));
  } catch {} // nothing compiled here yet
}

// Follows an improved PDF back to the run that produced it: the base resume the
// chain started from, and the folder to keep iterating in when the posting is
// the same one.
async function lineageOf(resumeFile: string, jobText: string): Promise<{ origin: string; folder?: string }> {
  const folder = improvedFolderOf(resumeFile);
  if (folder === null) return { origin: resumeFile };
  const producer = (await loadAllRuns()).filter((r) => r.pdf?.folder === folder).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!producer) return { origin: resumeFile };
  return {
    origin: producer.originResume ?? producer.resumeFile,
    folder: producer.jobText.trim() === jobText.trim() ? folder : undefined,
  };
}

const buildPdf = (run: Run, doc: ResumeDoc, profile: string) =>
  compileFitted(doc, profile, run.outputFolder ?? outputFolder(run.synthesis!, run.createdAt));

async function writeReports(run: Run, profile: string): Promise<void> {
  const s = run.synthesis!;
  const contact = parseContact(profile);
  const ideas = [...(run.companyIdeas ?? []), ...s.projects];
  const panel = [
    `# Hiring panel: ${s.job.company}, ${s.job.role}${s.job.jobId ? ` (${s.job.jobId})` : ""}`,
    "",
    `Resume reviewed: ${run.resumeFile}${run.originResume && run.originResume !== run.resumeFile ? ` (built from ${run.originResume})` : ""}. Run ${run.createdAt}.`,
    "",
    "## The seven verdicts",
    "",
    ...run.reviews.flatMap((r) => [`### ${r.name}: ${r.verdict}`, "", r.text, ""]),
    "## What is wrong, worst first",
    "",
    ...s.mistakes.map((m, i) => `${i + 1}. **${m.quote}** ${m.why} *Flagged by: ${m.flaggedBy}.*`),
    "",
    "## Automated screen, before and after",
    "",
    `- Before: ${run.reviews.find((r) => r.id === "screen")?.verdict}`,
    ...run.rescreens.map((r, i) => `- After rebuild ${i + 1}: ${r.verdict}`),
    "",
    "## Projects to build",
    "",
    ...ideas.flatMap((p) => [
      `### ${p.title} (${p.scope})`,
      "",
      p.pitch,
      "",
      `Closes: ${p.closesGap}`,
      p.companyAngle ? `Company angle: ${p.companyAngle}` : "",
      p.extends ? `Extends: ${p.extends}` : "",
      "",
    ]),
  ].join("\n");
  const questions = s.questions.map((q, i) => `${i + 1}. **${q.question}** ${q.why}`).join("\n");
  const improved = `${renderText(s.resume, contact, true)}\n\n---\n\n### Questions to answer\n\n${questions || "None."}\n`;
  await fs.mkdir(runDir(run.id), { recursive: true });
  await fs.writeFile(path.join(runDir(run.id), "PANEL.md"), panel);
  await fs.writeFile(path.join(runDir(run.id), "RESUME-IMPROVED.md"), improved);
}

async function screen(job: string, resume: string, runId: string): Promise<Screen> {
  const text = await askText({ system: REVIEWER_SYSTEM, prompt: reviewerPrompt(SCREEN_BRIEF, job, resume), effort: "medium", tier: "fast", tag: { runId, action: "rescreen" } });
  return { verdict: verdictOf(text), text };
}

// Re-screen the rebuilt resume, compile the PDF, write the reports.
async function* finish(run: Run): AsyncGenerator<RunEvent> {
  const ctx = await candidateContext(run);
  yield { type: "stage", stage: "Re-running the automated screen and compiling the PDF" };
  const [screenResult, pdf] = await Promise.all([screen(run.jobText, improvedText(run, ctx), run.id), buildPdf(run, run.synthesis!.resume, ctx.profile)]);
  run.rescreens.push(screenResult);
  yield { type: "rescreen", screen: screenResult };
  run.pdf = pdf;
  yield { type: "pdf", pdf };
  run.error = undefined;
  await saveRun(run);
  await writeReports(run, ctx.profile);
  yield { type: "done", run };
}

async function* guarded(run: Run, body: () => AsyncGenerator<RunEvent>): AsyncGenerator<RunEvent> {
  try {
    yield* body();
  } catch (err) {
    run.error = errorMessage(err);
    await saveRun(run);
    yield { type: "error", message: run.error };
  }
}

// ---------- the panel ----------

export function runPanel(input: { jobText: string; resumeFile: string }): AsyncGenerator<RunEvent> {
  const now = new Date();
  const run: Run = {
    id: `${now.toISOString().slice(0, 10)}-app-${now.toISOString().slice(11, 19).replace(/:/g, "")}`,
    createdAt: now.toISOString(),
    resumeFile: input.resumeFile,
    jobText: input.jobText,
    reviews: [],
    rescreens: [],
  };
  return guarded(run, async function* () {
    yield { type: "started", runId: run.id };
    const lineage = await lineageOf(input.resumeFile, input.jobText);
    run.originResume = lineage.origin;
    run.outputFolder = lineage.folder;
    const [resume, knowledge] = await Promise.all([resumeText(input.resumeFile), loadKnowledge()]);
    // Picked while the reviewers read, so it adds no wait.
    const shortlist = shortlistRepos(knowledge, input.jobText, { runId: run.id, action: "shortlist" });
    const details = extractDetails(input.jobText, run.id);

    yield { type: "stage", stage: "Seven reviewers are reading the resume" };
    // All seven at once; each is reported as it lands.
    const pending = new Map(
      REVIEWERS.map((r) => [
        r.id,
        askText({ tier: "fast", system: REVIEWER_SYSTEM, prompt: reviewerPrompt(r.brief, input.jobText, resume), effort: "medium", tag: { runId: run.id, action: `review:${r.id}` } }).then(
          (text): Review => ({ id: r.id, name: r.name, verdict: verdictOf(text), text }),
          (err): Review => ({ id: r.id, name: r.name, verdict: "ERROR", text: errorMessage(err) }),
        ),
      ]),
    );
    while (pending.size) {
      const review = await Promise.race(pending.values());
      pending.delete(review.id);
      run.reviews.push(review);
      yield { type: "review", review };
    }
    run.reviews.sort((a, b) => REVIEWERS.findIndex((r) => r.id === a.id) - REVIEWERS.findIndex((r) => r.id === b.id));
    if (run.reviews.every((r) => r.verdict === "ERROR")) throw new Error(`Every reviewer failed: ${run.reviews[0].text}`);

    yield { type: "stage", stage: "Merging the panel's findings" };
    const findings = await askStructured({
      system: FINDINGS_SYSTEM,
      prompt: `<job_posting>\n${input.jobText}\n</job_posting>\n\n<resume>\n${resume}\n</resume>\n\n${panelBlock(run.reviews)}`,
      schema: Findings,
      effort: "medium",
      tier: "fast", tag: { runId: run.id, action: "findings" },
    });

    yield { type: "stage", stage: "Rebuilding the resume and choosing projects to suggest" };
    run.shortlist = await shortlist;
    const ctx = await candidateContext(run);
    const context = contextBlock(run, ctx, resume);
    const [rebuild, ideas] = await Promise.all([
      askStructured({ system: REBUILD_SYSTEM, prompt: `${context}\n\n${mistakesBlock(findings)}`, schema: Rebuild, effort: "medium", tier: "writer", tag: { runId: run.id, action: "rebuild" } }),
      askStructured({ system: IDEAS_SYSTEM, prompt: `${context}\n\n${mistakesBlock(findings)}`, schema: Ideas, effort: "medium", tier: "writer", tag: { runId: run.id, action: "ideas" } }),
    ]);
    run.details = (await details) ?? undefined;
    if (run.details) yield { type: "details", details: run.details };
    run.board = { stage: "To apply", movedAt: new Date().toISOString(), notes: "", sent: {} };
    run.synthesis = {
      job: { company: findings.company, role: findings.role, jobId: findings.jobId },
      mistakes: findings.mistakes,
      resume: rebuild.resume,
      questions: rebuild.questions,
      projects: ideas.ideas,
    };
    yield { type: "synthesis", synthesis: run.synthesis };
    await saveRun(run);
    yield* finish(run);
  });
}

// ---------- follow-up actions on a run ----------

export async function answerQuestions(id: string, answers: Record<string, string>): Promise<AsyncGenerator<RunEvent>> {
  const run = await loadRun(id);
  return guarded(run, async function* () {
    const s = run.synthesis;
    if (!s) throw new Error("This run has no rebuilt resume yet.");
    const answered = s.questions.filter((q) => answers[q.id]?.trim());
    await appendProfileSection(
      "Answers given in the panel app",
      answered.map((q) => `${q.question}: ${answers[q.id]}`),
    );
    const ctx = await candidateContext(run);
    yield { type: "stage", stage: "Rewriting the resume with your answers" };
    const qa = answered.map((q) => `<answer question_id="${q.id}" question="${q.question}">\n${answers[q.id]}\n</answer>`).join("\n");
    s.resume = await askStructured({
      system: REVISE_SYSTEM,
      prompt: `<resume_json>\n${JSON.stringify(s.resume)}\n</resume_json>\n\n<answers>\n${qa}\n</answers>\n\n<candidate_profile>\n${ctx.profile}\n</candidate_profile>`,
      schema: ResumeDoc,
      effort: "medium",
      tier: "writer", tag: { runId: run.id, action: "answers" },
    });
    s.questions = s.questions.filter((q) => !answers[q.id]?.trim());
    yield { type: "synthesis", synthesis: s };
    yield* finish(run);
  });
}

// Web research is a fifth of a run's cost and a company changes slowly, so a
// brief from any run for the same company in the last 30 days is reused.
const BRIEF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function recentBrief(company: string): Promise<{ brief: string; at: string } | null> {
  const key = company.trim().toLowerCase();
  const found = (await loadAllRuns())
    .filter((r) => r.companyBrief && r.synthesis?.job.company.trim().toLowerCase() === key)
    .map((r) => ({ brief: r.companyBrief!, at: r.companyResearchedAt ?? r.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  return found && Date.now() - Date.parse(found.at) < BRIEF_MAX_AGE_MS ? found : null;
}

export async function researchCompany(id: string): Promise<AsyncGenerator<RunEvent>> {
  const run = await loadRun(id);
  return guarded(run, async function* () {
    const s = run.synthesis;
    if (!s) throw new Error("Run the panel first.");
    const ctx = await candidateContext(run);
    const recent = await recentBrief(s.job.company);
    if (recent) {
      yield { type: "stage", stage: `Reusing the research on ${s.job.company} from ${recent.at.slice(0, 10)}` };
      run.companyBrief = recent.brief;
      run.companyResearchedAt = recent.at;
    } else {
      yield { type: "stage", stage: `Researching ${s.job.company} on the web` };
      run.companyBrief = await askResearch({
        system: RESEARCH_SYSTEM,
        prompt: `Company: ${s.job.company}\nRole: ${s.job.role}\n\n<job_posting>\n${run.jobText}\n</job_posting>`,
        tag: { runId: run.id, action: "company-research" },
      });
      run.companyResearchedAt = new Date().toISOString();
    }
    yield { type: "stage", stage: "Designing projects aimed at this company" };
    const { ideas } = await askStructured({
      system: COMPANY_IDEAS_SYSTEM,
      prompt: `${contextBlock(run, ctx, improvedText(run, ctx))}\n\n${mistakesBlock(s)}`,
      schema: Ideas,
      effort: "medium",
      tier: "writer", tag: { runId: run.id, action: "company-ideas" },
    });
    run.companyIdeas = ideas;
    await saveRun(run);
    yield { type: "company", brief: run.companyBrief, ideas };
    yield { type: "done", run };
  });
}

// The candidate describes a project (built or in progress); it is saved to the
// profile, and the resume is rebuilt with it.
export async function addProject(id: string, project: AddedProject): Promise<AsyncGenerator<RunEvent>> {
  const run = await loadRun(id);
  return guarded(run, async function* () {
    const s = run.synthesis;
    if (!s) throw new Error("Run the panel first.");
    await appendProfileSection("Projects added in the panel app", [
      `${project.name} (${project.status})${project.url ? `, ${project.url}` : ""}. Stack: ${project.stack}. ${project.details.replace(/\s+/g, " ").trim()}`,
    ]);
    const ctx = await candidateContext(run);
    yield { type: "stage", stage: `Rebuilding the resume with ${project.name}` };
    const rebuild = await askStructured({
      system: REBUILD_SYSTEM,
      prompt: `${contextBlock(run, ctx, improvedText(run, ctx))}\n\n${mistakesBlock(s)}\n\n<new_project>\nThe candidate just added this project. Include it in Projects, written from these details only.\nName: ${project.name}\nStatus: ${project.status}\nURL: ${project.url || "(none)"}\nStack: ${project.stack}\nDetails: ${project.details}\n</new_project>`,
      schema: Rebuild,
      effort: "medium",
      tier: "writer", tag: { runId: run.id, action: "add-project" },
    });
    s.resume = rebuild.resume;
    s.questions = rebuild.questions;
    yield { type: "synthesis", synthesis: s };
    yield* finish(run);
  });
}

export async function* chat(id: string, message: string): AsyncGenerator<{ type: "delta"; text: string } | { type: "error"; message: string } | { type: "done" }> {
  const run = await loadRun(id);
  try {
    const ctx = await candidateContext(run);
    const history = [...(run.chat ?? []), { role: "user" as const, text: message, at: new Date().toISOString() }];
    const stream = streamChat({
      system: CHAT_SYSTEM,
      context: contextBlock(run, ctx, improvedText(run, ctx)),
      turns: history,
      tag: { runId: run.id, action: "chat" },
    });
    let reply = "";
    for (;;) {
      const next = await stream.next();
      if (next.done) {
        reply = next.value;
        break;
      }
      yield { type: "delta", text: next.value };
    }
    run.chat = [...history, { role: "assistant", text: reply, at: new Date().toISOString() }];
    await saveRun(run);
    yield { type: "done" };
  } catch (err) {
    yield { type: "error", message: errorMessage(err) };
  }
}

// ---------- CV ----------

// Ranks the knowledge base against the posting so the candidate can choose
// what the CV adds. Kept on the run: the menu only changes when asked.
export async function cvOptions(id: string, refresh = false): Promise<CvOption[]> {
  const run = await loadRun(id);
  if (run.cvOptions && !refresh) return run.cvOptions;
  const items = knowledgeItems(await loadKnowledge());
  if (!items.length) return [];
  const { picks } = await askStructured({
    tier: "fast",
    system: CV_PICKS_SYSTEM,
    prompt: `<job_posting>\n${run.jobText}\n</job_posting>\n\n<items>\n${items.map((i) => `${i.id}: ${i.menu}`).join("\n")}\n</items>`,
    schema: CvPicks,
    effort: "low",
    tag: { runId: run.id, action: "cv-options" },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  run.cvOptions = picks.flatMap((p) => {
    const item = byId.get(p.id);
    if (!item || seen.has(p.id)) return [];
    seen.add(p.id);
    return [{ id: item.id, type: item.type, title: item.title, url: item.url, summary: item.summary, relevance: p.relevance, reason: p.reason }];
  });
  await saveRun(run);
  return run.cvOptions;
}

export async function createCv(id: string, picks: string[]): Promise<AsyncGenerator<RunEvent>> {
  const run = await loadRun(id);
  return guarded(run, async function* () {
    if (!run.synthesis) throw new Error("Finish the run before creating a CV.");
    const [profile, knowledge] = await Promise.all([readProfile(), loadKnowledge()]);
    const contact = parseContact(profile);
    const items = knowledgeItems(knowledge).filter((i) => picks.includes(i.id));
    const repos = items.filter((i) => i.type === "repo").map((i) => i.id);
    const pages = items.filter((i) => i.type === "page").map((i) => i.id);
    yield { type: "stage", stage: `Writing the CV with ${items.length} item${items.length === 1 ? "" : "s"} from your knowledge base` };
    const doc = await askStructured({
      system: CV_SYSTEM,
      prompt: [
        `<job_posting>\n${run.jobText}\n</job_posting>`,
        `<tailored_resume>\n${renderText(run.synthesis.resume, contact, false)}\n</tailored_resume>`,
        `<candidate_profile>\n${profile}\n</candidate_profile>`,
        `<selected_knowledge>\n${items.length ? knowledgeDigest(knowledge, repos, pages) : "(none selected)"}\n</selected_knowledge>`,
      ].join("\n\n"),
      schema: ResumeDoc,
      effort: "medium",
      tier: "writer",
      tag: { runId: run.id, action: "cv" },
    });
    yield { type: "stage", stage: "Compiling the CV" };
    const folder = run.pdf?.folder ?? run.outputFolder ?? outputFolder(run.synthesis, run.createdAt);
    run.cv = { ...(await compileFitted(doc, profile, folder, "CV")), picks: items.map((i) => i.id) };
    yield { type: "cv", cv: run.cv };
    run.error = undefined;
    await saveRun(run);
    yield { type: "done", run };
  });
}

// ---------- project interview ----------

const PROJECT_CHAT_SYSTEM = `You refine one project on a candidate's resume for one job posting by interviewing the candidate. Compare the project with the posting, the panel's mistakes and the knowledge base (the project's repo card, if it has one).

Ask one short, specific question per turn: the one whose answer would most improve this project's fit. Ask about what the candidate personally built, scale or measured results, or whether they used a skill or tool the posting names. Ask at most four questions in all; propose sooner if you have enough or the candidate asks. If the candidate gives an instruction instead of an answer, follow it.

Wording: rephrase facts the project, the resume, the profile or the knowledge base already show into the posting's vocabulary without asking (say "REST API" when the repo shows a REST API). A skill, tool, number or result none of those show goes in only if the candidate confirmed it in this conversation; otherwise ask. Never invent numbers or results. A profile answer of "none" means the candidate lacks that skill.

When ready, set ready to true and fill name, stack and url (keep the existing ones unless the candidate corrected them), 2-3 one-line bullets, strongest first, in the posting's vocabulary, and keywords: each posting keyword you added or brought forward, with basis "reworded" (from facts already shown) or "confirmed" (the candidate said so here). Use message to say in one or two sentences what changed. When not ready, leave name, stack, url, bullets and keywords empty and put the question in message.

keywords: only distinct terms the posting itself uses (tools, practices, domains), at most six; not generic words like "data" or "testing".

facts: only new facts about the candidate's work that they stated in their latest message (what they built, their role, scale, results, tools they used), as short standalone sentences that name the project. Never record remarks about the conversation, such as declining to answer or asking for a rewrite. Plain technical language; no filler or flattery.`;

const projectOf = (run: Run, name: string) => run.synthesis?.resume.projects.find((p) => p.name === name);

// One interview turn. With no message, the agent opens with its first question.
export async function projectChatTurn(id: string, project: string, message?: string): Promise<ProjectChat> {
  const run = await loadRun(id);
  const s = run.synthesis;
  const current = s && projectOf(run, project);
  if (!s || !current) throw new Error("That project is not on this run's resume.");
  const ctx = await candidateContext(run);
  const chat: ProjectChat = run.projectChats?.[project] ?? { turns: [], facts: [] };
  const turns = message ? [...chat.turns, { role: "user" as const, text: message, at: new Date().toISOString() }] : chat.turns;
  const transcript = turns.map((t) => `<${t.role}>\n${t.text}\n</${t.role}>`).join("\n");
  const entry = { ...current, bullets: current.bullets.map((b) => b.replace(NEEDS, "").trim()) };
  const turn = await askStructured({
    tier: "writer",
    system: PROJECT_CHAT_SYSTEM,
    // The run's material is the cached prefix, so each turn re-reads it at a tenth of the price.
    context: `${contextBlock(run, ctx, improvedText(run, ctx))}\n\n${mistakesBlock(s)}`,
    prompt: `<project>\n${JSON.stringify(entry)}\n</project>\n\n<conversation>\n${transcript || "(not started: open with your first question)"}\n</conversation>`,
    schema: ProjectTurn,
    effort: "medium",
    tag: { runId: run.id, action: "project-chat" },
  });
  const next: ProjectChat = {
    turns: [...turns, { role: "assistant", text: turn.message, at: new Date().toISOString() }],
    facts: [...chat.facts, ...turn.facts.map((f) => f.trim()).filter(Boolean)],
    proposal: turn.ready && turn.bullets.length ? { name: turn.name || current.name, stack: turn.stack || current.stack, url: turn.url || current.url, bullets: turn.bullets, keywords: turn.keywords } : undefined,
  };
  run.projectChats = { ...run.projectChats, [project]: next };
  await saveRun(run);
  return next;
}

export async function discardProjectChat(id: string, project: string): Promise<void> {
  const run = await loadRun(id);
  if (run.projectChats) delete run.projectChats[project];
  await saveRun(run);
}

// Accepts the proposal: the project is replaced, the facts go to the profile,
// and the PDF is recompiled and re-screened.
export async function applyProjectChat(id: string, project: string): Promise<AsyncGenerator<RunEvent>> {
  const run = await loadRun(id);
  return guarded(run, async function* () {
    const s = run.synthesis;
    const chat = run.projectChats?.[project];
    const index = s?.resume.projects.findIndex((p) => p.name === project) ?? -1;
    if (!s || index < 0 || !chat?.proposal) throw new Error("There is no proposal for that project to apply.");
    const { name, stack, url, bullets } = chat.proposal;
    s.resume.projects[index] = { name, stack, url, bullets };
    await appendProfileSection("Project details given in the panel app", chat.facts);
    delete run.projectChats![project];
    yield { type: "synthesis", synthesis: s };
    yield* finish(run);
  });
}

export async function clearChat(id: string): Promise<void> {
  const run = await loadRun(id);
  run.chat = [];
  await saveRun(run);
}

export const EMAIL_KINDS = {
  application: "An application email to the recruiter or hiring manager, sent with the resume.",
  referral: "A short cold message to an engineer at the company asking for a referral or a 15-minute chat.",
  "follow-up": "A follow-up a week after applying, adding one new proof point.",
  "thank-you": "A thank-you note after an interview, referencing what was discussed.",
} as const;

export async function draftEmail(id: string, kind: keyof typeof EMAIL_KINDS, notes: string): Promise<DraftedEmail> {
  const run = await loadRun(id);
  const ctx = await candidateContext(run);
  const email = await askStructured({
    tier: "writer",
    system: EMAIL_SYSTEM,
    context: contextBlock(run, ctx, improvedText(run, ctx)),
    prompt: `<email_type>${EMAIL_KINDS[kind]}</email_type>\n<candidate_notes>${notes || "(none)"}</candidate_notes>`,
    schema: Email,
    effort: "medium",
    tag: { runId: run.id, action: `email:${kind}` },
  });
  const drafted: DraftedEmail = { ...email, kind, createdAt: new Date().toISOString() };
  run.emails = [...(run.emails ?? []), drafted];
  await saveRun(run);
  return drafted;
}

const OUTREACH_SYSTEM = `You write a cold outreach sequence for a job candidate who wants this job. Startups, YC companies especially, hire through founders and engineers, so the sequence reaches a real person directly as well as applying.

Write 4 to 6 steps over about 10 days, mixing LinkedIn and email:
- day 0: a LinkedIn connection request (channel linkedin-connect), at most ${LIMITS["linkedin-connect"]} characters, no greeting fluff, naming one specific thing about their product.
- day 0 or 1: a cold email (at most ${LIMITS.emailWords} words) with one proof point from the candidate's real work that maps to the company's hardest problem, and a link to the most relevant repo or portfolio page.
- a LinkedIn message (at most ${LIMITS["linkedin-message"]} characters) if the connection is accepted.
- one or two follow-ups, each adding something new (a relevant repo, a short teardown idea of their product, a project built for them); never "just bumping this".
- a short final note that closes the loop politely.

Address founders by first name when the posting or research names them; otherwise use [Name]. ${FACT_RULES} Every message is first person and plain text, with no clichés ("I hope this finds you well", "passionate", "thrilled", "synergy") and no flattery. Put each message's send condition in sendIf.`;

function fitTo(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const sentence = head.match(/^[\s\S]*[.!?](?=\s|$)/)?.[0];
  if (sentence && sentence.length > limit * 0.6) return sentence.trim();
  return head.slice(0, head.lastIndexOf(" ")).replace(/[,;:\-–]+$/, "").trim();
}

export const OUTREACH_TARGETS = {
  founder: "a founder or CEO (best for startups under ~50 people)",
  engineer: "an engineer on the team this role joins, asking for a referral or a 15-minute chat",
  recruiter: "the recruiter or hiring manager for this role",
} as const;

export async function draftOutreach(id: string, target: keyof typeof OUTREACH_TARGETS, notes: string): Promise<DraftedSequence> {
  const run = await loadRun(id);
  const ctx = await candidateContext(run);
  const sequence = await askStructured({
    tier: "writer",
    system: OUTREACH_SYSTEM,
    context: contextBlock(run, ctx, improvedText(run, ctx)),
    prompt: `<target>${OUTREACH_TARGETS[target]}</target>\n<candidate_notes>${notes || "(none)"}</candidate_notes>`,
    schema: Sequence,
    effort: "medium",
    tag: { runId: run.id, action: `outreach:${target}` },
  });
  // Models overshoot character limits and LinkedIn rejects an over-long note.
  // Ask for a word budget (models count words, not characters), then cut to
  // the last whole sentence or word as a guarantee.
  for (const step of sequence.steps) {
    const limit = step.channel === "email" ? 0 : LIMITS[step.channel];
    if (!limit || step.body.length <= limit) continue;
    step.body = (
      await askText({
        tier: "fast",
        system: "You shorten LinkedIn messages. Keep the specific details, the first-person voice and the ask; cut greetings and filler. Return only the new message.",
        prompt: `Rewrite this in at most ${Math.floor(limit / 7.5)} words:\n\n${step.body}`,
        effort: "low",
        tag: { runId: run.id, action: "outreach:fit" },
      })
    ).trim();
    step.body = fitTo(step.body, limit);
  }
  const drafted: DraftedSequence = { ...sequence, target, createdAt: new Date().toISOString() };
  run.outreach = [...(run.outreach ?? []), drafted];
  await saveRun(run);
  return drafted;
}

// ---------- job details, board, autopilot ----------

const detailsSystem = (location: string) =>
  `Extract what a job candidate needs from a job posting. Copy facts as stated; leave a field empty rather than guess. Red flags are fit risks for a candidate based in ${location || "an unknown location"}: required work authorization elsewhere, onsite-only roles in another country without visa sponsorship, seniority far above the candidate's level.`;

async function extractDetails(jobText: string, runId: string): Promise<JobDetails | null> {
  try {
    const location = parseContact(await readProfile()).location;
    return await askStructured({ tier: "fast", system: detailsSystem(location), prompt: jobText, schema: JobDetails, effort: "low", tag: { runId, action: "details" } });
  } catch {
    return null; // details are a convenience; never fail the run on them
  }
}

export async function updateBoard(id: string, patch: { stage?: Stage; notes?: string; sent?: Partial<Record<Writeup, string | null>> }): Promise<Board> {
  const run = await loadRun(id);
  const board: Board = run.board ?? { stage: "To apply", movedAt: run.createdAt, notes: "", sent: {} };
  if (patch.stage && STAGES.includes(patch.stage) && patch.stage !== board.stage) {
    board.stage = patch.stage;
    board.movedAt = new Date().toISOString();
  }
  if (typeof patch.notes === "string") board.notes = patch.notes;
  for (const [k, v] of Object.entries(patch.sent ?? {})) {
    if (v) board.sent[k as Writeup] = v;
    else delete board.sent[k as Writeup];
  }
  run.board = board;
  await saveRun(run);
  return board;
}

export interface AutopilotInput {
  url?: string;
  jobText?: string;
  resumeFile: string;
  research: boolean;
  outreach: boolean;
}

// Paste a link, get everything: import, panel, rebuild and PDF, the email the
// posting asks for, and (if asked) company research and an outreach sequence.
export async function* autopilot(input: AutopilotInput): AsyncGenerator<RunEvent> {
  let jobText = input.jobText ?? "";
  let founders = 0;
  if (input.url) {
    yield { type: "stage", stage: "Importing the posting" };
    try {
      const job = await importJob(input.url);
      jobText = job.text;
      founders = job.founders.length;
      yield { type: "imported", folder: job.folder, title: job.title, company: job.company };
    } catch (err) {
      yield { type: "error", message: `Could not import ${input.url}: ${errorMessage(err)}` };
      return;
    }
  }
  if (!jobText.trim()) {
    yield { type: "error", message: "No job posting text." };
    return;
  }

  let runId = "";
  for await (const e of runPanel({ jobText, resumeFile: input.resumeFile })) {
    if (e.type === "started") runId = e.runId;
    if (e.type === "error") {
      yield e;
      return;
    }
    if (e.type !== "done") yield e;
  }

  const run = await loadRun(runId);
  const d = run.details;
  if (d && (d.applyEmail || d.emailAsk)) {
    yield { type: "stage", stage: `Drafting the email the posting asks for${d.applyEmail ? ` (to ${d.applyEmail})` : ""}` };
    const notes = [d.applyEmail && `Send to ${d.applyEmail}.`, d.emailAsk && `The posting asks the email to include: ${d.emailAsk}`].filter(Boolean).join(" ");
    yield { type: "email", email: await draftEmail(runId, "application", notes) };
  }
  if (input.research) {
    for await (const e of await researchCompany(runId)) if (e.type !== "done") yield e;
  }
  if (input.outreach) {
    const target = founders > 0 ? "founder" : "engineer";
    yield { type: "stage", stage: `Drafting an outreach sequence to the ${target}` };
    yield { type: "outreach", sequence: await draftOutreach(runId, target, "") };
  }
  yield { type: "done", run: await loadRun(runId) };
}
