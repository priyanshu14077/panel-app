"use client";

import { useInView } from "@/components/motion";

// The demo film at full width, inside a slowly turning ring of light. It
// scales up into place once it scrolls into view and waits for a click to play.
export function VideoShowcase() {
  const [ref, inView] = useInView<HTMLElement>(0.25);
  return (
    <figure ref={ref} className="lp-showcase" data-on={inView || undefined}>
      <span className="lp-showcase__halo" aria-hidden />
      <div className="lp-showcase__ring">
        <video
          src="/demo/hiring-panel-demo.mp4"
          poster="/demo/hiring-panel-demo-poster.jpg"
          controls
          playsInline
          preload="metadata"
          aria-label="A 22-second demo of one run, without sound"
        />
      </div>
    </figure>
  );
}
