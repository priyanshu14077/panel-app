"use client";

import { useInView } from "@/components/motion";

const STEPS = [
  ["Paste a job link", "YC, Greenhouse, Lever, Ashby or any job page. The posting is saved with the run."],
  ["Seven reviewers read it", "Each one alone, each told to find the reason to say no."],
  ["Rebuilt from your own work", "Only facts from your resume, profile, GitHub and portfolio. A missing fact becomes a question, not a guess."],
  ["Send it and track it", "A one-page PDF, the application email, a 10-day outreach sequence and a card on the board."],
];

// The track fills and each step lights up in turn once it scrolls into view.
export function Pipeline() {
  const [ref, inView] = useInView<HTMLOListElement>(0.4);
  return (
    <ol ref={ref} className="lp-pipe" data-on={inView || undefined}>
      <span className="lp-pipe__track" aria-hidden>
        <span className="lp-pipe__fill" />
      </span>
      {STEPS.map(([title, text], i) => (
        <li key={title} className="lp-pipe__step" style={{ "--i": i } as React.CSSProperties}>
          <span className="lp-pipe__node mono" aria-hidden>
            {i + 1}
          </span>
          <h3 className="text-lg">{title}</h3>
          <p className="text-sm text-muted">{text}</p>
        </li>
      ))}
    </ol>
  );
}
