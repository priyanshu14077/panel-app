"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Appears once the hero's own nav has scrolled away, so the four areas stay
// one click away down the page.
export function FloatingNav({ links }: { links: { label: string; href: string }[] }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".sh-nav");
    if (!hero) return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting));
    io.observe(hero);
    return () => io.disconnect();
  }, []);
  return (
    <header className="lp-floatnav" data-shown={shown || undefined} inert={!shown}>
      <Link href="/" className="lp-floatnav__brand">
        <span className="brand-mark" aria-hidden />
        <span className="max-[520px]:sr-only">Hiring Panel</span>
      </Link>
      <nav aria-label="Sections" className="lp-floatnav__links">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            {l.label}
          </Link>
        ))}
      </nav>
      <Link href="/workspace" className="lp-btn lp-btn--sm">
        Start a run
      </Link>
    </header>
  );
}
