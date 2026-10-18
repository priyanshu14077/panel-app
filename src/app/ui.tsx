"use client";

import { useState } from "react";

// Shared pieces for every page. Colours come only from tokens.css classes.

export function Card({
  title,
  action,
  children,
  className = "",
  sunken = false,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  sunken?: boolean;
}) {
  return (
    <section className={`card ${sunken ? "card--sunken" : ""} min-w-0 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// The screen's PASS is good news; a reader's PASS means "no". Label them apart.
export function Verdict({ verdict, reader = false, pending = false }: { verdict?: string; reader?: boolean; pending?: boolean }) {
  if (pending || !verdict) return <span className="self-start verdict verdict--pending streaming">READING</span>;
  if (["HIRE", "INTERVIEW"].includes(verdict) || (verdict === "PASS" && !reader)) return <span className="self-start verdict verdict--pass">{verdict}</span>;
  if (verdict === "PASS") return <span className="self-start verdict verdict--reject">PASS (NO)</span>;
  if (["REJECT", "NO"].includes(verdict)) return <span className="self-start verdict verdict--reject">{verdict}</span>;
  if (verdict === "MAYBE") return <span className="self-start verdict verdict--maybe">MAYBE</span>;
  return <span className="self-start verdict verdict--pending">{verdict === "?" ? "NO VERDICT" : verdict}</span>;
}

export const isWin = (verdict: string, reader: boolean) => ["HIRE", "INTERVIEW"].includes(verdict) || (verdict === "PASS" && !reader);

export function Notice({ tone, children }: { tone: "fail" | "warn"; children: React.ReactNode }) {
  return (
    <div role={tone === "fail" ? "alert" : "status"} className={`rounded-md px-4 py-3 text-sm ${tone === "fail" ? "bg-fail-tint text-fail" : "bg-warn-tint text-warn"}`}>
      {children}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn--ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

// `119 / 120 words` with a bar: near from 90 %, over past the limit.
export function LimitMeter({ used, limit, unit }: { used: number; limit: number; unit: string }) {
  const ratio = used / limit;
  const tone = ratio > 1 ? "limit--over" : ratio >= 0.9 ? "limit--near" : "";
  return (
    <div className={`limit ${tone} flex min-w-32 flex-col gap-1`}>
      <span>
        {used} / {limit} {unit}
      </span>
      <span className="limit-bar" aria-hidden>
        <span style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </span>
    </div>
  );
}

// [bracketed gaps] the candidate still has to fill, shown as held-back chips.
export function WithGaps({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]\n]{1,80}\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[^\]]+\]$/.test(p) ? (
          <span key={i} className="heldback">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function Chevron() {
  return (
    <svg className="chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PageHeader({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1>{title}</h1>
        {children && <p className="mt-2 max-w-3xl text-muted">{children}</p>}
      </div>
      {action}
    </header>
  );
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
