"use client";
/**
 * Single toast — token-styled (no hardcoded Tailwind status colors), with an
 * auto-dismiss progress bar that pauses on hover/focus and respects
 * prefers-reduced-motion (the sweep is killed by the globals media query).
 */
import { useEffect, useState } from "react";
import type { AppNotification } from "@/lib/store/app-store";

const DURATION: Record<AppNotification["kind"], number> = {
  info: 6000,
  success: 6000,
  warning: 10000,
  error: 10000,
};

const TONE: Record<
  AppNotification["kind"],
  { ring: string; barColor: string; icon: string; glyph: string }
> = {
  info: { ring: "border-signal-border bg-signal-bg", barColor: "var(--signal-text)", icon: "text-signal-text", glyph: "i" },
  success: { ring: "border-ledger-border bg-ledger-bg", barColor: "var(--ledger-text)", icon: "text-ledger-text", glyph: "✓" },
  warning: { ring: "border-ember-border bg-ember-bg", barColor: "var(--ember-text)", icon: "text-ember-text", glyph: "!" },
  error: { ring: "border-alarm-border bg-alarm-bg", barColor: "var(--alarm-text)", icon: "text-alarm-text", glyph: "✕" },
};

export function Toast({ n, onDismiss }: { n: AppNotification; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = DURATION[n.kind];
  const tone = TONE[n.kind];

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(t);
  }, [paused, duration, onDismiss]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto w-full rounded-[14px] border px-3 py-2.5 shadow-pop ${tone.ring}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${tone.ring} ${tone.icon}`}
            aria-hidden="true"
          >
            {tone.glyph}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{n.title}</p>
            {n.message && <p className="mt-0.5 text-xs text-muted">{n.message}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 text-xs text-muted transition hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface/80" aria-hidden="true">
        <div
          className="h-full rounded-full opacity-60"
          style={{
            backgroundColor: tone.barColor,
            animation: `mova-shrink ${duration}ms linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </div>
    </div>
  );
}
