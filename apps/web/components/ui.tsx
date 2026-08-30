"use client";
import React from "react";

/**
 * MOVA UI primitives. These are the only four rendering mechanics the app
 * uses — cards, status badges, buttons, and mono code chips — styled with the
 * design tokens from globals.css (no hardcoded colors). Badge tones map onto
 * the four semantic status colors (signal / ledger / ember / alarm); every
 * number, address, hash, and state name renders in the mono face.
 */

export function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[18px] border border-hairline bg-surface shadow-card ${className}`}
    >
      {(title || subtitle) && (
        <header className="border-b border-hairline px-5 py-4">
          {title && (
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
          )}
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "green" | "amber" | "red" | "blue" | "violet";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    slate: "border-hairline bg-surface-2 text-muted",
    green: "border-ledger-border bg-ledger-bg text-ledger-text",
    amber: "border-ember-border bg-ember-bg text-ember-text",
    red: "border-alarm-border bg-alarm-bg text-alarm-text",
    blue: "border-signal-border bg-signal-bg text-signal-text",
    violet: "border-signal-border bg-signal-bg text-signal-text",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "primary",
  disabled,
  onClick,
  children,
  className = "",
}: {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const variants: Record<string, string> = {
    // signal — the active / in-progress CTA
    primary: "border border-signal bg-signal text-white hover:opacity-90 disabled:opacity-35",
    // ledger — the irreversible human-approval action (btn-solid-ledger)
    success: "border border-ledger bg-ledger text-[#08150F] hover:opacity-90 disabled:opacity-35",
    // neutral surface button
    secondary:
      "border border-hairline-strong bg-surface text-ink hover:bg-surface-2 disabled:text-faint",
    // text button
    ghost: "text-muted hover:bg-surface-2 hover:text-ink disabled:text-faint",
    // outline that turns alarm on hover (btn-outline-alarm) — for reject/refuse
    danger:
      "border border-hairline-strong bg-transparent text-muted hover:border-alarm hover:text-alarm-text disabled:text-faint",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-[12px] px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">
      {children}
    </code>
  );
}
