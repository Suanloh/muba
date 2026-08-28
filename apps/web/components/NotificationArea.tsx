"use client";
import { useAppStore } from "@/lib/store/app-store";

/** Notification / status area — fixed toasts, top-right. */
export function NotificationArea() {
  const { notifications, dismissNotification } = useAppStore();

  if (notifications.length === 0) return null;

  const tones: Record<string, string> = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  };

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {notifications.slice(-4).map((n) => (
        <div
          key={n.id}
          className={`pointer-events-auto rounded-lg border px-3 py-2.5 text-sm shadow-sm ${tones[n.kind]}`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">{n.title}</p>
            <button
              onClick={() => dismissNotification(n.id)}
              className="text-xs opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <p className="mt-0.5 text-xs opacity-90">{n.message}</p>
        </div>
      ))}
    </div>
  );
}
