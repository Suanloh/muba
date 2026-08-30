"use client";
/** MOVA brand mark — the ledger check, matching the prototype. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect x="1" y="1" width="26" height="26" rx="8" fill="var(--ledger)" />
      <path
        d="M8.5 14.8 12 18.3 19.5 9.8"
        fill="none"
        stroke="var(--bark)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
