"use client";

import { useEffect, useRef, useState } from "react";

// True once the element has scrolled into view. Each animation starts
// from this, so nothing moves off screen.
export function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Counts from 0 to `to` when scrolled into view. The final value is the
// accessible name, so screen readers never hear the in-between numbers.
export function CountUp({ to, decimals = 0, prefix = "", suffix = "", duration = 1400, className }: { to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.6);
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const span = prefersReducedMotion() ? 0 : duration;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = span ? Math.min(1, (now - start) / span) : 1;
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);
  const final = `${prefix}${to.toFixed(decimals)}${suffix}`;
  return (
    <span ref={ref} className={className} aria-label={final}>
      <span aria-hidden>
        {prefix}
        {value.toFixed(decimals)}
        {suffix}
      </span>
    </span>
  );
}
