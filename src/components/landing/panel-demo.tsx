"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/components/motion";

// An illustrative panel for a backend role, written to show the format of a
// real run. Each reviewer reads the resume alone.
const REVIEWERS: { role: string; verdict: string; tone: "reject" | "maybe"; note: string }[] = [
  { role: "Automated screen", verdict: "REJECT", tone: "reject", note: "Missing from the resume: Kafka, gRPC, on-call." },
  { role: "Hiring manager, interview call", verdict: "NO", tone: "reject", note: "Ten seconds in, nothing says payments." },
  { role: "Hiring manager, day one", verdict: "NO", tone: "reject", note: "\"Improved performance\" by how much, for whom?" },
  { role: "Rival applicant", verdict: "NO", tone: "reject", note: "My resume names the queue I scaled. This one doesn't." },
  { role: "CEO", verdict: "NO", tone: "reject", note: "Can't tell what shipped versus what was planned." },
  { role: "30-second recruiter", verdict: "NO", tone: "reject", note: "The title line says full-stack; the role is backend." },
  { role: "Future teammate", verdict: "MAYBE", tone: "maybe", note: "Good testing habits, no sign of code review." },
];
const FLIP = REVIEWERS.length + 1;

export function PanelDemo() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const quick = prefersReducedMotion();
    const timers = Array.from({ length: FLIP }, (_, i) =>
      setTimeout(() => setStep(i + 1), quick ? 0 : 450 + i * 420 + (i + 1 === FLIP ? 900 : 0)),
    );
    return () => timers.forEach(clearTimeout);
  }, [inView, round]);

  const flipped = step >= FLIP;
  return (
    <div ref={ref} className="lp-panel" data-flipped={flipped || undefined}>
      <div className="lp-panel__grid" aria-live="polite">
        {REVIEWERS.map((r, i) => {
          const landed = step > i;
          return (
            <article key={r.role} className="lp-reviewer" data-landed={landed || undefined}>
              <p className="lp-reviewer__role">{r.role}</p>
              {landed ? (
                <span className={`verdict verdict--${r.tone} lp-pop`}>{r.verdict}</span>
              ) : (
                <span className="verdict verdict--pending streaming">READING</span>
              )}
              <p className="lp-reviewer__note">{landed ? r.note : " "}</p>
            </article>
          );
        })}
        <article className="lp-screen" aria-label={flipped ? "Automated screen after the rebuild: PASS" : "Automated screen after the rebuild: waiting"}>
          <p className="lp-reviewer__role">Re-screen after the rebuild</p>
          <div className="flex items-center gap-3">
            <span className="verdict verdict--reject">REJECT</span>
            <span className="lp-screen__arrow" aria-hidden>
              →
            </span>
            {flipped ? <span className="verdict verdict--pass lp-pop lp-glow-pill">PASS</span> : <span className="verdict verdict--pending streaming">REBUILDING</span>}
          </div>
          <p className="lp-reviewer__note">Same screen, same posting. Only the resume changed.</p>
        </article>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="badge badge--neutral">Example panel</span>
        <button
          type="button"
          className="lp-btn lp-btn--ghost lp-btn--sm"
          disabled={step < FLIP}
          onClick={() => {
            setStep(0);
            setRound((r) => r + 1);
          }}
        >
          Run it again
        </button>
      </div>
    </div>
  );
}
