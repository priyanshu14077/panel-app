"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DraftedEmail, DraftedSequence, Run } from "@/lib/pipeline";
import { Chevron, CopyButton, PageHeader, Verdict } from "@/app/ui";
import { STAGES, type Board, type JobDetails, type Stage, type Writeup } from "@/lib/schemas";

interface Card {
  id: string;
  createdAt: string;
  company: string;
  role: string;
  details: JobDetails | null;
  board: Board;
  screen: { before: string; after: string };
  evalFails: number;
  cost: number;
  drafted: Record<Writeup, boolean>;
  due: string[];
  hasPdf: boolean;
}

const WRITEUP_INFO: { id: Writeup; label: string; what: string; email?: string }[] = [
  { id: "application-email", label: "Application email", what: "Sent with the resume, or as the application when the posting asks for an email.", email: "application" },
  { id: "outreach", label: "Outreach sequence", what: "LinkedIn connection note, cold email and follow-ups to a founder or engineer over 10 days." },
  { id: "referral", label: "Referral request", what: "Short message to an engineer at the company asking for a referral or a 15-minute chat.", email: "referral" },
  { id: "form-answers", label: "Application form answers", what: "Answers to the form's questions, written from your real work." },
  { id: "follow-up", label: "Follow-up", what: "A week after applying, with one new proof point.", email: "follow-up" },
  { id: "thank-you", label: "Thank-you note", what: "After an interview, referencing what was discussed.", email: "thank-you" },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function BoardPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/board").then((r) => r.json()).then(setCards);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function patch(id: string, body: object) {
    const res = await fetch(`/api/runs/${id}/board`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const board = (await res.json()) as Board;
    setCards((cs) => cs?.map((c) => (c.id === id ? { ...c, board } : c)) ?? null);
    load(); // "due" depends on the new state
  }

  const move = (id: string, stage: Stage) => patch(id, { stage });
  const due = cards?.filter((c) => c.due.length).length ?? 0;

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
      <PageHeader
        title="Board"
        action={
          <Link href="/workspace" className="btn">
            New run
          </Link>
        }
      >
        Every job you ran the panel on. Drag a card to move it, or open it for the write-ups checklist.
        {due > 0 && (
          <>
            {" "}
            <span className="due due--today">
              {due} due today
            </span>
          </>
        )}
      </PageHeader>

      {!cards && <p className="text-muted streaming">Loading the board…</p>}
      {cards && (
        <div className="board">
          {STAGES.map((stage) => {
            const column = cards.filter((c) => c.board.stage === stage);
            return (
              <section
                key={stage}
                aria-label={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging) move(dragging, stage);
                  setDragging(null);
                }}
                className={`column column--${slug(stage)} flex min-h-64 flex-col ${dragging ? "outline-2 outline-dashed outline-[var(--color-primary)]" : ""}`}
              >
                <h2 className="column__head font-body text-md">
                  {stage}
                  <span className="column__count mono">{column.length}</span>
                </h2>
                <div className="flex flex-col gap-3">
                  {column.length === 0 && <p className="px-2 text-sm text-muted">Drop a card here.</p>}
                  {column.map((c) => (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => setDragging(null)}
                      className="kanban-card relative"
                    >
                      <button className="text-left after:absolute after:inset-0 after:rounded-lg" onClick={() => setOpen(c.id)}>
                        <span className="block font-display text-md font-semibold">{c.company}</span>
                        <span className="block text-sm text-muted">{c.role}</span>
                      </button>
                      {(c.details?.location || c.details?.salary) && (
                        <p className="text-xs text-muted">{[c.details.location, c.details.salary].filter(Boolean).join(" · ")}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Verdict verdict={c.screen.before} />
                        <span className="verdict-arrow" aria-label="then">
                          →
                        </span>
                        <Verdict verdict={c.screen.after} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.evalFails > 0 && <span className="badge badge--fail">{c.evalFails} eval fail{c.evalFails === 1 ? "" : "s"}</span>}
                        {c.details?.redFlags.length ? <span className="badge badge--warn">fit risk</span> : null}
                        <span className="cost ml-auto">${c.cost.toFixed(2)}</span>
                      </div>
                      <WriteupDots card={c} />
                      {c.due.map((d) => (
                        <p key={d} className="text-sm">
                          <span className="due due--today mr-1.5">due today</span>
                          {d}
                        </p>
                      ))}
                      <select
                        aria-label={`Move ${c.company} to stage`}
                        className="input relative z-10 w-full md:hidden"
                        value={c.board.stage}
                        onChange={(e) => move(c.id, e.target.value as Stage)}
                      >
                        {STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {open && cards && <Drawer card={cards.find((c) => c.id === open)!} onClose={() => setOpen(null)} onPatch={(body) => patch(open, body)} onChanged={load} />}
    </main>
  );
}

const slug = (stage: string) => stage.toLowerCase().replace(/\s+/g, "-");

// One dot per write-up: hollow = not drafted, filled = drafted, accent = sent.
function WriteupDots({ card }: { card: Card }) {
  return (
    <div className="flex items-center gap-1.5" title="Write-ups: hollow not started, filled drafted, plum sent">
      <span className="mr-1 text-xs text-muted">Write-ups</span>
      {WRITEUP_INFO.map((w) => {
        const sent = card.board.sent[w.id];
        const drafted = card.drafted[w.id];
        return (
          <span
            key={w.id}
            title={`${w.label}: ${sent ? `sent ${sent}` : drafted ? "drafted" : "not started"}`}
            className={`h-2.5 w-2.5 rounded-full border ${sent ? "border-primary bg-primary" : drafted ? "border-muted bg-muted" : "border-muted"}`}
          />
        );
      })}
    </div>
  );
}

function Drawer({ card, onClose, onPatch, onChanged }: { card: Card; onClose: () => void; onPatch: (body: object) => void; onChanged: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState(card.board.notes);

  const loadRun = useCallback(() => {
    fetch(`/api/runs/${card.id}`).then((r) => r.json()).then(setRun);
  }, [card.id]);
  useEffect(() => {
    loadRun();
  }, [loadRun]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function draft(w: (typeof WRITEUP_INFO)[number]) {
    setBusy(w.id);
    setError("");
    try {
      const url = w.id === "outreach" ? `/api/runs/${card.id}/outreach` : `/api/runs/${card.id}/email`;
      const notesFor = w.id === "application-email" ? [card.details?.applyEmail && `Send to ${card.details.applyEmail}.`, card.details?.emailAsk].filter(Boolean).join(" ") : "";
      const body = w.id === "outreach" ? { target: "founder", notes: "" } : { kind: w.email, notes: notesFor };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      loadRun();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const latestEmail = (kind?: string): DraftedEmail | undefined => run?.emails?.filter((e) => e.kind === kind).at(-1);
  const latestSequence: DraftedSequence | undefined = run?.outreach?.at(-1);
  const d = card.details;

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-scrim" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${card.company} write-ups`}
        className="card flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto rounded-none border-y-0 border-r-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl">{card.company}</h2>
            <p className="text-muted">{card.role}</p>
          </div>
          <button className="btn btn--ghost" onClick={onClose} autoFocus>
            Close
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="drawer-stage">
            Stage
          </label>
          <select id="drawer-stage" className="input" value={card.board.stage} onChange={(e) => onPatch({ stage: e.target.value })}>
            {STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Link className="btn" href={`/workspace?run=${card.id}`}>
            Open in workspace
          </Link>
          {card.hasPdf && (
            <a className="btn" href={`/api/runs/${card.id}/pdf?download`}>
              Resume PDF
            </a>
          )}
        </div>

        {d && (
          <section className="card card--sunken p-5">
            <h3 className="mb-3 text-md">The job</h3>
            {d.redFlags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {d.redFlags.map((f) => (
                  <span key={f} className="badge badge--warn whitespace-normal">
                    Fit risk: {f}
                  </span>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ["Location", d.location],
                  ["Salary", d.salary],
                  ["Experience", d.experience],
                  ["How to apply", d.howToApply],
                  ["Stack", d.stack.join(", ")],
                  ["Must have", d.mustHave.join("; ")],
                  ["Nice to have", d.niceToHave.join("; ")],
                ] as [string, string][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
            </dl>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-md">Write-ups</h3>
          {error && <p className="text-sm text-fail">{error}</p>}
          <ul className="flex flex-col gap-3">
            {WRITEUP_INFO.map((w) => {
              const sent = card.board.sent[w.id];
              const email = w.email ? latestEmail(w.email) : undefined;
              const formCount = d?.formQuestions.length ?? 0;
              return (
                <li key={w.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{w.label}</span>
                    {sent ? (
                      <span className="badge badge--pass">sent {sent}</span>
                    ) : card.drafted[w.id] ? (
                      <span className="badge badge--neutral">drafted</span>
                    ) : (
                      <span className="badge badge--neutral text-muted">not started</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">{w.what}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {w.id === "form-answers" ? (
                      <Link className="btn" href={`/workspace?run=${card.id}&tab=qa`}>
                        {formCount ? `Answer ${formCount} listed question${formCount === 1 ? "" : "s"}` : "Open Q&A"}
                      </Link>
                    ) : (
                      <button className="btn" disabled={busy !== null} onClick={() => draft(w)}>
                        {busy === w.id ? "Drafting…" : card.drafted[w.id] ? "Redraft" : "Draft"}
                      </button>
                    )}
                    <button className={sent ? "btn btn--ghost" : "btn btn--primary"} onClick={() => onPatch({ sent: { [w.id]: sent ? null : today() } })}>
                      {sent ? "Unmark sent" : "Mark sent"}
                    </button>
                  </div>
                  {email && (
                    <details className="mt-3">
                      <summary className="flex items-center gap-2 text-sm font-semibold">
                        <Chevron />
                        {email.subject}
                      </summary>
                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{email.body}</p>
                      <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} />
                    </details>
                  )}
                  {w.id === "outreach" && latestSequence && (
                    <details className="mt-3">
                      <summary className="flex items-center gap-2 text-sm font-semibold">
                        <Chevron />
                        {latestSequence.steps.length} steps over {Math.max(...latestSequence.steps.map((s) => s.day))} days
                      </summary>
                      <ol className="mt-2 flex flex-col gap-3">
                        {latestSequence.steps.map((s, i) => (
                          <li key={i} className="text-sm">
                            <span className="eyebrow">Day {s.day}</span>{" "}
                            <span className="font-semibold">
                              {s.channel} to {s.recipient}
                            </span>{" "}
                            <span className="text-muted">({s.sendIf})</span>
                            {s.subject && <p className="mt-1 font-semibold">{s.subject}</p>}
                            <p className="mt-1 leading-relaxed whitespace-pre-wrap">{s.body}</p>
                            <CopyButton text={s.subject ? `Subject: ${s.subject}\n\n${s.body}` : s.body} />
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted">Marking the outreach sequence sent starts its clock: the card shows each step on the day it is due.</p>
        </section>

        <section className="flex flex-col gap-2">
          <label htmlFor="drawer-notes" className="font-display text-md font-semibold">
            Notes
          </label>
          <textarea
            id="drawer-notes"
            className="textarea w-full"
            placeholder="Who you spoke to, interview dates, what was discussed"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== card.board.notes && onPatch({ notes })}
          />
        </section>
      </aside>
    </div>
  );
}
