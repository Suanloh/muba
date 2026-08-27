"use client";
import React from "react";

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
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || subtitle) && (
        <header className="border-b border-slate-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-800">{title}</h2>}
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
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
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-rose-50 text-rose-700 border-rose-200",
    blue: "bg-sky-50 text-sky-700 border-sky-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
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
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const variants: Record<string, string> = {
    primary: "bg-sky-600 text-white hover:bg-sky-700 disabled:bg-slate-300",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
    danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{children}</code>
  );
}
