"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Run } from "@/lib/pipeline";

const LINKS = [
  { href: "/workspace", label: "Workspace" },
  { href: "/board", label: "Board" },
  { href: "/history", label: "History" },
  { href: "/evals", label: "Evals" },
  { href: "/usage", label: "Usage & cost" },
];

type RunSummary = Pick<Run, "id" | "createdAt" | "synthesis" | "pdf">;

// The workspace fires this after a run starts or finishes.
export const RUNS_CHANGED = "hp:runs-changed";

export function Nav() {
  const pathname = usePathname();
  return (
    <aside className="border-b border-line bg-rail min-[900px]:sticky min-[900px]:top-0 min-[900px]:flex min-[900px]:h-dvh min-[900px]:flex-col min-[900px]:border-r min-[900px]:border-b-0">
      <Link href="/" className="flex items-center gap-3 px-5 pt-5 pb-4 text-ink no-underline hover:text-ink">
        <span className="brand-mark" aria-hidden />
        <span className="font-display text-lg font-bold tracking-tight">Hiring Panel</span>
      </Link>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 min-[900px]:flex-col">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="nav-tab shrink-0" aria-current={pathname === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={null}>
        <RecentRuns />
      </Suspense>
    </aside>
  );
}

function RecentRuns() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const pathname = usePathname();
  const open = useSearchParams().get("run");

  useEffect(() => {
    const load = () => {
      fetch("/api/runs").then((r) => r.json()).then(setRuns);
    };
    load();
    window.addEventListener(RUNS_CHANGED, load);
    return () => window.removeEventListener(RUNS_CHANGED, load);
  }, []);

  return (
    <div className="hidden min-h-0 flex-1 flex-col border-t border-line pt-4 min-[900px]:flex">
      <h2 className="px-5 pb-2 font-body text-sm font-semibold text-muted">Recent runs</h2>
      {runs?.length === 0 && <p className="px-5 text-sm text-muted">Runs you start appear here.</p>}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {runs?.map((r) => {
          const current = pathname === "/workspace" && open === r.id;
          return (
            <li key={r.id}>
              <Link
                href={`/workspace?run=${r.id}`}
                aria-current={current ? "page" : undefined}
                className={`block rounded-md px-2 py-2 text-ink no-underline hover:bg-surface-hover hover:text-ink ${current ? "bg-surface" : ""}`}
              >
                <span className="block truncate text-sm font-semibold">{r.synthesis ? r.synthesis.job.company : "Run did not finish"}</span>
                <span className="block truncate text-xs text-muted">
                  {r.synthesis ? r.synthesis.job.role : r.id} · {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
