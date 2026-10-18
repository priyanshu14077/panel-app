"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { prefersReducedMotion, useInView } from "@/components/motion";

// Captured from the app with demo data: a placeholder candidate and made-up
// companies, so no real person or employer appears on the page.
const SCREENS = [
  { src: "/screens/new-run.jpg", label: "New run", alt: "New run: pick a resume, paste a job link or posting" },
  { src: "/screens/panel.jpg", label: "The panel", alt: "A run: the screen's REJECT to PASS, reader verdicts and the seven reviewer cards" },
  { src: "/screens/project-studio.jpg", label: "Project studio", alt: "Project studio: company research and project ideas aimed at the company" },
  { src: "/screens/outreach.jpg", label: "Outreach", alt: "Outreach: a LinkedIn and email sequence to a founder, engineer or recruiter" },
  { src: "/screens/board.jpg", label: "Board", alt: "Board: jobs in columns from To apply to Offer, with what is due today" },
  { src: "/screens/evals.jpg", label: "Evals", alt: "Evals: pass rates for each check across runs" },
  { src: "/screens/usage.jpg", label: "Usage & cost", alt: "Usage and cost: spend by tier and by feature" },
];
const DWELL_MS = 5200;

// Steps through the screens on its own while in view; hovering or focusing it
// holds the current one, and picking a tab jumps straight to it.
export function ScreenTour() {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const playing = inView && !held;

  useEffect(() => {
    if (!playing || prefersReducedMotion()) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % SCREENS.length), DWELL_MS);
    return () => clearTimeout(t);
  }, [playing, active]);

  return (
    <div
      ref={ref}
      className="lp-tour"
      data-playing={playing || undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div role="tablist" aria-label="Screens" className="lp-tour__tabs">
        {SCREENS.map((s, i) => (
          <button
            key={s.src}
            type="button"
            role="tab"
            id={`tour-tab-${i}`}
            aria-selected={i === active}
            aria-controls="tour-panel"
            className="lp-tour__tab"
            onClick={(e) => {
              setActive(i);
              e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
          >
            {s.label}
            {/* Fills over the dwell time; restarts with each new screen. */}
            <span key={i === active ? `on-${active}` : "off"} className="lp-tour__meter" style={{ "--dwell": `${DWELL_MS}ms` } as React.CSSProperties} aria-hidden />
          </button>
        ))}
      </div>
      <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${active}`} className="lp-tour__frame">
        {SCREENS.map((s, i) => (
          <Image
            key={s.src}
            src={s.src}
            alt={s.alt}
            width={2040}
            height={1275}
            sizes="(max-width: 1000px) 100vw, 1280px"
            className="lp-tour__shot"
            data-active={i === active || undefined}
            aria-hidden={i !== active}
            priority={i === 0}
          />
        ))}
      </div>
    </div>
  );
}
