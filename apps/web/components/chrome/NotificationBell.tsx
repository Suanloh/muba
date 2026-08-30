"use client";
/**
 * Notification bell in the header — unread badge + popover showing the
 * persistent per-payment feed, plus the global sound mute toggle.
 */
import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { formatDateTime } from "@/lib/pipeline/format";

const KIND_DOT: Record<string, string> = {
  info: "var(--signal-text)",
  success: "var(--ledger-text)",
  warning: "var(--ember-text)",
  error: "var(--alarm-text)",
};

export function NotificationBell() {
  const { notifications, notificationFeed, dismissNotification, soundEnabled, setSoundEnabled } =
    useAppStore();
  const [open, setOpen] = useState(false);

  const unread = notifications.length;
  const recent = notificationFeed.slice(0, 6);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface text-muted transition hover:text-ink"
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 20a2 2 0 0 1-3.4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alarm px-1 font-mono text-[9px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-[14px] border border-hairline bg-surface p-3 shadow-pop">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Notifications</p>
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                <span aria-hidden="true">{soundEnabled ? "🔊" : "🔇"}</span>
                <span className="sr-only">Sound effects</span>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--signal)]"
                />
              </label>
            </div>

            {recent.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted">No notifications yet.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {recent.map((n) => (
                  <li key={n.id} className="flex items-start gap-2.5 rounded-[10px] px-1.5 py-2 hover:bg-surface-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: KIND_DOT[n.kind] ?? "var(--text-faint)" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{n.message}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-faint">{formatDateTime(n.at)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => dismissNotification(n.id)}
                      aria-label="Dismiss"
                      className="text-[11px] text-faint hover:text-ink"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
