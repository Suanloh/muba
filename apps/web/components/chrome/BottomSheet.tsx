"use client";
/** Generic mobile bottom sheet (safe-area aware, reduced-motion friendly). */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? undefined}>
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-[22px] border-t border-hairline bg-surface pb-safe-lg shadow-pop">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-hairline-strong" aria-hidden="true" />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 id={labelledBy} className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-hairline text-muted transition hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto px-5 pb-6 pt-1">{children}</div>
      </div>
    </div>
  );
}
