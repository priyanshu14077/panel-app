"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AddedProject, ChatTurn, DraftedEmail, DraftedSequence, Review, Run, RunEvent, Screen } from "@/lib/pipeline";
import type { JobDetails, ProjectIdea, Synthesis } from "@/lib/schemas";
import { readNdjson } from "@/lib/read-ndjson";
import { KnowledgePanel } from "./knowledge-panel";

interface Sources {
  resumes: string[];
  jobs: { folder: string; text: string }[];
  hasProfile: boolean;
  hasKey: boolean;
}
type RunSummary = Pick<Run, "id" | "createdAt" | "synthesis" | "pdf">;
type Tab = "panel" | "studio" | "qa" | "email";

const REVIEWER_ORDER = ["Automated screen", "Hiring manager (interview call)", "Hiring manager (day one)", "Another applicant", "CEO", "Recruiter (30 seconds)", "Teammate"];
const NEEDS = /\[\[needs:([a-z0-9-]+)\]\]/;

function verdictTone(v: string): string {
  if (["PASS", "HIRE", "INTERVIEW"].includes(v)) return "text-good border-good";
  if (v === "MAYBE") return "text-warn border-warn";
  return "text-bad border-bad";
}

// The screen's PASS is good news; a reader's PASS means "no". Label them apart.
function verdictLabel(review: Pick<Review, "id" | "verdict">): { text: string; tone: string } {
  if (review.id !== "screen" && review.verdict === "PASS") return { text: "PASS (no)", tone: verdictTone("NO") };
  return { text: review.verdict, tone: verdictTone(review.verdict) };
}

const input = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm";
const primary = "rounded-md bg-accent px-3 py-2 text-sm font-medium text-background disabled:opacity-50";
const secondary = "rounded-md border border-border px-2 py-1 text-xs font-medium disabled:opacity-50";

export default function Home() {
  const [sources, setSources] = useState<Sources | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [resumeFile, setResumeFile] = useState("");
  const [jobText, setJobText] = useState("");
  const [run, setRun] = useState<Partial<Run> | null>(null);
  const [tab, setTab] = useState<Tab>("panel");
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [jobUrl, setJobUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState("");
  const [withResearch, setWithResearch] = useState(false);
  const [withOutreach, setWithOutreach] = useState(false);

  const refreshRuns = useCallback(() => {
    fetch("/api/runs").then((r) => r.json()).then(setRuns);
  }, []);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((s: Sources) => {
        setSources(s);
        setResumeFile((f) => f || s.resumes[0] || "");
      });
    refreshRuns();
    // Deep link from the board: /?run=<id>&tab=qa
    const q = new URLSearchParams(window.location.search);
    const linked = q.get("run");
    if (linked) {
      fetch(`/api/runs/${linked}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((r) => {
          if (!r) return;
          setRun(r);
          setPdfVersion((v) => v + 1);
          const tabParam = q.get("tab");
          if (tabParam === "studio" || tabParam === "qa" || tabParam === "email") setTab(tabParam);
        });
    }
  }, [refreshRuns]);

  const apply = useCallback((e: RunEvent) => {
    switch (e.type) {
      case "started":
        setRun((r) => ({ ...r, id: e.runId }));
        break;
      case "stage":
        setStage(e.stage);
        break;
      case "review":
        setRun((r) => ({ ...r, reviews: [...(r?.reviews ?? []), e.review] }));
        break;
      case "synthesis":
        setRun((r) => ({ ...r, synthesis: e.synthesis }));
        break;
      case "rescreen":
        setRun((r) => ({ ...r, rescreens: [...(r?.rescreens ?? []), e.screen] }));
        break;
      case "pdf":
        setRun((r) => ({ ...r, pdf: e.pdf }));
        setPdfVersion((v) => v + 1);
        break;
      case "company":
        setRun((r) => ({ ...r, companyBrief: e.brief, companyIdeas: e.ideas }));
        break;
      case "imported":
        setImported(`Imported ${e.title}${e.company ? ` at ${e.company}` : ""}. Saved to job descriptions/${e.folder}/.`);
        break;
      case "details":
        setRun((r) => ({ ...r, details: e.details }));
        break;
      case "email":
        setRun((r) => ({ ...r, emails: [...(r?.emails ?? []), e.email] }));
        break;
      case "outreach":
        setRun((r) => ({ ...r, outreach: [...(r?.outreach ?? []), e.sequence] }));
        break;
      case "error":
        setError(e.message);
        break;
      case "done":
        setRun(e.run);
        setStage("");
        break;
    }
  }, []);

  const drive = useCallback(
    async (request: Promise<Response>) => {
      setBusy(true);
      setError("");
      try {
        await readNdjson<RunEvent>(await request, apply);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setStage("");
        refreshRuns();
      }
    },
    [apply, refreshRuns],
  );

  const post = (url: string, body?: unknown) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

  // With only a link filled in, the server imports it first.
  function startRun() {
    setRun({ reviews: [], rescreens: [] });
    setTab("panel");
    setImported("");
    drive(
      post("/api/autopilot", {
        url: jobText.trim() ? undefined : jobUrl,
        jobText: jobText.trim() ? jobText : undefined,
        resumeFile,
        research: withResearch,
        outreach: withOutreach,
      }),
    );
  }

  async function openRun(id: string) {
    setError("");
    setStage("");
    setRun(await (await fetch(`/api/runs/${id}`)).json());
    setPdfVersion((v) => v + 1);
  }

  async function importUrl() {
    setImporting(true);
    setError("");
    setImported("");
    try {
      const res = await post("/api/import-job", { url: jobUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobText(data.text);
      setImported(
        `Imported ${data.title}${data.company ? ` at ${data.company}` : ""}${data.founders.length ? ` · founders: ${data.founders.map((f: { name: string }) => f.name).join(", ")}` : ""}. Saved to job descriptions/${data.folder}/.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const ready = Boolean(run?.id && run.synthesis);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Hiring Panel</h1>
        <p className="mt-1 text-sm text-muted">
          Paste a job posting. Seven reviewers judge your resume against it; then rebuild it, design projects aimed at the company, answer the
          application form and draft the emails.
        </p>
      </header>

      {sources && !sources.hasKey && (
        <Notice tone="bad">
          No <code>ANTHROPIC_API_KEY</code>. Add it to <code>panel-app/.env.local</code> and restart <code>npm run dev</code>.
        </Notice>
      )}
      {sources && !sources.hasProfile && (
        <Notice tone="warn">
          No <code>resume/profile.md</code> found. The rebuild can only use facts from the resume itself.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <aside className="space-y-6">
          <Card title="New run">
            <label className="block text-xs font-medium text-muted">Base resume</label>
            <select className={`mt-1 ${input}`} value={resumeFile} onChange={(e) => setResumeFile(e.target.value)}>
              {sources?.resumes.map((r) => <option key={r}>{r}</option>)}
            </select>
            {!!sources?.jobs.length && (
              <>
                <label className="mt-4 block text-xs font-medium text-muted">Saved job posting</label>
                <select
                  className={`mt-1 ${input}`}
                  defaultValue=""
                  onChange={(e) => setJobText(sources.jobs.find((j) => j.folder === e.target.value)?.text ?? "")}
                >
                  <option value="">Paste one below instead</option>
                  {sources.jobs.map((j) => <option key={j.folder}>{j.folder}</option>)}
                </select>
              </>
            )}
            <label className="mt-4 block text-xs font-medium text-muted">Job link (YC, Greenhouse, Lever, Ashby, any job page)</label>
            <div className="mt-1 flex gap-2">
              <input
                className={input}
                placeholder="https://www.ycombinator.com/companies/…/jobs/…"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
              />
              <button className={secondary} disabled={importing || !jobUrl.trim()} onClick={importUrl}>
                {importing ? "…" : "Import"}
              </button>
            </div>
            {imported && <p className="mt-1 text-xs text-good">{imported}</p>}

            <label className="mt-4 block text-xs font-medium text-muted">Job posting</label>
            <textarea
              className={`mt-1 h-56 resize-y font-mono text-xs ${input}`}
              placeholder="Paste the full job description"
              value={jobText}
              onChange={(e) => setJobText(e.target.value)}
            />
            <div className="mt-3 space-y-1 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={withResearch} onChange={(e) => setWithResearch(e.target.checked)} />
                Research the company and suggest projects aimed at it (+ about $0.15)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={withOutreach} onChange={(e) => setWithOutreach(e.target.checked)} />
                Draft a LinkedIn + email outreach sequence (+ about $0.05)
              </label>
            </div>
            <button className={`mt-3 w-full ${primary}`} disabled={busy || !(jobText.trim() || jobUrl.trim()) || !resumeFile} onClick={startRun}>
              {busy ? "Working…" : jobText.trim() ? "Run everything" : jobUrl.trim() ? "Import the link and run everything" : "Run everything"}
            </button>
            <p className="mt-2 text-xs text-muted">
              Panel, rebuild and PDF, plus the application email if the posting asks for one. About $0.20 and 1–2 minutes on the balanced profile. The
              job lands on the Board.
            </p>
          </Card>

          <KnowledgePanel />

          <Card title="Past runs">
            {runs.length === 0 && <p className="text-sm text-muted">None yet.</p>}
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r.id}>
                  <button className="w-full rounded px-2 py-1 text-left text-sm hover:bg-background" onClick={() => openRun(r.id)}>
                    <span className="font-medium">{r.synthesis ? `${r.synthesis.job.company} · ${r.synthesis.job.role}` : `${r.id} (failed)`}</span>
                    <span className="block text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        <section className="min-w-0 space-y-6">
          {run && (
            <nav className="flex flex-wrap gap-1 border-b border-border">
              {(
                [
                  ["panel", "Panel"],
                  ["studio", "Project studio"],
                  ["qa", "Application Q&A"],
                  ["email", "Outreach & email"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  disabled={id !== "panel" && !ready}
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm disabled:opacity-40 ${tab === id ? "border-accent font-medium" : "border-transparent text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
          )}
          {stage && <p className="animate-pulse text-sm text-muted">{stage}…</p>}
          {error && <Notice tone="bad">{error}</Notice>}
          {!run && <EmptyState />}

          {run && tab === "panel" && (
            <>
              <Reviews reviews={run.reviews ?? []} busy={busy && !run.synthesis} />
              {run.details && <DetailsCard details={run.details} />}
              {run.synthesis && (
                <>
                  <ScreenSummary before={run.reviews?.find((r) => r.id === "screen")} after={run.rescreens ?? []} />
                  <Mistakes synthesis={run.synthesis} />
                  <Ideas title="Projects to build" ideas={run.synthesis.projects} />
                  {run.synthesis.questions.length > 0 && (
                    <Questions
                      key={run.synthesis.questions.map((q) => q.id).join()}
                      synthesis={run.synthesis}
                      busy={busy}
                      onSubmit={(answers) => drive(post(`/api/runs/${run.id}/answers`, { answers }))}
                    />
                  )}
                </>
              )}
              {run.pdf && run.id && <PdfPanel runId={run.id} pdf={run.pdf} version={pdfVersion} />}
            </>
          )}

          {run?.id && run.synthesis && tab === "studio" && (
            <Studio
              run={run as Run}
              busy={busy}
              pdfVersion={pdfVersion}
              onResearch={() => drive(post(`/api/runs/${run.id}/company`))}
              onAddProject={(p) => drive(post(`/api/runs/${run.id}/projects`, p))}
            />
          )}
          {run?.id && run.synthesis && tab === "qa" && <Chat key={run.id} run={run as Run} />}
          {run?.id && run.synthesis && tab === "email" && (
            <>
              <Outreach key={`o-${run.id}`} run={run as Run} />
              <Emails key={run.id} run={run as Run} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Notice({ tone, children }: { tone: "bad" | "warn"; children: React.ReactNode }) {
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${tone === "bad" ? "border-bad text-bad" : "border-warn text-warn"}`}>{children}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={secondary}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
      Pick a resume, paste a job posting, and run the panel. Results stream in here as each reviewer finishes.
    </div>
  );
}

function Reviews({ reviews, busy }: { reviews: Review[]; busy: boolean }) {
  const sorted = [...reviews].sort((a, b) => REVIEWER_ORDER.indexOf(a.name) - REVIEWER_ORDER.indexOf(b.name));
  const waiting = busy ? REVIEWER_ORDER.filter((n) => !reviews.some((r) => r.name === n)) : [];
  return (
    <Card title={`The panel (${reviews.length}/7)`}>
      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((r) => {
          const v = verdictLabel(r);
          return (
            <details key={r.id} className="rounded-md border border-border p-3">
              <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${v.tone}`}>{v.text}</span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{r.text}</pre>
            </details>
          );
        })}
        {waiting.map((n) => (
          <div key={n} className="animate-pulse rounded-md border border-dashed border-border p-3 text-sm text-muted">
            {n}: reading…
          </div>
        ))}
      </div>
    </Card>
  );
}

function ScreenSummary({ before, after }: { before?: Review; after: Screen[] }) {
  if (!before) return null;
  return (
    <Card title="Automated screen, before and after">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${verdictTone(before.verdict)}`}>Before: {before.verdict}</span>
        {after.map((s, i) => (
          <span key={i} className={`rounded border px-1.5 py-0.5 text-xs font-semibold ${verdictTone(s.verdict)}`}>
            After{after.length > 1 ? ` #${i + 1}` : ""}: {s.verdict}
          </span>
        ))}
      </div>
      {after.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted">Why (latest re-screen)</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{after[after.length - 1].text}</pre>
        </details>
      )}
    </Card>
  );
}

function Mistakes({ synthesis }: { synthesis: Synthesis }) {
  return (
    <Card title={`What is wrong, worst first (${synthesis.mistakes.length})`}>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {synthesis.mistakes.map((m, i) => (
          <li key={i}>
            <span className="font-medium">{m.quote}</span> <span className="text-muted">{m.why}</span>
            <span className="block text-xs text-muted">Flagged by: {m.flaggedBy}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Ideas({ title, ideas, onUse }: { title: string; ideas: ProjectIdea[]; onUse?: (p: ProjectIdea) => void }) {
  return (
    <Card title={title}>
      <p className="mb-3 text-xs text-muted">Build one, then add it in Project studio. It goes on the resume once you have given its real details.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {ideas.map((p) => (
          <details key={p.title} className="rounded-md border border-border p-3">
            <summary className="cursor-pointer">
              <span className="text-sm font-medium">{p.title}</span>
              <span className="ml-2 text-xs text-muted">{p.scope}</span>
              {p.extends && <span className="mt-1 block text-xs text-accent">Extends {p.extends}</span>}
              <p className="mt-1 text-xs text-muted">{p.pitch}</p>
            </summary>
            <div className="mt-3 space-y-2 text-xs">
              {p.companyAngle && (
                <p>
                  <span className="font-medium">Company angle:</span> {p.companyAngle}
                </p>
              )}
              <p>
                <span className="font-medium">Closes:</span> {p.closesGap}
              </p>
              <p>
                <span className="font-medium">Stack:</span> {p.stack.join(", ")}
              </p>
              <p>
                <span className="font-medium">Keywords it earns:</span> {p.keywords.join(", ")}
              </p>
              <ol className="list-decimal space-y-1 pl-4">
                {p.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="rounded bg-background p-2">
                <span className="font-medium">Bullet, once built:</span> {p.bulletOnceBuilt}
              </p>
              {onUse && (
                <button className={secondary} onClick={() => onUse(p)}>
                  I built this: add its details
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

function Questions({ synthesis, busy, onSubmit }: { synthesis: Synthesis; busy: boolean; onSubmit: (a: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const filled = Object.values(answers).filter((a) => a.trim()).length;
  const waiting = (id: string) =>
    [...synthesis.resume.experience.flatMap((x) => x.bullets), ...synthesis.resume.projects.flatMap((p) => p.bullets), ...synthesis.resume.summary].filter(
      (l) => l.match(NEEDS)?.[1] === id,
    ).length;
  return (
    <Card title={`Questions to answer (${synthesis.questions.length})`}>
      <p className="mb-3 text-xs text-muted">
        Lines that need these facts are left out of the PDF. Answers are saved to <code>resume/profile.md</code> and reused on every run. Write
        &ldquo;none&rdquo; if you don&rsquo;t have it.
      </p>
      <div className="space-y-4">
        {synthesis.questions.map((q) => (
          <div key={q.id}>
            <label className="block text-sm font-medium">{q.question}</label>
            <p className="text-xs text-muted">
              {q.why}
              {waiting(q.id) > 0 && ` · unlocks ${waiting(q.id)} line${waiting(q.id) === 1 ? "" : "s"}`}
            </p>
            <textarea
              className={`mt-1 h-16 resize-y ${input}`}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <button className={`mt-3 ${primary}`} disabled={busy || filled === 0} onClick={() => onSubmit(answers)}>
        {busy ? "Updating…" : `Update the resume with ${filled} answer${filled === 1 ? "" : "s"}`}
      </button>
    </Card>
  );
}

function PdfPanel({ runId, pdf, version }: { runId: string; pdf: NonNullable<Run["pdf"]>; version: number }) {
  const src = `/api/runs/${runId}/pdf?v=${version}`;
  const ok = pdf.check.pages === 1 && pdf.check.placeholders.length === 0;
  return (
    <Card
      title="Improved resume"
      action={
        <a className={secondary} href={`${src}&download`}>
          Download PDF
        </a>
      }
    >
      <p className={`mb-3 text-xs ${ok ? "text-good" : "text-bad"}`}>
        {pdf.check.pages} page{pdf.check.pages === 1 ? "" : "s"} · {pdf.check.placeholders.length} placeholders · {pdf.check.links.length} links · saved
        to <code>improved resume/{pdf.folder}/</code>
      </p>
      <iframe key={src} src={src} title="Resume PDF" className="h-[60rem] w-full rounded-md border border-border bg-white" />
    </Card>
  );
}

// ---------- Project studio ----------

const emptyProject: AddedProject = { name: "", url: "", status: "built", stack: "", details: "" };

function Studio({
  run,
  busy,
  pdfVersion,
  onResearch,
  onAddProject,
}: {
  run: Run;
  busy: boolean;
  pdfVersion: number;
  onResearch: () => void;
  onAddProject: (p: AddedProject) => void;
}) {
  const [project, setProject] = useState<AddedProject>(emptyProject);
  const formRef = useRef<HTMLDivElement>(null);
  const company = run.synthesis!.job.company;
  const set = (k: keyof AddedProject) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setProject((p) => ({ ...p, [k]: e.target.value }));

  function applyIdea(idea: ProjectIdea) {
    setProject({
      name: idea.title,
      url: idea.extends ? `https://github.com/${idea.extends}` : "",
      status: "built",
      stack: idea.stack.join(", "),
      details: `What I built, how, and what I measured (replace this with the real details):\n${idea.steps.map((s) => `- ${s}`).join("\n")}`,
    });
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <>
      <Card
        title={`Projects aimed at ${company}`}
        action={
          <button className={secondary} disabled={busy} onClick={onResearch}>
            {busy ? "Working…" : run.companyIdeas ? "Research again" : `Research ${company}`}
          </button>
        }
      >
        {!run.companyIdeas && (
          <p className="text-sm text-muted">
            Searches the web for {company}&rsquo;s product, customers, integrations and stack, then designs short projects that mirror them and close
            the panel&rsquo;s gaps.
          </p>
        )}
        {run.companyBrief && (
          <details>
            <summary className="cursor-pointer text-xs text-muted">What the research found</summary>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">{run.companyBrief}</pre>
          </details>
        )}
      </Card>
      {run.companyIdeas && <Ideas title="Company-tailored project ideas" ideas={run.companyIdeas} onUse={applyIdea} />}
      <Ideas title="Gap-closing project ideas" ideas={run.synthesis!.projects} onUse={applyIdea} />

      <div ref={formRef}>
        <Card title="Add a project you built">
          <p className="mb-3 text-xs text-muted">
            Give the real details. The project is saved to your profile and the resume is rebuilt with it. In-progress work is labelled as such.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted">
              Name
              <input className={`mt-1 ${input}`} value={project.name} onChange={set("name")} />
            </label>
            <label className="text-xs font-medium text-muted">
              Repo or demo URL
              <input className={`mt-1 ${input}`} value={project.url} onChange={set("url")} placeholder="https://github.com/…" />
            </label>
            <label className="text-xs font-medium text-muted">
              Stack
              <input className={`mt-1 ${input}`} value={project.stack} onChange={set("stack")} />
            </label>
            <label className="text-xs font-medium text-muted">
              Status
              <select className={`mt-1 ${input}`} value={project.status} onChange={set("status")}>
                <option value="built">Built</option>
                <option value="in progress">In progress</option>
              </select>
            </label>
          </div>
          <label className="mt-3 block text-xs font-medium text-muted">
            What you built, how, and the numbers you measured
            <textarea className={`mt-1 h-40 resize-y ${input}`} value={project.details} onChange={set("details")} />
          </label>
          <button
            className={`mt-3 ${primary}`}
            disabled={busy || !project.name.trim() || !project.details.trim()}
            onClick={() => {
              onAddProject(project);
              setProject(emptyProject);
            }}
          >
            {busy ? "Rebuilding…" : "Add it and rebuild the resume"}
          </button>
        </Card>
      </div>
      {run.pdf && <PdfPanel runId={run.id} pdf={run.pdf} version={pdfVersion} />}
    </>
  );
}

// ---------- Application Q&A ----------

function Chat({ run }: { run: Run }) {
  const company = run.synthesis!.job.company;
  const [turns, setTurns] = useState<ChatTurn[]>(run.chat ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [turns]);

  const starters = [
    ...(run.details?.formQuestions ?? []),
    `Why do you want to work at ${company}? (150 words)`,
    "Tell us about the toughest technical problem you've solved.",
    "What is one project that best represents your engineering ability, and why?",
    "Describe a time you worked with a non-technical stakeholder or client.",
  ];

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    setTurns((t) => [...t, { role: "user", text: message }, { role: "assistant", text: "" }]);
    try {
      const res = await fetch(`/api/runs/${run.id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
      await readNdjson<{ type: string; text?: string; message?: string }>(res, (e) => {
        if (e.type === "delta") setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: t[t.length - 1].text + e.text }]);
        if (e.type === "error") setError(e.message ?? "error");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    await fetch(`/api/runs/${run.id}/chat`, { method: "DELETE" });
    setTurns([]);
  }

  return (
    <Card
      title="Application Q&A"
      action={
        turns.length > 0 && (
          <button className={secondary} disabled={busy} onClick={clear}>
            Clear
          </button>
        )
      }
    >
      <p className="mb-3 text-xs text-muted">
        Paste a question from the application form, with its word limit if it has one. Answers use only your resume, profile, repos and portfolio. Gaps
        show as [brackets] for you to fill.
      </p>
      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button key={s} className={secondary} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[38rem] space-y-3 overflow-auto">
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-auto max-w-[85%] rounded-md bg-background p-3 text-sm" : "rounded-md border border-border p-3 text-sm"}>
            <p className="whitespace-pre-wrap leading-relaxed">{t.text || (busy ? "…" : "")}</p>
            {t.role === "assistant" && t.text && !(busy && i === turns.length - 1) && (
              <div className="mt-2 flex items-center gap-2">
                <CopyButton text={t.text} />
                <span className="text-xs text-muted">{t.text.trim().split(/\s+/).length} words</span>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      <div className="mt-3 flex gap-2">
        <textarea
          className={`h-20 resize-y ${input}`}
          placeholder="Paste a form question, or ask to shorten / adjust the last answer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
          }}
        />
        <button className={`self-end ${primary}`} disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          Send
        </button>
      </div>
    </Card>
  );
}

// ---------- Email ----------

const EMAIL_LABELS: Record<string, string> = {
  application: "Application email",
  referral: "Referral request",
  "follow-up": "Follow-up",
  "thank-you": "Post-interview thank-you",
};

function Emails({ run }: { run: Run }) {
  const [emails, setEmails] = useState<DraftedEmail[]>(run.emails ?? []);
  const [kind, setKind] = useState("application");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/runs/${run.id}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, notes }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setEmails((e) => [...e, data]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Draft an email">
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <label className="text-xs font-medium text-muted">
            Type
            <select className={`mt-1 ${input}`} value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(EMAIL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Notes (recipient, what the posting asks the email to cover, what was discussed)
            <input className={`mt-1 ${input}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button className={`mt-3 ${primary}`} disabled={busy} onClick={draft}>
          {busy ? "Drafting…" : "Draft it"}
        </button>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </Card>
      {[...emails].reverse().map((e) => (
        <Card
          key={e.createdAt}
          title={`${EMAIL_LABELS[e.kind] ?? e.kind} · ${new Date(e.createdAt).toLocaleString()}`}
          action={
            <div className="flex gap-2">
              <CopyButton text={`Subject: ${e.subject}\n\n${e.body}`} />
              <a className={secondary} href={`mailto:?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`}>
                Open in mail
              </a>
            </div>
          }
        >
          <p className="text-sm font-medium">Subject: {e.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{e.body}</p>
          <p className="mt-2 text-xs text-muted">{e.body.trim().split(/\s+/).length} words</p>
        </Card>
      ))}
    </>
  );
}

// ---------- Outreach sequence ----------

const CHANNEL_LABELS: Record<string, string> = {
  "linkedin-connect": "LinkedIn connection note",
  "linkedin-message": "LinkedIn message",
  email: "Email",
};
const CHANNEL_LIMITS: Record<string, number> = { "linkedin-connect": 200, "linkedin-message": 600 };

function Outreach({ run }: { run: Run }) {
  const [sequences, setSequences] = useState<DraftedSequence[]>(run.outreach ?? []);
  const [target, setTarget] = useState("founder");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = sequences.at(-1);

  async function draft() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/runs/${run.id}/outreach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, notes }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSequences((s) => [...s, data]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Outreach sequence: LinkedIn + cold email">
        <p className="mb-3 text-xs text-muted">
          A 10-day sequence to a real person at the company, alongside the application. Founder names come from YC job imports or company research
          (Project studio); run the research first for sharper messages.
        </p>
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <label className="text-xs font-medium text-muted">
            Who to reach
            <select className={`mt-1 ${input}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="founder">Founder / CEO</option>
              <option value="engineer">Engineer on the team</option>
              <option value="recruiter">Recruiter / hiring manager</option>
            </select>
          </label>
          <label className="text-xs font-medium text-muted">
            Notes (a name, a mutual connection, a project you built for them)
            <input className={`mt-1 ${input}`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button className={`mt-3 ${primary}`} disabled={busy} onClick={draft}>
          {busy ? "Drafting…" : sequences.length ? "Draft another sequence" : "Draft the sequence"}
        </button>
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </Card>
      {latest && (
        <Card title={`Sequence to the ${latest.target} · ${new Date(latest.createdAt).toLocaleString()}`}>
          <ol className="relative space-y-4 border-l border-border pl-5">
            {latest.steps.map((s, i) => {
              const limit = CHANNEL_LIMITS[s.channel];
              const size = limit ? `${s.body.length}/${limit} chars` : `${s.body.trim().split(/\s+/).length} words`;
              const over = limit ? s.body.length > limit : false;
              return (
                <li key={i}>
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border bg-surface" />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">Day {s.day}</span>
                    <span className="rounded border border-border px-1.5 py-0.5">{CHANNEL_LABELS[s.channel] ?? s.channel}</span>
                    <span className="text-muted">to {s.recipient}</span>
                    <span className="text-muted">· {s.sendIf}</span>
                    <span className={`ml-auto ${over ? "text-bad" : "text-muted"}`}>{size}</span>
                    <CopyButton text={s.subject ? `Subject: ${s.subject}\n\n${s.body}` : s.body} />
                  </div>
                  {s.subject && <p className="mt-1 text-sm font-medium">Subject: {s.subject}</p>}
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </>
  );
}

function DetailsCard({ details: d }: { details: JobDetails }) {
  const rows: [string, string][] = [
    ["Location", d.location],
    ["Salary", d.salary],
    ["Experience", d.experience],
    ["How to apply", d.howToApply],
    ["Email it asks for", d.emailAsk],
    ["Stack", d.stack.join(", ")],
    ["Must have", d.mustHave.join("; ")],
    ["Nice to have", d.niceToHave.join("; ")],
    ["Form questions", d.formQuestions.join(" | ")],
  ];
  return (
    <Card title={`${d.company} · ${d.role}`}>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-xs">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {d.redFlags.length > 0 && <p className="mt-2 text-xs text-warn">Fit risks: {d.redFlags.join("; ")}</p>}
    </Card>
  );
}
