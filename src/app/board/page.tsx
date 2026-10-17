"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DraftedEmail, DraftedSequence, Run } from "@/lib/pipeline";
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
const btn = "rounded-md border border-border px-2 py-1 text-xs font-medium disabled:opacity-50";

export default function BoardPage() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/board").then((r) => r.json()).then(setCards);
  }, []);
  useEffect(load, [load]);

  async function patch(id: string, body: object) {
    const res = await fetch(`/api/runs/${id}/board`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const board = (await res.json()) as Board;
    setCards((cs) => cs?.map((c) => (c.id === id ? { ...c, board } : c)) ?? null);
    load(); // "due" depends on the new state
  }

  const move = (id: string, stage: Stage) => patch(id, { stage });
  const due = cards?.filter((c) => c.due.length).length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
          <p className="mt-1 text-sm text-muted">
            Every job you ran the panel on. Drag a card to move it; open it for the write-ups checklist.{due > 0 && ` ${due} job${due === 1 ? " has" : "s have"} something due.`}
          </p>
        </div>
        <Link href="/" className={btn}>
          + New job
        </Link>
      </div>

      {!cards && <p className="mt-6 text-sm text-muted">Loading…</p>}
      {cards && (
        <div className="mt-6 grid gap-3 overflow-x-auto pb-4 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const column = cards.filter((c) => c.board.stage === stage);
            return (
              <section
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging) move(dragging, stage);
                  setDragging(null);
                }}
                className={`min-h-48 rounded-lg border p-2 ${dragging ? "border-dashed border-accent" : "border-border"} bg-background`}
              >
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {stage}
                  <span className="tabular-nums">{column.length}</span>
                </h2>
                <div className="space-y-2">
                  {column.map((c) => (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => setOpen(c.id)}
                      className="cursor-pointer rounded-md border border-border bg-surface p-3 text-sm hover:border-accent"
                    >
                      <p className="font-medium">{c.company}</p>
                      <p className="text-xs text-muted">{c.role}</p>
                      {(c.details?.location || c.details?.salary) && (
                        <p className="mt-1 text-xs text-muted">{[c.details.location, c.details.salary].filter(Boolean).join(" · ")}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        <span className="rounded border border-border px-1">screen {c.screen.before}→{c.screen.after}</span>
                        {c.evalFails > 0 && <span className="rounded border border-bad px-1 text-bad">{c.evalFails} eval fail</span>}
                        {c.details?.redFlags.length ? <span className="rounded border border-warn px-1 text-warn">fit risk</span> : null}
                        <span className="rounded border border-border px-1 tabular-nums">${c.cost.toFixed(2)}</span>
                      </div>
                      <WriteupDots card={c} />
                      {c.due.map((d) => (
                        <p key={d} className="mt-2 rounded bg-background px-2 py-1 text-[11px] text-warn">
                          {d}
                        </p>
                      ))}
                      <select
                        aria-label="Move to stage"
                        className="mt-2 w-full rounded border border-border bg-surface px-1 py-0.5 text-[11px] md:hidden"
                        value={c.board.stage}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => move(c.id, e.target.value as Stage)}
                      >
                        {STAGES.map((s) => <option key={s}>{s}</option>)}
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

// One dot per write-up: hollow = not drafted, filled = drafted, accent = sent.
function WriteupDots({ card }: { card: Card }) {
  return (
    <div className="mt-2 flex gap-1" title="Write-ups: drafted (filled) and sent (green)">
      {WRITEUP_INFO.map((w) => {
        const sent = card.board.sent[w.id];
        const drafted = card.drafted[w.id];
        return (
          <span
            key={w.id}
            title={`${w.label}: ${sent ? `sent ${sent}` : drafted ? "drafted" : "not started"}`}
            className={`h-2 w-2 rounded-full border ${sent ? "border-good bg-good" : drafted ? "border-foreground bg-foreground" : "border-muted"}`}
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
  useEffect(loadRun, [loadRun]);

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
    <div className="fixed inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-background p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{card.company}</h2>
            <p className="text-sm text-muted">{card.role}</p>
          </div>
          <button className={btn} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <select className="rounded border border-border bg-surface px-2 py-1" value={card.board.stage} onChange={(e) => onPatch({ stage: e.target.value })}>
            {STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <Link className={btn} href={`/?run=${card.id}`}>
            Open in workspace
          </Link>
          {card.hasPdf && (
            <a className={btn} href={`/api/runs/${card.id}/pdf?download`}>
              Resume PDF
            </a>
          )}
        </div>

        {d && (
          <section className="mt-5 rounded-lg border border-border bg-surface p-4 text-sm">
            <h3 className="mb-2 font-semibold">The job</h3>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
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
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {d.redFlags.length > 0 && <p className="mt-2 text-xs text-warn">Fit risks: {d.redFlags.join("; ")}</p>}
          </section>
        )}

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Write-ups</h3>
          {error && <p className="mb-2 text-sm text-bad">{error}</p>}
          <ul className="space-y-3">
            {WRITEUP_INFO.map((w) => {
              const sent = card.board.sent[w.id];
              const email = w.email ? latestEmail(w.email) : undefined;
              const formCount = d?.formQuestions.length ?? 0;
              return (
                <li key={w.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{w.label}</span>
                    {sent ? <span className="text-xs text-good">sent {sent}</span> : card.drafted[w.id] ? <span className="text-xs">drafted</span> : null}
                    <span className="ml-auto flex gap-2">
                      {w.id === "form-answers" ? (
                        <Link className={btn} href={`/?run=${card.id}&tab=qa`}>
                          {formCount ? `Answer ${formCount} listed question${formCount === 1 ? "" : "s"}` : "Open Q&A"}
                        </Link>
                      ) : (
                        <button className={btn} disabled={busy !== null} onClick={() => draft(w)}>
                          {busy === w.id ? "Drafting…" : card.drafted[w.id] ? "Redraft" : "Draft"}
                        </button>
                      )}
                      <button className={btn} onClick={() => onPatch({ sent: { [w.id]: sent ? null : today() } })}>
                        {sent ? "Unmark" : "Mark sent"}
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{w.what}</p>
                  {email && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">Subject: {email.subject}</summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{email.body}</p>
                      <CopyText text={`Subject: ${email.subject}\n\n${email.body}`} />
                    </details>
                  )}
                  {w.id === "outreach" && latestSequence && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs">{latestSequence.steps.length} steps over {Math.max(...latestSequence.steps.map((s) => s.day))} days</summary>
                      <ol className="mt-1 space-y-2">
                        {latestSequence.steps.map((s, i) => (
                          <li key={i} className="text-xs">
                            <span className="font-medium">
                              Day {s.day} · {s.channel} · {s.recipient}
                            </span>{" "}
                            <span className="text-muted">({s.sendIf})</span>
                            {s.subject && <p className="mt-0.5">Subject: {s.subject}</p>}
                            <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{s.body}</p>
                            <CopyText text={s.subject ? `Subject: ${s.subject}\n\n${s.body}` : s.body} />
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">Marking the outreach sequence sent starts its clock: the card shows each step on the day it is due.</p>
        </section>

        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Notes</h3>
          <textarea
            className="h-28 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
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

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="mt-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
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
