"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Workspace" },
  { href: "/board", label: "Board" },
  { href: "/evals", label: "Evals" },
  { href: "/usage", label: "Usage & cost" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
        <span className="text-sm font-semibold tracking-tight">Hiring Panel</span>
        <div className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm ${pathname === l.href ? "bg-surface font-medium" : "text-muted hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
