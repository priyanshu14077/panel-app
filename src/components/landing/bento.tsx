"use client";

import Link from "next/link";
import { CountUp, useInView } from "@/components/motion";

// An example LinkedIn connection note; the meter counts its real length.
const NOTE =
  "Hi [Name], I read how your team moved invoice matching onto streaming jobs. I built a payments reconciliation service that does the same at small scale. Glad to compare notes.";
const LINKEDIN_LIMIT = 200;

// Measured on the author's runs: suite pass rates and share of spend by tier.
const EVALS: [string, number][] = [
  ["One page", 100],
  ["Numbers traced", 100],
  ["Links real", 100],
  ["Keywords gained", 76],
];
const SPEND: [string, number, string][] = [
  ["Writing", 72, "lp-series-1"],
  ["Web research", 21, "lp-series-2"],
  ["Reading and grading", 7, "lp-series-3"],
];

function Tile({ className = "", title, text, href, action, children }: { className?: string; title: string; text: string; href: string; action: string; children: React.ReactNode }) {
  const [ref, inView] = useInView<HTMLElement>(0.35);
  return (
    <article ref={ref} className={`lp-tile ${className}`} data-on={inView || undefined}>
      <div className="lp-tile__demo">{children}</div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg">{title}</h3>
        <p className="text-sm text-muted">{text}</p>
        <Link href={href} className="lp-tile__link">
          {action}
        </Link>
      </div>
    </article>
  );
}

export function Bento() {
  return (
    <div className="lp-bento">
      <Tile
        className="lp-tile--resume"
        title="A one-page resume, rebuilt"
        text="Every mistake the panel found is fixed using your own facts. A line that needs one you haven't given is held back from the PDF and asked about."
        href="/workspace"
        action="Start a run"
      >
        <div className="lp-sheet" aria-hidden>
          <span className="lp-sheet__name" />
          <span className="lp-sheet__contact" />
          {[88, 74, 92, 66].map((w, i) => (
            <span key={i} className="lp-sheet__line" style={{ "--w": `${w}%`, "--i": i } as React.CSSProperties} />
          ))}
          <span className="lp-sheet__rule" />
          <span className="lp-sheet__held">
            <span className="lp-sheet__line" style={{ "--w": "58%", "--i": 4 } as React.CSSProperties} />
            <span className="heldback lp-pulse">needs your answer</span>
          </span>
          {[80, 70].map((w, i) => (
            <span key={i} className="lp-sheet__line" style={{ "--w": `${w}%`, "--i": i + 5 } as React.CSSProperties} />
          ))}
          <span className="lp-sheet__badge">1 / 1 page</span>
        </div>
      </Tile>

      <Tile title="Outreach under the limit" text="A 10-day LinkedIn and email sequence to a founder or engineer. Notes are cut to fit before you ever paste them." href="/workspace" action="Draft outreach">
        <div className="lp-note">
          <p className="text-sm leading-relaxed">{NOTE}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="limit">
              <CountUp to={NOTE.length} duration={1600} /> / {LINKEDIN_LIMIT}
            </span>
            <span className="text-xs text-muted">LinkedIn note</span>
          </div>
          <div className="limit-bar mt-2 text-[var(--limit-ok)]">
            <span className="lp-grow" style={{ "--w": `${(NOTE.length / LINKEDIN_LIMIT) * 100}%` } as React.CSSProperties} />
          </div>
        </div>
      </Tile>

      <Tile title="Every job on one board" text="To apply, applied, in conversation. Each card says what is due today." href="/board" action="Open the board">
        <div className="lp-miniboard" aria-hidden>
          {["To apply", "Applied", "Talking"].map((c) => (
            <div key={c} className="lp-miniboard__col">
              <span className="lp-miniboard__head">{c}</span>
              <span className="lp-miniboard__ghost" />
            </div>
          ))}
          <span className="lp-miniboard__card">
            <span className="lp-miniboard__title" />
            <span className="verdict verdict--pass">PASS</span>
          </span>
        </div>
      </Tile>

      <Tile title="Checked, not trusted" text="Free checks on every run trace each number, skill and link back to your sources." href="/evals" action="See the checks">
        <ul className="flex flex-col gap-3">
          {EVALS.map(([label, rate], i) => (
            <li key={label} className="flex flex-col gap-1.5">
              <span className="flex justify-between text-sm">
                {label}
                <span className="mono text-muted">{rate}%</span>
              </span>
              <span className="progress">
                <span className={`lp-grow ${rate === 100 ? "lp-bar-pass" : "lp-bar-warn"}`} style={{ "--w": `${rate}%`, "--i": i } as React.CSSProperties} />
              </span>
            </li>
          ))}
        </ul>
      </Tile>

      <Tile title="Know what it costs" text="Every call priced from its own token counts, by feature and by run." href="/usage" action="See the spend">
        <div className="flex flex-col gap-4">
          <p className="lp-big">
            <CountUp to={0.19} decimals={2} prefix="$" />
            <span className="ml-2 text-sm font-semibold tracking-normal text-muted">a run</span>
          </p>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-track" role="img" aria-label="Spend: writing 72%, web research 21%, reading and grading 7%">
            {SPEND.map(([label, pct, series], i) => (
              <span key={label} className={`lp-grow ${series}`} style={{ "--w": `${pct}%`, "--i": i } as React.CSSProperties} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {SPEND.map(([label, pct, series]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${series}`} aria-hidden />
                {label} <span className="mono">{pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      </Tile>

      <Tile title="Built from your GitHub" text="Repos, commits and portfolio pages become a knowledge base. Each run reads only the dozen repos that fit the posting." href="/workspace" action="Build it">
        <ul className="lp-chips" aria-label="What the knowledge base reads">
          {["GitHub repos", "Your commits", "Portfolio pages", "Profile answers", "12 shortlisted per posting"].map((c, i) => (
            <li key={c} className="lp-chip" style={{ "--i": i } as React.CSSProperties}>
              {c}
            </li>
          ))}
        </ul>
      </Tile>
    </div>
  );
}
