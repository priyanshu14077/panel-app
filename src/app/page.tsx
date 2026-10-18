import Link from "next/link";
import SculptureHero from "@/components/ui/liquid-sculpture-hero";
import { Bento } from "@/components/landing/bento";
import { Faq } from "@/components/landing/faq";
import { FloatingNav } from "@/components/landing/floating-nav";
import { CountUp } from "@/components/motion";
import { PanelDemo } from "@/components/landing/panel-demo";
import { Pipeline } from "@/components/landing/pipeline";
import { ScreenTour } from "@/components/landing/screen-tour";
import { Ticker } from "@/components/landing/ticker";
import { VideoShowcase } from "@/components/landing/video-showcase";

const AREAS = [
  { href: "/workspace", label: "Workspace" },
  { href: "/board", label: "Board" },
  { href: "/evals", label: "Evals" },
  { href: "/usage", label: "Usage & cost" },
];

const PRINCIPLES = [
  {
    title: "Only your facts",
    text: "The rebuild may use your resume, your profile, your repos and your portfolio. Nothing else.",
    icon: <path d="M4 12.5l5 5L20 6.5" />,
  },
  {
    title: "Held back, then asked",
    text: "A line that needs a fact you haven't given stays out of the PDF until you answer. Answer \"none\" and it's deleted.",
    icon: <path d="M12 8v5m0 3.5v.5M5 19h14L12 5 5 19Z" />,
  },
  {
    title: "Traced by evals",
    text: "Every number, skill and link on the PDF is checked against your sources, and a grounding judge can read each line.",
    icon: <path d="M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm4.6-1.9L20 20" />,
  },
];

export default function Landing() {
  return (
    <div className="landing ember">
      <FloatingNav links={AREAS} />
      <SculptureHero
        src="/hero/panel.png"
        darkSrc="/hero/panel.png"
        mobileSrc="/hero/panel-mobile.png"
        mobileDarkSrc="/hero/panel-mobile.png"
        imageAlt="Seven resume sheets fanned out, six marked REJECT and the middle one glowing with PASS"
        theme="dark"
        brand="Hiring Panel"
        brandMark={<span className="brand-mark" aria-hidden />}
        navLinks={AREAS}
        navCta={null}
        eyebrow=""
        headline="Seven reviewers try to reject your resume."
        headlineAccent="reject your resume."
        body="Then it is rebuilt into one page from work you have actually shipped, with the outreach drafted and every application on one board."
        primaryCta={{ label: "Start a run", href: "/workspace" }}
        secondaryCta={null}
        hint="Move across the panel"
        hintTouch="Touch the panel"
        background="var(--color-bg)"
        darkBackground="var(--color-bg)"
        textColor="var(--color-text)"
        accentColor="var(--color-accent-text)"
        headingFont="var(--font-display)"
        accentFont="var(--font-display)"
        bodyFont="var(--font-body)"
        loadFonts={false}
        height="min(100svh, 980px)"
        showCredit={false}
      />
      <Ticker />

      <main className="lp-main">
        <section aria-label="Demo video">
          <VideoShowcase />
        </section>

        <section aria-labelledby="panel" className="flex flex-col gap-8">
          <div className="lp-head">
            <h2 id="panel" className="lp-h2">
              Seven reviewers, <span className="hl">each reading alone</span>
            </h2>
          </div>
          <PanelDemo />
        </section>

        <section aria-labelledby="screens" className="flex flex-col gap-8">
          <h2 id="screens" className="lp-h2">
            Inside <span className="hl">the app</span>
          </h2>
          <ScreenTour />
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-10">
          <div className="lp-head">
            <h2 id="how" className="lp-h2">
              From a job link to <span className="hl">a sent application</span>
            </h2>
          </div>
          <Pipeline />
        </section>

        <section aria-labelledby="features" className="flex flex-col gap-8">
          <div className="lp-head">
            <h2 id="features" className="lp-h2">
              Everything after <span className="hl">the verdict</span>
            </h2>
          </div>
          <Bento />
        </section>

        <section aria-label="Measured numbers">
          <dl className="lp-stats">
            <div className="lp-stat">
              <dt>for the panel, rebuild and PDF</dt>
              <dd>
                <CountUp to={0.19} decimals={2} prefix="$" />
              </dd>
            </div>
            <div className="lp-stat">
              <dt>cheaper than the first version</dt>
              <dd>
                <CountUp to={81} suffix="%" />
              </dd>
            </div>
            <div className="lp-stat">
              <dt>cheaper per extra outreach draft, with caching</dt>
              <dd>
                <CountUp to={90} suffix="%" />
              </dd>
            </div>
            <div className="lp-stat">
              <dt>page, checked by pdfinfo</dt>
              <dd>
                <CountUp to={1} duration={600} />
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="honest" className="flex flex-col gap-8">
          <div className="lp-head">
            <h2 id="honest" className="lp-h2">
              Nothing on the resume is <span className="hl">invented</span>
            </h2>
          </div>
          <div className="lp-principles">
            {PRINCIPLES.map((p) => (
              <article key={p.title} className="lp-principle">
                <span className="lp-icon" aria-hidden>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {p.icon}
                  </svg>
                </span>
                <h3 className="text-lg">{p.title}</h3>
                <p className="text-sm text-muted">{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="faq" className="grid gap-10 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          <div className="lp-head">
            <h2 id="faq" className="lp-h2">
              <span className="hl">Questions</span>
            </h2>
          </div>
          <Faq />
        </section>

        <section aria-labelledby="start" className="lp-cta">
          <h2 id="start" className="lp-h2 mx-auto">
            Have a posting <span className="hl">open?</span>
          </h2>
          <Link href="/workspace" className="lp-btn">
            Start a run
          </Link>
        </section>

        <footer className="lp-footer">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <span className="brand-mark" aria-hidden />
            Hiring Panel
          </span>
          <nav aria-label="Footer">
            {AREAS.map((a) => (
              <Link key={a.href} href={a.href}>
                {a.label}
              </Link>
            ))}
          </nav>
          <span>
            Hero by{" "}
            <a href="https://guglielmogiannattasio.it" target="_blank" rel="noreferrer">
              guglielmogiannattasio.it
            </a>
          </span>
        </footer>
      </main>
    </div>
  );
}
