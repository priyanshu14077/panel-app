"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AddedProject, ChatTurn, DraftedEmail, DraftedSequence, Review, Run, RunEvent, Screen } from "@/lib/pipeline";
import type { CvOption, JobDetails, ProjectIdea, Synthesis } from "@/lib/schemas";
import type { GuardReport } from "@/lib/guardrails";
import type { AtsReport, Placement, TermResult } from "@/lib/ats";
import type { ResumeOption } from "@/lib/files";
import { readNdjson } from "@/lib/read-ndjson";
import { KnowledgePanel } from "@/app/knowledge-panel";
import { PdfFullScreen } from "./pdf-full-screen";
import { ProjectInterviewTab } from "./project-interview";
import { RUNS_CHANGED } from "@/app/nav";
import { CountUp } from "@/components/motion";
import { Card, Chevron, CopyButton, LimitMeter, Notice, PageHeader, Verdict, WithGaps, isWin, wordCount } from "@/app/ui";

interface Sources {
  resumes: ResumeOption[];
  jobs: { folder: string; text: string }[];
  hasProfile: boolean;
  hasKey: boolean;
}
type Tab = "resume" | "panel" | "interview" | "studio" | "qa" | "email";

const TABS: [Tab, string][] = [
  ["resume", "Resume"],
  ["panel", "Panel"],
  ["interview", "Project interview"],
  ["studio", "Project studio"],
  ["qa", "Application Q&A"],
  ["email", "Outreach & email"],
];
const isTab = (t: string | null): t is Tab => TABS.some(([id]) => id === t);
const NEEDS = /\[\[needs:([a-z0-9-]+)\]\]/;

const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

// useSearchParams needs a Suspense boundary to prerender.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const linked = params.get("run");
  const linkedTab = params.get("tab");

  const [sources, setSources] = useState<Sources | null>(null);
  const [run, setRun] = useState<Partial<Run> | null>(null);
  const [tab, setTab] = useState<Tab>("panel");
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [cvOpen, setCvOpen] = useState(false);
  // The run a stream is writing to, so opening another run mid-stream is safe.
  const streamId = useRef<string | null>(null);
  const shownId = useRef<string | undefined>(undefined);
  useEffect(() => {
    shownId.current = run?.id;
  }, [run?.id]);

  const refreshSources = useCallback(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((s: Sources) => setSources(s));
  }, []);
  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  // A link from the rail or the board: /?run=<id>&tab=qa
  useEffect(() => {
    if (!linked || linked === shownId.current) return;
    fetch(`/api/runs/${linked}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r: Run | null) => {
        if (!r) return;
        setRun(r);
        setError("");
        setCvOpen(false);
        setPdfVersion((v) => v + 1);
        setTab(isTab(linkedTab) ? linkedTab : r.synthesis ? "resume" : "panel");
      });
  }, [linked, linkedTab]);

  const patch = useCallback((f: (r: Partial<Run>) => Partial<Run>) => {
    setRun((r) => (r && (!r.id || !streamId.current || r.id === streamId.current) ? f(r) : r));
  }, []);

  const apply = useCallback(
    (e: RunEvent) => {
      switch (e.type) {
        case "started":
          streamId.current = e.runId;
          patch((r) => ({ ...r, id: e.runId }));
          router.replace(`/workspace?run=${e.runId}`);
          window.dispatchEvent(new Event(RUNS_CHANGED));
          break;
        case "stage":
          setStage(e.stage);
          break;
        case "review":
          patch((r) => ({ ...r, reviews: [...(r.reviews ?? []), e.review] }));
          break;
        case "synthesis":
          patch((r) => ({ ...r, synthesis: e.synthesis }));
          break;
        case "rescreen":
          patch((r) => ({ ...r, rescreens: [...(r.rescreens ?? []), e.screen] }));
          break;
        case "pdf":
          patch((r) => ({ ...r, pdf: e.pdf }));
          setPdfVersion((v) => v + 1);
          break;
        case "cv":
          patch((r) => ({ ...r, cv: e.cv }));
          setPdfVersion((v) => v + 1);
          break;
        case "ats":
          patch((r) => ({ ...r, ats: e.ats }));
          break;
        case "guard":
          patch((r) => ({ ...r, guard: { ...r.guard, [e.kind]: e.report } }));
          break;
        case "company":
          patch((r) => ({ ...r, companyBrief: e.brief, companyIdeas: e.ideas }));
          break;
        case "imported":
          break;
        case "details":
          patch((r) => ({ ...r, details: e.details }));
          break;
        case "email":
          patch((r) => ({ ...r, emails: [...(r.emails ?? []), e.email] }));
          break;
        case "outreach":
          patch((r) => ({ ...r, outreach: [...(r.outreach ?? []), e.sequence] }));
          break;
        case "error":
          setError(e.message);
          break;
        case "done":
          patch(() => e.run);
          setStage("");
          break;
      }
    },
    [patch, router],
  );

  const drive = useCallback(
    async (request: Promise<Response>, id?: string) => {
      streamId.current = id ?? null;
      setBusy(true);
      setError("");
      try {
        await readNdjson<RunEvent>(await request, apply);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        setStage("");
        streamId.current = null;
        refreshSources();
        window.dispatchEvent(new Event(RUNS_CHANGED));
      }
    },
    [apply, refreshSources],
  );

  function startRun(input: { url?: string; jobText?: string; resumeFile: string; research: boolean; outreach: boolean }) {
    setRun({ reviews: [], rescreens: [] });
    setTab("panel");
    drive(post("/api/autopilot", input));
  }

  function newRun() {
    setRun(null);
    setError("");
    router.push("/workspace");
  }

  // A run is on screen when the URL names it, or while a new one is starting
  // and has no id yet. "Workspace" in the rail goes back to the form.
  const showing = run && (run.id ? run.id === linked : busy) ? run : null;
  const ready = Boolean(showing?.id && showing.synthesis);
  const act = (path: string, body?: unknown) => drive(post(`/api/runs/${showing!.id}/${path}`, body), showing!.id);

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-8">
      {sources && !sources.hasKey && (
        <Notice tone="fail">
          No <code>ANTHROPIC_API_KEY</code>. Add it to <code>panel-app/.env.local</code> and restart <code>npm run dev</code>.
        </Notice>
      )}
      {sources && !sources.hasProfile && (
        <Notice tone="warn">
          No <code>resume/profile.md</code> found. The rebuild can only use facts from the resume itself.
        </Notice>
      )}

      {!showing && (
        <>
          <PageHeader title="New run">
            Pick a resume and a job. Seven reviewers judge it, then the app rebuilds it into a one-page PDF and puts the job on the Board.
          </PageHeader>
          {error && <Notice tone="fail">{error}</Notice>}
          <div className="grid items-start gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_360px]">
            <NewRun sources={sources} busy={busy} onStart={startRun} onError={setError} />
            <KnowledgePanel />
          </div>
        </>
      )}

      {showing && (
        <>
          <RunHeader
            run={showing}
            onNew={newRun}
            busy={busy}
            onCv={() => {
              setCvOpen(true);
              setTab("resume");
            }}
          />
          <StatStrip run={showing} busy={busy} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Run sections" className="segmented">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} disabled={id !== "panel" && !ready} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            {stage && (
              <p className="eyebrow streaming" aria-live="polite">
                {stage}
              </p>
            )}
          </div>
          {error && <Notice tone="fail">{error}</Notice>}

          {/* Keyed by tab so each switch fades the new panel in. */}
          <div key={tab} className="hp-fade flex flex-col gap-6">
            {ready && tab === "resume" && (
              <ResumeTab
                run={showing as Run}
                busy={busy}
                version={pdfVersion}
                cvOpen={cvOpen}
                onCloseCv={() => setCvOpen(false)}
                onBuildCv={(picks) => act("cv", { picks })}
                onAnswers={(answers) => act("answers", { answers })}
                onInterview={() => setTab("interview")}
              />
            )}
            {tab === "panel" && (
              <TwoColumn side={showing.details && <DetailsCard details={showing.details} />}>
                <Reviews reviews={showing.reviews ?? []} busy={busy && !showing.synthesis} rescreens={showing.rescreens ?? []} />
                {showing.synthesis && <Mistakes synthesis={showing.synthesis} />}
              </TwoColumn>
            )}

            {ready && tab === "interview" && (
              <ProjectInterviewTab run={showing as Run} busy={busy} onApply={(project) => act("project-chat/apply", { project })} />
            )}
            {ready && tab === "studio" && (
              <Studio
                run={showing as Run}
                busy={busy}
                pdfVersion={pdfVersion}
                onResearch={() => act("company")}
                onSuggest={() => act("ideas")}
                onAddProject={(p) => act("projects", p)}
              />
            )}
            {ready && tab === "qa" && (
              <TwoColumn side={showing.details && <DetailsCard details={showing.details} />}>
                <Chat key={showing.id} run={showing as Run} />
              </TwoColumn>
            )}
            {ready && tab === "email" && (
              <TwoColumn side={showing.details && <DetailsCard details={showing.details} />}>
                <Outreach key={`o-${showing.id}`} run={showing as Run} />
                <Emails key={showing.id} run={showing as Run} />
              </TwoColumn>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function TwoColumn({ children, side }: { children: React.ReactNode; side?: React.ReactNode }) {
  return (
    <div className="grid items-start gap-6 min-[1440px]:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      {side && <aside className="flex min-w-0 flex-col gap-6 min-[1440px]:sticky min-[1440px]:top-6">{side}</aside>}
    </div>
  );
}

// ---------- New run ----------

function NewRun({
  sources,
  busy,
  onStart,
  onError,
}: {
  sources: Sources | null;
  busy: boolean;
  onStart: (input: { url?: string; jobText?: string; resumeFile: string; research: boolean; outreach: boolean }) => void;
  onError: (message: string) => void;
}) {
  const [picked, setPicked] = useState("");
  const [jobText, setJobText] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState("");
  const [research, setResearch] = useState(false);
  const [outreach, setOutreach] = useState(false);
  const resumeFile = picked || sources?.resumes[0]?.id || "";

  async function importUrl() {
    setImporting(true);
    onError("");
    setImported("");
    try {
      const res = await post("/api/import-job", { url: jobUrl });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobText(data.text);
      setImported(
        `Imported ${data.title}${data.company ? ` at ${data.company}` : ""}${data.founders.length ? `, founders ${data.founders.map((f: { name: string }) => f.name).join(", ")}` : ""}. Saved to job descriptions/${data.folder}/.`,
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const groups: [string, ResumeOption[]][] = [
    ["Your resumes", sources?.resumes.filter((r) => r.group === "base") ?? []],
    ["Improved by the panel, newest first", sources?.resumes.filter((r) => r.group === "improved") ?? []],
  ];
  const label = jobText.trim() ? "Run everything" : jobUrl.trim() ? "Import the link and run everything" : "Run everything";

  return (
    <Card>
      <div className="flex flex-col gap-6">
        <fieldset className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <legend className="field-label mb-0">Resume to review</legend>
            {resumeFile && (
              <a className="link-btn text-sm" href={`/api/resumes/pdf?id=${encodeURIComponent(resumeFile)}`} target="_blank" rel="noreferrer">
                Preview the PDF
              </a>
            )}
          </div>
          <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
            {groups
              .filter(([, list]) => list.length)
              .map(([title, list]) => (
                <div key={title}>
                  <p className="field-hint mb-2">{title}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((r) => {
                      const selected = r.id === resumeFile;
                      return (
                        <label
                          key={r.id}
                          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${selected ? "border-primary bg-primary-tint text-primary-tint-text" : "border-line bg-surface hover:bg-surface-hover"}`}
                        >
                          <input type="radio" name="resume" value={r.id} checked={selected} onChange={() => setPicked(r.id)} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{r.label}</span>
                            {r.group === "improved" && (
                              <span className="block text-xs opacity-80">improved {new Date(r.updatedAt).toLocaleDateString()}</span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
          {resumeFile.startsWith("improved:") && (
            <p className="field-hint mt-2">
              Its rebuild replaces this PDF and keeps the old one in that folder&rsquo;s <code>archive/</code>. Grounding evals still check against
              your original resume.
            </p>
          )}
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block min-w-0">
            <span className="field-label">Job link</span>
            <span className="flex gap-2">
              <input
                className="input w-full min-w-0"
                placeholder="https://www.ycombinator.com/companies/…/jobs/…"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
              />
              <button className="btn" disabled={importing || !jobUrl.trim()} onClick={importUrl}>
                {importing ? "Importing…" : "Import"}
              </button>
            </span>
            <span className="field-hint mt-1 block">YC, Greenhouse, Lever, Ashby or any job page.</span>
          </label>
          {!!sources?.jobs.length && (
            <label className="block min-w-0">
              <span className="field-label">Or a saved posting</span>
              <select
                className="input w-full"
                defaultValue=""
                onChange={(e) => setJobText(sources.jobs.find((j) => j.folder === e.target.value)?.text ?? "")}
              >
                <option value="">Choose one</option>
                {sources.jobs.map((j) => (
                  <option key={j.folder}>{j.folder}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {imported && <p className="-mt-3 text-sm font-semibold text-pass">{imported}</p>}

        <label className="block">
          <span className="field-label">Job posting</span>
          <textarea
            className="textarea h-56 w-full"
            placeholder="Paste the full job description, or leave it empty to use the link"
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
          />
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-3">
            <input type="checkbox" className="mt-1" checked={research} onChange={(e) => setResearch(e.target.checked)} />
            <span>
              <span className="block text-sm font-semibold">Research the company</span>
              <span className="field-hint">Projects aimed at its product. About $0.20, free if researched this month.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-3">
            <input type="checkbox" className="mt-1" checked={outreach} onChange={(e) => setOutreach(e.target.checked)} />
            <span>
              <span className="block text-sm font-semibold">Draft outreach</span>
              <span className="field-hint">LinkedIn and email sequence to a founder. About $0.06.</span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <button
            className="btn btn--accent w-full"
            disabled={busy || !(jobText.trim() || jobUrl.trim()) || !resumeFile}
            onClick={() => onStart({ url: jobText.trim() ? undefined : jobUrl, jobText: jobText.trim() || undefined, resumeFile, research, outreach })}
          >
            {busy ? "A run is in progress…" : label}
          </button>
          <p className="field-hint">Panel, rebuild and PDF, plus the application email if the posting asks for one. About $0.19 and 1–2 minutes.</p>
        </div>
      </div>
    </Card>
  );
}

// ---------- Resume ----------

function ResumeTab({
  run,
  busy,
  version,
  cvOpen,
  onCloseCv,
  onBuildCv,
  onAnswers,
  onInterview,
}: {
  run: Run;
  busy: boolean;
  version: number;
  cvOpen: boolean;
  onCloseCv: () => void;
  onBuildCv: (picks: string[]) => void;
  onAnswers: (a: Record<string, string>) => void;
  onInterview: () => void;
}) {
  const [doc, setDoc] = useState<"resume" | "cv">(cvOpen && run.cv ? "cv" : "resume");
  const s = run.synthesis!;
  const showCv = doc === "cv" && run.cv;
  return (
    <div className="grid items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-3">
        {run.cv && (
          <div role="tablist" aria-label="Document" className="segmented self-start">
            <button role="tab" aria-selected={doc === "resume"} onClick={() => setDoc("resume")}>
              One-page resume
            </button>
            <button role="tab" aria-selected={doc === "cv"} onClick={() => setDoc("cv")}>
              Two-page CV
            </button>
          </div>
        )}
        {showCv ? <PdfPanel runId={run.id} pdf={run.cv!} version={version} cv /> : run.pdf && <PdfPanel runId={run.id} pdf={run.pdf} version={version} />}
      </div>
      <aside className="flex min-w-0 flex-col gap-6 min-[1100px]:sticky min-[1100px]:top-6">
        {cvOpen && <CvBuilder key={run.id} run={run} busy={busy} onBuild={onBuildCv} onClose={onCloseCv} />}
        {run.ats?.after && <AtsMatch before={run.ats.before} after={run.ats.after} />}
        <Checks report={run.guard?.[showCv ? "CV" : "Resume"]} />
        {s.questions.length > 0 && <Questions key={s.questions.map((q) => q.id).join()} synthesis={s} busy={busy} onSubmit={onAnswers} />}
        {s.resume.projects.length > 0 && (
          <Card sunken className="p-5">
            <h2>Sharpen a project</h2>
            <p className="mt-1 text-sm text-muted">The agent asks what you built and rewrites its bullets in the posting&rsquo;s words.</p>
            <button className="btn btn--primary mt-4" onClick={onInterview}>
              Open the project interview
            </button>
          </Card>
        )}
      </aside>
    </div>
  );
}

const PLACEMENTS: [Placement, string, string][] = [
  ["body", "Shown in use", "badge--pass"],
  ["skills", "Only in Skills", "badge--warn"],
  ["material", "You have it, the resume doesn't say so", "badge--accent"],
  ["absent", "Not in your material: answer a question or build it", "badge--neutral"],
];

// How the PDF matches the posting's terms, read the way a tracker reads it:
// parsed back to plain text.
function AtsMatch({ before, after }: { before?: AtsReport; after: AtsReport }) {
  const required = after.terms.filter((t) => t.required && t.kind !== "soft-skill");
  const covered = required.filter((t) => t.placement === "body" || t.placement === "skills").length;
  const tone = after.score >= 75 ? "badge--pass" : after.score >= 55 ? "badge--warn" : "badge--fail";
  const failed = after.checks.filter((c) => !c.pass);
  return (
    <Card title="ATS match" action={<span className={`badge ${tone}`}>{after.score >= 75 ? "strong" : after.score >= 55 ? "fair" : "weak"}</span>} className="p-5">
      <div className="flex items-baseline gap-3">
        {before && (
          <>
            <span className="mono text-lg text-muted">{before.score}%</span>
            <span className="verdict-arrow" aria-label="then">
              →
            </span>
          </>
        )}
        <span className="kpi-value">
          <CountUp to={after.score} duration={700} />%
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Posting terms found in the parsed PDF, required ones weighted three times. <span className="mono">{covered}</span> of{" "}
        <span className="mono">{required.length}</span> required terms are on the page.
      </p>
      {after.added.length > 0 && <p className="mt-2 text-sm">Added to Skills from your material: {after.added.join(", ")}.</p>}
      <div className="mt-4 flex flex-col gap-3">
        {PLACEMENTS.map(([placement, label, badge]) => {
          const terms = after.terms.filter((t) => t.placement === placement);
          if (!terms.length) return null;
          return (
            <div key={placement}>
              <p className="text-xs font-semibold text-muted">{label}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {terms.map((t) => (
                  <li key={t.term}>
                    <TermChip term={t} badge={badge} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <details className="mt-4 border-t border-line-subtle pt-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <Chevron />
          Format checks: {failed.length ? `${failed.length} to fix` : "all pass"}
        </summary>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {after.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className={`badge ${c.pass ? "badge--pass" : "badge--fail"}`}>{c.pass ? "pass" : "fix"}</span>
              <span>
                {c.name}
                <span className="block text-xs text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

function TermChip({ term: t, badge }: { term: TermResult; badge: string }) {
  const tip = [t.required ? "Required" : "Nice to have", t.aliases.length ? `also matches ${t.aliases.join(", ")}` : "", t.evidence ? `backed by: "${t.evidence}"` : "", t.count ? `${t.count}× on the page` : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`badge ${badge} whitespace-normal ${t.required ? "font-semibold" : ""}`} title={tip}>
      {t.term}
      {t.required && <span aria-label="required">*</span>}
    </span>
  );
}

// What the checks changed after the writer finished, and anything they could
// not fix.
function Checks({ report }: { report?: GuardReport & { at: string } }) {
  if (!report) return null;
  const changes = report.fixed.length + report.rewritten;
  return (
    <Card title="Checks" action={<span className={`badge ${report.remaining.length ? "badge--warn" : "badge--pass"}`}>{report.remaining.length ? `${report.remaining.length} to look at` : "all pass"}</span>} className="p-5">
      <p className="text-sm text-muted">
        Dates, links, line length, bracketed tool lists and filler.{" "}
        {changes ? (
          <>
            <span className="mono">{report.rewritten}</span> line{report.rewritten === 1 ? "" : "s"} tightened, <span className="mono">{report.fixed.length}</span> other fix
            {report.fixed.length === 1 ? "" : "es"}.
          </>
        ) : (
          "Nothing needed changing."
        )}
      </p>
      {report.fixed.length > 0 && (
        <details className="mt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Chevron />
            What changed
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {report.fixed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
      {report.remaining.length > 0 && (
        <ul className="mt-3 flex flex-col gap-3">
          {report.remaining.map((i) => (
            <li key={i.id} className="text-sm">
              <p className="mistake__quote break-words">{i.text.replace(NEEDS, "").trim()}</p>
              <p className="mt-1 text-muted">{i.problems.join("; ")}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- Run header ----------

function RunHeader({ run, onNew, onCv, busy }: { run: Partial<Run>; onNew: () => void; onCv: () => void; busy: boolean }) {
  const job = run.synthesis?.job ?? run.details;
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate">{job?.company || (busy ? "Reading the posting" : "Run")}</h1>
        <p className="mt-1 text-muted">
          {job?.role}
          {run.createdAt && <span> · run {new Date(run.createdAt).toLocaleString()}</span>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {run.pdf && run.id && (
          <a className="btn" href={`/api/runs/${run.id}/pdf?download`}>
            Download PDF
          </a>
        )}
        {run.cv && run.id && (
          <a className="btn" href={`/api/runs/${run.id}/pdf?cv&download`}>
            Download CV
          </a>
        )}
        {run.pdf && run.synthesis && (
          <button className="btn btn--primary" disabled={busy} onClick={onCv}>
            {run.cv ? "Rebuild CV" : "Create CV"}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={onNew}>
          New run
        </button>
      </div>
    </header>
  );
}

// The run at a glance. The screen's before and after leads: it is the one
// number the whole app exists to move.
function StatStrip({ run, busy }: { run: Partial<Run>; busy: boolean }) {
  const reviews = run.reviews ?? [];
  const before = reviews.find((r) => r.id === "screen");
  const after = run.rescreens?.at(-1);
  const readers = reviews.filter((r) => r.id !== "screen");
  const yes = readers.filter((r) => isWin(r.verdict, true)).length;
  const s = run.synthesis;
  const held = s ? s.questions.length : null;
  return (
    <section aria-label="Run summary" className="card grid gap-0 p-0 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <Stat label="Automated screen">
        <div className="flex flex-wrap items-center gap-3">
          <Verdict verdict={before?.verdict} pending={!before && busy} />
          <span className="verdict-arrow text-xl" aria-label="then">
            →
          </span>
          {after ? <Verdict verdict={after.verdict} /> : <span className={`verdict verdict--pending ${busy ? "streaming" : ""}`}>{busy ? "AFTER REBUILD" : "NOT RUN"}</span>}
        </div>
        {run.ats?.after && (
          <p className="mono mt-2 text-xs text-muted">
            Keyword match {run.ats.before ? `${run.ats.before.score}% → ` : ""}
            {run.ats.after.score}%
          </p>
        )}
      </Stat>
      <Stat label="Readers who would advance it">
        <p className="kpi-value">
          <CountUp to={yes} duration={700} />
          <span className="text-lg text-muted"> / {readers.length || 6}</span>
        </p>
        <div className="mt-2 flex gap-1" aria-hidden>
          {readers.map((r) => (
            <span key={r.id} className={`hp-enter h-1.5 w-5 rounded-full ${isWin(r.verdict, true) ? "verdict--pass" : "verdict--reject"}`} />
          ))}
        </div>
      </Stat>
      <Stat label="Mistakes found">
        <p className="kpi-value">{s ? <CountUp to={s.mistakes.length} duration={700} /> : "–"}</p>
      </Stat>
      <Stat label="Open questions">
        <p className="kpi-value">{held === null ? "–" : <CountUp to={held} duration={700} />}</p>
        {held ? <p className="text-xs text-accent-text">lines held back from the PDF</p> : null}
      </Stat>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 border-line p-5 [&:not(:first-child)]:border-t sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(even)]:border-l xl:[&:not(:first-child)]:border-t-0 xl:[&:not(:first-child)]:border-l">
      <p className="kpi-label">{label}</p>
      <div>{children}</div>
    </div>
  );
}

// ---------- The panel ----------

function Reviews({ reviews, busy, rescreens }: { reviews: Review[]; busy: boolean; rescreens: Screen[] }) {
  const pending = busy ? Math.max(0, 7 - reviews.length) : 0;
  const latest = rescreens.at(-1);
  return (
    <Card title="The panel" action={<span className="mono text-sm text-muted">{reviews.length} / 7 in</span>} className="p-5">
      <ul aria-live="polite" className="flex flex-col divide-y divide-line-subtle">
        {reviews.map((r) => (
          <li key={r.id}>
            <details className="reviewer-row py-3">
              <summary className="grid cursor-pointer grid-cols-[minmax(0,11rem)_auto_minmax(0,1fr)_auto] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <span className="reviewer__role truncate">{r.name}</span>
                <Verdict verdict={r.verdict} reader={r.id !== "screen"} />
                <span className="truncate text-sm text-muted max-sm:hidden">{firstLine(r.text)}</span>
                <Chevron />
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{r.text}</p>
            </details>
          </li>
        ))}
        {Array.from({ length: pending }, (_, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,11rem)_auto] items-center gap-3 py-3">
            <span className="reviewer__role">Reviewer {reviews.length + i + 1}</span>
            <Verdict pending />
          </li>
        ))}
      </ul>
      {latest && (
        <details className="mt-3 border-t border-line-subtle pt-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Chevron />
            Why the re-screen gave <Verdict verdict={latest.verdict} />
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{latest.text}</p>
        </details>
      )}
    </Card>
  );
}

// The first sentence after the verdict line, as a preview on a closed card.
function firstLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const body = lines.find((l) => !/^\**\s*verdict/i.test(l) && l.length > 30) ?? lines[0] ?? "";
  return body.replace(/[*#>]/g, "").trim();
}

const MISTAKES_SHOWN = 5;

function Mistakes({ synthesis }: { synthesis: Synthesis }) {
  const [all, setAll] = useState(false);
  const n = synthesis.mistakes.length;
  const shown = all ? synthesis.mistakes : synthesis.mistakes.slice(0, MISTAKES_SHOWN);
  // The list is ranked worst first; the top third is high severity.
  const severity = (i: number) => (i < Math.ceil(n / 3) ? "mistake--high" : i < Math.ceil((2 * n) / 3) ? "" : "mistake--low");
  return (
    <Card title={`What is wrong, worst first`} action={<span className="mono text-sm text-muted">{n} found</span>}>
      <ol className="flex flex-col gap-5">
        {shown.map((m, i) => (
          <li key={i} className={`mistake ${severity(i)}`} style={{ "--i": i } as React.CSSProperties}>
            <span className="mistake__bar" aria-hidden />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="mistake__quote break-words">{m.quote}</p>
              <p className="text-sm">{m.why}</p>
              <p className="flagged-by">Flagged by {m.flaggedBy}</p>
            </div>
          </li>
        ))}
      </ol>
      {n > MISTAKES_SHOWN && (
        <button type="button" className="link-btn mt-4 text-sm" onClick={() => setAll((v) => !v)}>
          {all ? "Show the worst five" : `Show all ${n}`}
        </button>
      )}
    </Card>
  );
}

function IdeaGrid({ title, ideas, onUse }: { title: string; ideas: ProjectIdea[]; onUse?: (p: ProjectIdea) => void }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2>{title}</h2>
        <p className="mt-1 text-sm text-muted">Build one, then add it in Project studio. It goes on the resume once you have given its real details.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {ideas.map((p, i) => (
          <details key={p.title} className="card hp-enter p-5" style={{ "--i": i } as React.CSSProperties}>
            <summary className="flex flex-col gap-3">
              <span className="flex items-start justify-between gap-3">
                <h3 className="text-lg">{p.title}</h3>
                <Chevron />
              </span>
              <span className="text-sm text-muted">{p.scope}</span>
              <span className="flex flex-wrap gap-2">
                <span className="badge badge--accent whitespace-normal">Closes: {p.closesGap}</span>
                {p.extends && <span className="badge badge--neutral mono">extends {p.extends}</span>}
              </span>
              <span className="text-sm">{p.pitch}</span>
            </summary>
            <div className="mt-4 flex flex-col gap-3 border-t border-line-subtle pt-4 text-sm">
              {p.companyAngle && (
                <p>
                  <span className="font-semibold">Company angle.</span> {p.companyAngle}
                </p>
              )}
              <p>
                <span className="font-semibold">Stack.</span> {p.stack.join(", ")}
              </p>
              <p>
                <span className="font-semibold">Keywords it earns.</span> {p.keywords.join(", ")}
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                {p.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <p className="mistake__quote">{p.bulletOnceBuilt}</p>
              {onUse && (
                <button className="btn self-start" onClick={() => onUse(p)}>
                  I built this: add its details
                </button>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Questions({ synthesis, busy, onSubmit }: { synthesis: Synthesis; busy: boolean; onSubmit: (a: Record<string, string>) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const filled = Object.values(answers).filter((a) => a.trim()).length;
  const lines = [...synthesis.resume.summary, ...synthesis.resume.experience.flatMap((x) => x.bullets), ...synthesis.resume.projects.flatMap((p) => p.bullets)];
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2>Questions to answer</h2>
        <p className="mt-1 text-sm text-muted">
          Lines that need these facts are held back from the PDF. Answers are saved to <code>resume/profile.md</code> and reused on every run.
          Write &ldquo;none&rdquo; if you don&rsquo;t have it.
        </p>
      </div>
      {synthesis.questions.map((q) => {
        const waiting = lines.filter((l) => l.match(NEEDS)?.[1] === q.id);
        const answer = answers[q.id]?.trim() ?? "";
        const none = /^(none|no|skip)$/i.test(answer);
        return (
          <Card key={q.id}>
            <label htmlFor={`q-${q.id}`} className="block text-md font-semibold">
              {q.question}
            </label>
            <p className="mt-1 text-sm text-muted">{q.why}</p>
            {waiting.map((l) => (
              <p key={l} className={`mt-3 text-sm ${none ? "text-disabled line-through" : ""}`}>
                {l.replace(NEEDS, "").trim()}{" "}
                <span className={answer && !none ? "badge badge--pass" : "heldback"}>{answer && !none ? "answered" : "needs your answer"}</span>
              </p>
            ))}
            {waiting.length > 0 && (
              <p className="unlocks mt-2">
                Unlocks {waiting.length} line{waiting.length === 1 ? "" : "s"}
              </p>
            )}
            <textarea
              id={`q-${q.id}`}
              className="textarea mt-3 min-h-20 w-full"
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            />
          </Card>
        );
      })}
      <button className="btn btn--primary self-start" disabled={busy || filled === 0} onClick={() => onSubmit(answers)}>
        {busy ? "Updating…" : `Update the resume with ${filled} answer${filled === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}

function PdfPanel({ runId, pdf, version, cv = false }: { runId: string; pdf: NonNullable<Run["pdf"]>; version: number; cv?: boolean }) {
  const src = `/api/runs/${runId}/pdf?v=${version}${cv ? "&cv" : ""}`;
  const title = cv ? "CV" : "Improved resume";
  const pages = pdf.check.pages;
  const [full, setFull] = useState(false);
  const close = useCallback(() => setFull(false), []);
  return (
    <Card
      title={title}
      action={
        <span className="flex items-center gap-3">
          <a className="link-btn text-sm" href={src} target="_blank" rel="noreferrer">
            Open
          </a>
          <button type="button" className="btn" onClick={() => setFull(true)}>
            Full screen
          </button>
        </span>
      }
      className="p-5"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <span className={`badge ${pages >= 1 && pages <= (cv ? 2 : 1) ? "badge--pass" : "badge--fail"}`}>
          {pages} page{pages === 1 ? "" : "s"}
        </span>
        <span className={`badge ${pdf.check.placeholders.length ? "badge--fail" : "badge--pass"}`}>{pdf.check.placeholders.length} placeholders</span>
        <span className="badge badge--neutral">{pdf.check.links.length} links</span>
      </div>
      <iframe key={src} src={src} title={`${title} PDF`} className="h-[min(78dvh,60rem)] w-full rounded-md border border-line bg-sunken" />
      {full && <PdfFullScreen src={src} title={title} onClose={close} />}
      <p className="mono mt-3 truncate text-xs text-muted" title={`improved resume/${pdf.folder}/`}>
        improved resume/{pdf.folder}/
      </p>
    </Card>
  );
}

const RELEVANCE_BADGE: Record<CvOption["relevance"], string> = { high: "badge--pass", medium: "badge--warn", low: "badge--neutral" };

// Before a CV is written, the knowledge base ranked against the posting: the
// candidate ticks what goes in. Strong matches start ticked.
function CvBuilder({
  run,
  busy,
  onBuild,
  onClose,
}: {
  run: Run;
  busy: boolean;
  onBuild: (picks: string[]) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<CvOption[] | null>(run.cvOptions ?? null);
  const [picked, setPicked] = useState<Set<string>>(() => defaultPicks(run, run.cvOptions));
  const [loading, setLoading] = useState(!run.cvOptions);
  const [error, setError] = useState("");

  const fetchOptions = useCallback(
    (refresh: boolean) => {
      post(`/api/runs/${run.id}/cv/options`, { refresh })
        .then(async (res) => {
          const body = (await res.json()) as { options?: CvOption[]; error?: string };
          if (!res.ok || !body.options) throw new Error(body.error ?? "Could not rank the knowledge base.");
          setOptions(body.options);
          setPicked(defaultPicks(run, body.options));
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    },
    [run],
  );
  function rankAgain() {
    setLoading(true);
    setError("");
    fetchOptions(true);
  }
  // Ranks once when the builder opens; "Rank again" asks for a fresh list.
  useEffect(() => {
    if (!run.cvOptions) fetchOptions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
      <Card
        title="Create a CV"
        action={
          <span className="flex items-center gap-3">
            <button type="button" className="link-btn text-sm" disabled={loading || busy} onClick={rankAgain}>
              Rank again
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
          </span>
        }
        className="p-5"
      >
        <p className="text-sm text-muted">
          A CV of up to two pages, built from this resume plus what you tick below. Items are ranked against the posting; strong matches start ticked.
        </p>
        {error && (
          <div className="mt-4">
            <Notice tone="fail">{error}</Notice>
          </div>
        )}
        {loading && <p className="eyebrow streaming mt-4">Ranking your knowledge base against the posting</p>}
        {!loading && options?.length === 0 && (
          <p className="mt-4 text-sm text-muted">Nothing in the knowledge base fits this posting. The CV will expand on the resume alone.</p>
        )}
        {!loading && options && options.length > 0 && (
          <ul className="mt-4 space-y-1">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-hover">
                  <input type="checkbox" className="mt-1" checked={picked.has(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                  <span className="min-w-0 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <a href={o.url} target="_blank" rel="noreferrer" className="truncate font-semibold">
                        {o.title}
                      </a>
                      <span className={`badge ${RELEVANCE_BADGE[o.relevance]}`}>{o.relevance}</span>
                      <span className="badge badge--neutral">{o.type === "repo" ? "repo" : "portfolio"}</span>
                    </span>
                    <span className="mt-0.5 block">{o.reason}</span>
                    <span className="mt-0.5 block text-xs text-muted">{o.summary}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn btn--primary" disabled={busy || loading || !options} onClick={() => onBuild([...picked])}>
            {busy ? "Writing the CV…" : `Build CV with ${picked.size} item${picked.size === 1 ? "" : "s"}`}
          </button>
          {options && options.length > 0 && (
            <>
              <button type="button" className="link-btn text-sm" disabled={busy} onClick={() => setPicked(new Set(options.map((o) => o.id)))}>
                Tick all
              </button>
              <button type="button" className="link-btn text-sm" disabled={busy} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      </Card>
  );
}

// The last CV's picks when there is one, otherwise every strong match.
function defaultPicks(run: Run, options?: CvOption[] | null): Set<string> {
  const ids = new Set((options ?? []).map((o) => o.id));
  if (run.cv) return new Set(run.cv.picks.filter((id) => ids.has(id)));
  return new Set((options ?? []).filter((o) => o.relevance === "high").map((o) => o.id));
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
  ];
  return (
    <Card title="The job" className="p-5">
      {d.redFlags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {d.redFlags.map((f) => (
            <span key={f} className="badge badge--warn whitespace-normal">
              Fit risk: {f}
            </span>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
      </dl>
      {d.formQuestions.length > 0 && (
        <div className="mt-4 border-t border-line-subtle pt-4">
          <p className="mb-2 text-sm font-semibold">Form questions</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {d.formQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
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
  onSuggest,
  onAddProject,
}: {
  run: Run;
  busy: boolean;
  pdfVersion: number;
  onResearch: () => void;
  onSuggest: () => void;
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
    <TwoColumn side={run.pdf && <PdfPanel runId={run.id} pdf={run.pdf} version={pdfVersion} />}>
      <Card
        sunken
        title={`Projects aimed at ${company}`}
        action={
          <button className="btn btn--accent" disabled={busy} onClick={onResearch}>
            {busy ? "Working…" : run.companyIdeas ? "Research again" : `Research ${company}`}
          </button>
        }
      >
        {!run.companyBrief && (
          <p className="text-sm text-muted">
            Searches the web for {company}&rsquo;s product, customers, integrations and stack, then designs short projects that mirror them and close
            the panel&rsquo;s gaps.
          </p>
        )}
        {run.companyBrief && (
          <details>
            <summary className="flex items-center gap-2 text-sm font-semibold">
              <Chevron />
              What the research found
            </summary>
            <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
              <Linked text={run.companyBrief} />
            </div>
          </details>
        )}
      </Card>
      {run.companyIdeas && <IdeaGrid title="Ideas aimed at the company" ideas={run.companyIdeas} onUse={applyIdea} />}
      {run.synthesis!.projects.length > 0 ? (
        <IdeaGrid title="Ideas that close the panel's gaps" ideas={run.synthesis!.projects} onUse={applyIdea} />
      ) : (
        <Card
          title="Projects that close the panel's gaps"
          action={
            <button className="btn" disabled={busy} onClick={onSuggest}>
              {busy ? "Working…" : "Suggest projects"}
            </button>
          }
        >
          <p className="text-sm text-muted">Short builds aimed at what the panel found missing, often extending a repo you already have. Written when you ask, so runs you don&rsquo;t pursue cost less.</p>
        </Card>
      )}

      <div ref={formRef}>
        <Card title="Add a project you built">
          <p className="-mt-2 mb-4 text-sm text-muted">
            Give the real details. The project is saved to your profile and the resume is rebuilt with it. In-progress work is labelled as such.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Name</span>
              <input className="input w-full" value={project.name} onChange={set("name")} />
            </label>
            <label className="block">
              <span className="field-label">Repo or demo URL</span>
              <input className="input w-full" value={project.url} onChange={set("url")} placeholder="https://github.com/…" />
            </label>
            <label className="block">
              <span className="field-label">Stack</span>
              <input className="input w-full" value={project.stack} onChange={set("stack")} />
            </label>
            <label className="block">
              <span className="field-label">Status</span>
              <select className="input w-full" value={project.status} onChange={set("status")}>
                <option value="built">Built</option>
                <option value="in progress">In progress</option>
              </select>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="field-label">What you built, how, and the numbers you measured</span>
            <textarea className="textarea h-40 w-full" value={project.details} onChange={set("details")} />
          </label>
          <button
            className="btn btn--primary mt-4"
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
    </TwoColumn>
  );
}

// Research briefs cite plain URLs; make them links.
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

// ---------- Application Q&A ----------

// "(150 words)", "max 1000 characters": the limit a form question states.
function limitOf(question: string): { limit: number; unit: "words" | "chars" } | null {
  const m = question.match(/(\d{2,5})\s*(words?|characters?|chars?)/i);
  if (!m) return null;
  return { limit: Number(m[1]), unit: /^w/i.test(m[2]) ? "words" : "chars" };
}

function Chat({ run }: { run: Run }) {
  const company = run.synthesis!.job.company;
  const [turns, setTurns] = useState<ChatTurn[]>(run.chat ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  // Braces matter: scrollIntoView returns a Promise in current Chrome, and an
  // effect may only return a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

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
      const res = await post(`/api/runs/${run.id}/chat`, { message });
      await readNdjson<{ type: string; text?: string; message?: string }>(res, (e) => {
        if (e.type === "delta") setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: t[t.length - 1].text + e.text }]);
        if (e.type === "error") setError(e.message ?? "The answer failed. Try sending it again.");
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
          <button className="btn btn--ghost" disabled={busy} onClick={clear}>
            Clear the chat
          </button>
        )
      }
    >
      <p className="-mt-2 mb-4 text-sm text-muted">
        Paste a question from the application form, with its word limit if it has one. Answers use only your resume, profile, repos and portfolio.
        Gaps show as <span className="heldback">[brackets]</span> for you to fill.
      </p>
      {turns.length === 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {starters.map((s) => (
            <button key={s} className="btn h-auto justify-start py-2 text-left font-medium whitespace-normal" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex max-h-[38rem] flex-col gap-3 overflow-y-auto">
        {turns.map((t, i) => {
          const question = t.role === "assistant" ? turns[i - 1]?.text ?? "" : "";
          const limit = limitOf(question);
          const done = t.text && !(busy && i === turns.length - 1);
          return t.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-sunken px-4 py-3 text-sm whitespace-pre-wrap">
              {t.text}
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-line bg-surface px-4 py-3">
              <p className={`text-sm leading-relaxed whitespace-pre-wrap ${!t.text ? "streaming text-muted" : ""}`}>
                {t.text ? <WithGaps text={t.text} /> : "Writing…"}
              </p>
              {done && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  {limit ? (
                    <LimitMeter used={limit.unit === "words" ? wordCount(t.text) : t.text.length} limit={limit.limit} unit={limit.unit} />
                  ) : (
                    <span className="mono text-xs text-muted">{wordCount(t.text)} words</span>
                  )}
                  <CopyButton text={t.text} />
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {error && <p className="mt-3 text-sm text-fail">{error}</p>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="chat-draft">
          Your question
        </label>
        <textarea
          id="chat-draft"
          className="textarea min-h-20 w-full"
          placeholder="Paste a form question, or ask to shorten or adjust the last answer. ⌘ Enter sends."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(draft);
          }}
        />
        <button className="btn btn--accent sm:self-end" disabled={busy || !draft.trim()} onClick={() => send(draft)}>
          {busy ? "Writing…" : "Send"}
        </button>
      </div>
    </Card>
  );
}

// ---------- Email ----------

const EMAIL_LABELS: Record<string, string> = {
  application: "Application",
  referral: "Referral request",
  "follow-up": "Follow-up",
  "thank-you": "Thank-you",
};
const EMAIL_WORDS = 170;

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
      const res = await post(`/api/runs/${run.id}/email`, { kind, notes });
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
    <section className="flex flex-col gap-4">
      <Card title="Emails">
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Email type" className="segmented self-start">
            {Object.entries(EMAIL_LABELS).map(([k, v]) => (
              <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {v}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="field-label">Notes</span>
            <input
              className="input w-full"
              placeholder="Recipient, what the posting asks the email to cover, what was discussed"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button className="btn btn--primary self-start" disabled={busy} onClick={draft}>
            {busy ? "Drafting…" : `Draft the ${EMAIL_LABELS[kind].toLowerCase()} email`}
          </button>
          {error && <p className="text-sm text-fail">{error}</p>}
        </div>
      </Card>
      {[...emails].reverse().map((e) => (
        <Card key={e.createdAt} className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="badge badge--primary">{EMAIL_LABELS[e.kind] ?? e.kind}</span>
            <span className="mono text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-3 font-semibold">{e.subject}</p>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{e.body}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <LimitMeter used={wordCount(e.body)} limit={EMAIL_WORDS} unit="words" />
            <span className="flex gap-1">
              <CopyButton text={`Subject: ${e.subject}\n\n${e.body}`} />
              <a className="btn btn--ghost" href={`mailto:?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`}>
                Open in mail
              </a>
            </span>
          </div>
        </Card>
      ))}
    </section>
  );
}

// ---------- Outreach sequence ----------

const CHANNEL_LABELS: Record<string, string> = {
  "linkedin-connect": "LinkedIn connection note",
  "linkedin-message": "LinkedIn message",
  email: "Email",
};
const CHANNEL_LIMITS: Record<string, number> = { "linkedin-connect": 200, "linkedin-message": 600 };
const OUTREACH_EMAIL_WORDS = 130;
const TARGETS: [string, string][] = [
  ["founder", "Founder"],
  ["engineer", "Engineer"],
  ["recruiter", "Recruiter"],
];

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
      const res = await post(`/api/runs/${run.id}/outreach`, { target, notes });
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
    <section className="flex flex-col gap-4">
      <Card title="Outreach sequence">
        <p className="-mt-2 mb-4 text-sm text-muted">
          A 10-day LinkedIn and email sequence to a real person at the company, alongside the application. Run the company research first for
          sharper messages.
        </p>
        <div className="flex flex-col gap-4">
          <div role="group" aria-label="Who to reach" className="segmented self-start">
            {TARGETS.map(([k, v]) => (
              <button key={k} aria-pressed={target === k} onClick={() => setTarget(k)}>
                {v}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="field-label">Notes</span>
            <input className="input w-full" placeholder="A name, a mutual connection, a project you built for them" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="btn btn--accent self-start" disabled={busy} onClick={draft}>
            {busy ? "Drafting…" : sequences.length ? "Draft another sequence" : "Draft the sequence"}
          </button>
          {error && <p className="text-sm text-fail">{error}</p>}
        </div>
      </Card>
      {latest && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2>To the {latest.target}</h2>
            <span className="mono text-xs text-muted">{new Date(latest.createdAt).toLocaleString()}</span>
          </div>
          <ol className="flex flex-col gap-4">
            {latest.steps.map((s, i) => {
              const limit = CHANNEL_LIMITS[s.channel];
              return (
                <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-3">
                  <span className="eyebrow pt-5">Day {s.day}</span>
                  <div className="card min-w-0 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge badge--neutral">{CHANNEL_LABELS[s.channel] ?? s.channel}</span>
                      <span className="text-sm text-muted">to {s.recipient}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">Send if {s.sendIf.replace(/^if\s+/i, "")}</p>
                    {s.subject && <p className="mt-3 font-semibold">{s.subject}</p>}
                    <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{s.body}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      {limit ? (
                        <LimitMeter used={s.body.length} limit={limit} unit="chars" />
                      ) : (
                        <LimitMeter used={wordCount(s.body)} limit={OUTREACH_EMAIL_WORDS} unit="words" />
                      )}
                      <CopyButton text={s.subject ? `Subject: ${s.subject}\n\n${s.body}` : s.body} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
