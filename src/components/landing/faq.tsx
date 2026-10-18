const QA: [string, string][] = [
  [
    "Where does my data go?",
    "The app runs on your machine. Resumes, runs and PDFs stay in your job-hunt folder; only the text each step needs is sent to the Anthropic API.",
  ],
  [
    "What does a run cost?",
    "About $0.19 for the panel, rebuild and PDF on the default profile. Company research is about $0.20, or free when a brief from the last 30 days is reused. Outreach is about $0.06 for the first target and $0.02 for each one after.",
  ],
  [
    "Which models does it use?",
    "Claude Haiku 5.5 reads and grades; Claude Sonnet 5.5 writes and researches. MODEL_PROFILE switches to economy or quality.",
  ],
  [
    "Will it make things up?",
    "The rebuild may only use your resume, profile, repos and portfolio. A missing fact becomes a question for you, and evals trace every number, skill and link back to a source.",
  ],
  [
    "What do I need to run it?",
    "Node.js 20+, an Anthropic API key, tectonic and poppler. The GitHub CLI and Chrome are optional; they build the knowledge base from your repos and portfolio.",
  ],
];

export function Faq() {
  return (
    <div className="lp-faq">
      {QA.map(([q, a]) => (
        <details key={q} className="lp-faq__item">
          <summary>
            {q}
            <span className="lp-faq__icon" aria-hidden />
          </summary>
          <p>{a}</p>
        </details>
      ))}
    </div>
  );
}
