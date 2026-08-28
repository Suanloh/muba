"use client";
/**
 * MOVA Phase 8 — Payment notifications.
 *
 * The persistent, per-payment notification feed: approval required, payment
 * executing, payment completed, payment failed. Lightweight toasts still appear
 * top-right; this panel keeps the traceable history bound to each record so
 * nothing is lost when a toast is dismissed.
 */
import { useAppStore } from "@/lib/store/app-store";
import { formatDateTime, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";

type BadgeTone = "slate" | "green" | "amber" | "red" | "blue" | "violet";

const TONES: Record<string, { badge: BadgeTone; dot: string; label: string }> = {
  "Approval required": { badge: "amber", dot: "bg-amber-400", label: "approval" },
  "Review required": { badge: "amber", dot: "bg-amber-400", label: "review" },
  "Hedge recommended": { badge: "violet", dot: "bg-violet-400", label: "hedge" },
  "Approved": { badge: "green", dot: "bg-emerald-400", label: "approved" },
  "Payment executing": { badge: "blue", dot: "bg-sky-400", label: "executing" },
  "Payment completed": { badge: "green", dot: "bg-emerald-400", label: "completed" },
  "Payment completed (real testnet)": { badge: "green", dot: "bg-emerald-400", label: "completed" },
  "Payment completed (simulated fallback)": { badge: "green", dot: "bg-emerald-400", label: "completed" },
  "Payment failed": { badge: "red", dot: "bg-rose-400", label: "failed" },
};

export function NotificationsPanel() {
  const { notificationFeed, records, activeRecordId } = useAppStore();
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;

  if (!record) {
    return (
      <Card title="Notifications" subtitle="Per-payment event feed.">
        <p className="text-sm text-slate-500">No payment yet.</p>
      </Card>
    );
  }

  const feed = notificationFeed.filter((n) => n.recordId === record.id);

  return (
    <Card
      title="Notifications"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · {feed.length} event{feed.length === 1 ? "" : "s"}
        </>
      }
    >
      {feed.length === 0 ? (
        <p className="text-xs text-slate-500">No payment events yet for this record.</p>
      ) : (
        <ol className="space-y-2">
          {feed.map((n) => {
            const t = TONES[n.title];
            return (
              <li key={n.id} className="flex items-start gap-2.5">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t?.dot ?? "bg-slate-300"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-700">{n.title}</span>
                    {t && <Badge tone={t.badge}>{t.label}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{n.message}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{formatDateTime(n.at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
