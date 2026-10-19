"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectChat, ProjectProposal, Run } from "@/lib/pipeline";
import { NEEDS } from "@/lib/schemas";

type Project = NonNullable<Run["synthesis"]>["resume"]["projects"][number];

const send = (runId: string, method: "POST" | "DELETE", body: object) =>
  fetch(`/api/runs/${runId}/project-chat`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const clean = (b: string) => b.replace(NEEDS, "").trim();

// The Project interview tab: the projects the rebuild put on the resume on the
// left, and a chat with the agent about the selected one on the right.
export function ProjectInterviewTab({ run, busy, onApply }: { run: Run; busy: boolean; onApply: (project: string) => void }) {
  const projects = run.synthesis?.resume.projects ?? [];
  const [selected, setSelected] = useState<string>(() => Object.keys(run.projectChats ?? {})[0] ?? projects[0]?.name ?? "");
  // The list's badges follow the live chats, not only what the run loaded with.
  const [chats, setChats] = useState<Record<string, ProjectChat | undefined>>(() => ({ ...run.projectChats }));
  const track = (name: string) => (chat: ProjectChat | null) => setChats((c) => ({ ...c, [name]: chat ?? undefined }));
  const current = projects.find((p) => p.name === selected) ?? projects[0];

  if (!current) {
    return (
      <div className="card">
        <h2>Project interview</h2>
        <p className="mt-2 text-muted">This run&rsquo;s resume has no Projects section, so there is nothing to refine yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 min-[1100px]:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="card flex min-w-0 flex-col gap-3 p-4 min-[1100px]:sticky min-[1100px]:top-6">
        <div className="px-1">
          <h2>Projects on your resume</h2>
          <p className="mt-1 text-sm text-muted">Pick one to refine for this posting.</p>
        </div>
        <ul className="flex flex-col gap-2" role="listbox" aria-label="Projects">
          {projects.map((p) => {
            const chat = chats[p.name];
            const active = p.name === current.name;
            return (
              <li key={p.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelected(p.name)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary-tint" : "border-line hover:bg-surface-hover"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    {chat?.proposal ? (
                      <span className="badge badge--pass">proposal ready</span>
                    ) : chat ? (
                      <span className="badge badge--neutral">in progress</span>
                    ) : null}
                  </span>
                  {p.stack && <span className="mono mt-1 block truncate text-xs text-muted">{p.stack}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Keyed by the bullets too: after Apply rebuilds the project, the chat resets to the new version. */}
      <ProjectInterview
        key={`${current.name}:${current.bullets.join("|")}`}
        runId={run.id}
        project={current}
        initial={run.projectChats?.[current.name]}
        busy={busy}
        onChange={track(current.name)}
        onApply={() => onApply(current.name)}
      />
    </div>
  );
}

function ProjectInterview({
  runId,
  project,
  initial,
  busy,
  onChange,
  onApply,
}: {
  runId: string;
  project: Project;
  initial?: ProjectChat;
  busy: boolean;
  onChange: (chat: ProjectChat | null) => void;
  onApply: () => void;
}) {
  const [chat, setChat] = useState<ProjectChat | null>(initial ?? null);
  // Tell the project list when this chat starts, gets a proposal or resets.
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  });
  useEffect(() => {
    report.current(chat);
  }, [chat]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  async function turn(message?: string) {
    setThinking(true);
    setError("");
    if (message) setChat((c) => ({ turns: [...(c?.turns ?? []), { role: "user", text: message }], facts: c?.facts ?? [] }));
    try {
      const res = await send(runId, "POST", { project: project.name, message });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setChat(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setThinking(false);
    }
  }

  // Keep the latest message in view inside the chat window, not the page.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat, thinking]);

  async function discard() {
    await send(runId, "DELETE", { project: project.name });
    setChat(null);
    setError("");
  }

  const submit = () => {
    if (!draft.trim() || thinking) return;
    const m = draft.trim();
    setDraft("");
    turn(m);
  };

  const started = Boolean(chat?.turns.length);
  const locked = thinking || busy;

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label={`Interview about ${project.name}`}>
      <div className="card flex flex-col gap-4 p-0">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate">{project.name}</h2>
            {project.stack && <p className="mono mt-1 text-xs text-muted">{project.stack}</p>}
          </div>
          {started && (
            <button className="btn btn--ghost" disabled={locked} onClick={discard}>
              Start over
            </button>
          )}
        </header>

        <div ref={logRef} className="flex h-[min(56dvh,34rem)] flex-col gap-3 overflow-y-auto px-6" aria-live="polite">
          {!started && !thinking && (
            <div className="m-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
              <p className="text-muted">
                The agent compares this project with the posting and the panel&rsquo;s mistakes, then asks a few questions about what you built. It
                rewords bullets in the posting&rsquo;s words and asks before adding any new skill, tool or number.
              </p>
              <ul className="w-full list-disc space-y-1 pl-5 text-left text-sm">
                {project.bullets.map((b) => (
                  <li key={b}>{clean(b)}</li>
                ))}
              </ul>
              <button className="btn btn--accent" disabled={locked} onClick={() => turn()}>
                Start the interview
              </button>
            </div>
          )}
          {chat?.turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} className="hp-enter ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-primary-tint px-4 py-3 text-sm whitespace-pre-wrap">
                {t.text}
              </p>
            ) : (
              <div key={i} className="hp-enter flex max-w-[85%] items-start gap-3">
                <span className="brand-mark mt-1 shrink-0" aria-hidden />
                <p className="rounded-2xl rounded-tl-md border border-line bg-sunken px-4 py-3 text-sm whitespace-pre-wrap">{t.text}</p>
              </div>
            ),
          )}
          {thinking && (
            <div className="flex items-center gap-3">
              <span className="brand-mark shrink-0" aria-hidden />
              <p className="streaming text-sm text-muted">{started ? "Thinking…" : "Reading the project and the posting…"}</p>
            </div>
          )}
          <div className="h-1 shrink-0" />
        </div>

        {error && <p className="px-6 text-sm text-fail">{error}</p>}

        <div className="flex flex-col gap-3 border-t border-line-subtle px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`pc-${project.name}`}>
              Your answer
            </label>
            <textarea
              id={`pc-${project.name}`}
              className="textarea min-h-14 w-full"
              placeholder={started ? "Answer, or tell the agent what to change. ⌘ Enter sends." : "Start the interview, or give the agent an instruction first."}
              value={draft}
              disabled={locked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <button className="btn btn--primary sm:self-end" disabled={locked || !draft.trim()} onClick={submit}>
              Send
            </button>
          </div>
          {started && !chat?.proposal && (
            <button className="btn self-start" disabled={locked} onClick={() => turn("Propose the changes now with what you have.")}>
              Propose changes now
            </button>
          )}
        </div>
      </div>

      {chat?.proposal && (
        <Proposal
          before={project}
          after={chat.proposal}
          facts={chat.facts}
          action={
            <button className="btn btn--accent" disabled={locked} onClick={onApply}>
              {busy ? "Rebuilding the PDF…" : "Apply and rebuild the PDF"}
            </button>
          }
        />
      )}
    </section>
  );
}

// Old and new bullets side by side, with each added posting keyword lit.
function Proposal({ before, after, facts, action }: { before: Project; after: ProjectProposal; facts: string[]; action: React.ReactNode }) {
  return (
    <div className="card hp-enter flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>Proposed changes</h2>
        {action}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="card card--sunken p-4">
          <p className="mb-2 text-sm font-semibold text-muted">Now</p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            {before.bullets.map((b) => (
              <li key={b}>{clean(b)}</li>
            ))}
          </ul>
        </div>
        <div className="card card--sunken p-4">
          <p className="mb-2 text-sm font-semibold">Proposed</p>
          {after.stack !== before.stack && <p className="mono mb-2 text-xs">{after.stack}</p>}
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {after.bullets.map((b) => (
              <li key={b}>
                <Lit text={b} keywords={after.keywords.map((k) => k.keyword)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
      {after.keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Keywords added</span>
          {after.keywords.map((k) => (
            <span key={k.keyword} className={`badge ${k.basis === "confirmed" ? "badge--pass" : "badge--neutral"}`}>
              {k.keyword} · {k.basis === "confirmed" ? "you confirmed" : "reworded"}
            </span>
          ))}
        </div>
      )}
      {facts.length > 0 && (
        <details>
          <summary className="text-sm font-semibold">Facts saved to your profile when you apply ({facts.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-sm text-muted">Applying updates the resume, recompiles the PDF to one page and re-runs the automated screen.</p>
    </div>
  );
}

// "evaluation pipelines" should also light "evaluation pipeline", and
// "document parsing" should light "document-parsing".
const pattern = (keyword: string) =>
  keyword
    .trim()
    .replace(/s$/i, "")
    .split(/[\s-]+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s-]+") + "s?";

function Lit({ text, keywords }: { text: string; keywords: string[] }) {
  const terms = keywords.filter((k) => k.trim()).map(pattern);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="kw">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
