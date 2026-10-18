// The panel's verdicts scroll past, ending on the rebuild's pass.
const ITEMS: [string, string, "reject" | "maybe" | "pass"][] = [
  ["Automated screen", "REJECT", "reject"],
  ["Hiring manager, interview call", "NO", "reject"],
  ["Hiring manager, day one", "NO", "reject"],
  ["Rival applicant", "NO", "reject"],
  ["CEO", "NO", "reject"],
  ["30-second recruiter", "NO", "reject"],
  ["Future teammate", "MAYBE", "maybe"],
  ["Automated screen, after the rebuild", "PASS", "pass"],
];

export function Ticker() {
  const row = (hidden: boolean) => (
    <ul className="lp-ticker__row" aria-hidden={hidden || undefined}>
      {ITEMS.map(([who, verdict, tone]) => (
        <li key={who}>
          <span className="lp-ticker__who">{who}</span>
          <span className={`verdict verdict--${tone}`}>{verdict}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label="The seven verdicts, then the re-screen" className="lp-ticker">
      <div className="lp-ticker__track">
        {row(false)}
        {row(true)}
      </div>
    </section>
  );
}
