"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Fit = "page" | "width";

// The resume over the whole window. Asks the browser for real full screen, and
// stays a full-window overlay where that isn't allowed (iPhone Safari, some
// embedded browsers). Escape, or leaving full screen, closes it.
export function PdfFullScreen({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>("page");

  useEffect(() => {
    const el = ref.current;
    el?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  // The browser's PDF viewer reads the fit from the URL fragment.
  const view = `${src}#view=${fit === "page" ? "Fit" : "FitH"}`;

  // Rendered at the app root, so no sticky or animated ancestor can trap the
  // fixed overlay, while staying inside .ember for the theme.
  const host = document.querySelector(".ember-app") ?? document.body;
  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${title}, full screen`} className="hp-fade fixed inset-0 z-50 flex flex-col bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <h2 className="truncate">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Fit" className="segmented">
            <button type="button" aria-pressed={fit === "page"} onClick={() => setFit("page")}>
              Whole page
            </button>
            <button type="button" aria-pressed={fit === "width"} onClick={() => setFit("width")}>
              Fit width
            </button>
          </div>
          <a className="btn" href={`${src}${src.includes("?") ? "&" : "?"}download`}>
            Download
          </a>
          <a className="btn btn--ghost" href={src} target="_blank" rel="noreferrer">
            New tab
          </a>
          <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
      <iframe key={view} src={view} title={title} className="min-h-0 w-full flex-1 border-0 bg-sunken" />
    </div>,
    host,
  );
}
