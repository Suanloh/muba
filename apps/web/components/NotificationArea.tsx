"use client";
import { useAppStore } from "@/lib/store/app-store";
import { Toast } from "./notifications/Toast";

/**
 * Notification / toast stack — fixed, top-right on desktop, top-center on
 * mobile (clear of the bottom bar). Max 4 toasts, token-styled, with
 * auto-dismiss progress. The persistent per-payment feed lives in the
 * Notification Center (bell + NotificationsPanel).
 */
export function NotificationArea() {
  const { notifications, dismissNotification } = useAppStore();

  if (notifications.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-80"
      aria-live="polite"
      aria-atomic="false"
    >
      {notifications.slice(-4).map((n) => (
        <Toast key={n.id} n={n} onDismiss={() => dismissNotification(n.id)} />
      ))}
    </div>
  );
}
