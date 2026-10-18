import Link from "next/link";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";
import { Verdict } from "./ui";

const AREAS = [
  {
    href: "/workspace",
    name: "Workspace",
    what: "Start a run from a job link. Seven reviewers judge the resume, then it is rebuilt into a one-page PDF with the questions only you can answer.",
    action: "Start a run",
  },
  {
    href: "/board",
    name: "Board",
    what: "Every job you ran, from To apply to Offer. Each card says what is due today: the follow-up, the next outreach step, the thank-you note.",
    action: "Open the board",
  },
  {
    href: "/evals",
    name: "Evals",
    what: "Checks on every run: one page, no placeholders, and every number, skill and link traced back to your resume, profile or repos.",
    action: "See the checks",
  },
  {
    href: "/usage",
    name: "Usage & cost",
    what: "Every Claude call priced from its own token counts, by feature and by run, including what prompt caching saved.",
    action: "See the spend",
  },
];

const STEPS = [
  ["Paste a job link", "YC, Greenhouse, Lever, Ashby or any job page. The posting is saved with the run."],
  ["Seven reviewers read it alone", "An automated screen, two hiring managers, a rival applicant, the CEO, a 30-second recruiter and a future teammate."],
  ["It is rebuilt from your own work", "Only facts from your resume, profile, GitHub and portfolio. A line that needs a fact you haven't given is held back and asked about."],
  ["Send it and track it", "A one-page PDF, the application email, a 10-day outreach sequence, and a card on the board."],
];

export default function Landing() {
  return (
    <div className="landing">
      <SculptureHero
        src="/hero/panel.png"
        darkSrc="/hero/panel.png"
        mobileSrc="/hero/panel-mobile.png"
        mobileDarkSrc="/hero/panel-mobile.png"
        imageAlt="Seven resume sheets fanned out, six marked REJECT and the middle one marked PASS"
        brand="Hiring Panel"
        brandMark={<span className="brand-mark" aria-hidden />}
        navLinks={AREAS.map((a) => ({ label: a.name, href: a.href }))}
        navCta={null}
        eyebrow=""
        headline="Seven reviewers try to reject your resume."
        headlineAccent=""
        body="Then it is rebuilt into one page from work you have actually shipped, with the outreach drafted and every application on one board."
        primaryCta={{ label: "Start a run", href: "/workspace" }}
        secondaryCta={{ label: "See the board", href: "/board" }}
        hint="Move across the panel"
        hintTouch="Touch the panel"
        background="var(--color-bg)"
        darkBackground="var(--color-bg)"
        textColor="var(--color-text)"
        accentColor="var(--color-primary)"
        headingFont="var(--font-display)"
        accentFont="var(--font-display)"
        bodyFont="var(--font-body)"
        loadFonts={false}
        height="min(100svh, 980px)"
      />

      {/* Same side padding as the hero, so every section starts on its left edge. */}
      <main className="flex w-full flex-col gap-24 px-[clamp(20px,3.2vw,48px)] pt-16 pb-24">
        <section aria-labelledby="how" className="grid gap-10 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div>
            <h2 id="how" className="text-xl">
              How a run works
            </h2>
            <p className="mt-3 max-w-md text-muted">
              About two minutes and $0.19 on the default profile. Company research and outreach are optional extras.
            </p>
          </div>
          <ol className="grid gap-x-8 gap-y-10 sm:grid-cols-2">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex flex-col gap-2 border-t border-line pt-5">
                <span className="mono text-sm text-muted">Step {i + 1}</span>
                <h3 className="text-lg">{title}</h3>
                <p className="text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="proof" className="card card--sunken grid gap-8 p-8 min-[1000px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] min-[1000px]:p-10">
          <div className="flex flex-col gap-4">
            <h2 id="proof" className="text-xl">
              The screen that said no, asked again
            </h2>
            <p className="max-w-xl text-muted">
              The automated screen reads the original resume, then reads the rebuild. On a Microsoft posting it went from a rejection to a pass,
              and the PDF still fit on one page.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3" aria-label="Before: REJECT. After: PASS.">
              <Verdict verdict="REJECT" />
              <span className="verdict-arrow text-2xl" aria-hidden>
                →
              </span>
              <Verdict verdict="PASS" />
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-6 self-end">
            <div>
              <dt className="kpi-label">Core run</dt>
              <dd className="kpi-value kpi-value--cost mono">$0.19</dd>
            </div>
            <div>
              <dt className="kpi-label">Cheaper than the first version</dt>
              <dd className="kpi-value mono">81%</dd>
            </div>
            <div>
              <dt className="kpi-label">Reviewers per run</dt>
              <dd className="kpi-value mono">7</dd>
            </div>
            <div>
              <dt className="kpi-label">Pages, checked by pdfinfo</dt>
              <dd className="kpi-value mono">1</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="areas" className="flex flex-col gap-8">
          <div>
            <h2 id="areas" className="text-xl">
              Four places to work
            </h2>
            <p className="mt-3 max-w-xl text-muted">Everything runs on your machine: your resumes, runs and PDFs stay in your job-hunt folder.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 min-[1100px]:grid-cols-4">
            {AREAS.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="card group flex flex-col gap-3 p-6 text-ink no-underline transition-colors duration-200 hover:border-primary hover:text-ink"
              >
                <h3 className="text-lg">{a.name}</h3>
                <p className="flex-1 text-sm text-muted">{a.what}</p>
                <span className="font-semibold text-primary group-hover:underline">{a.action}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-start gap-5 border-t border-line pt-12 min-[800px]:flex-row min-[800px]:items-center min-[800px]:justify-between">
          <div>
            <h2 className="text-xl">Have a posting open?</h2>
            <p className="mt-2 text-muted">Paste the link and the panel starts reading.</p>
          </div>
          <Link href="/workspace" className="btn btn--accent">
            Start a run
          </Link>
        </section>
      </main>
    </div>
  );
}
