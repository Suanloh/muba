"use client";
/**
 * MOVA Phase 8 — Audit Trail.
 *
 * The immutable, append-only decision log for the active payment: original
 * intent, parsed intent, route candidates + selected route + cost, compliance
 * verdict, risk assessment, hedge decision, user approval, and execution
 * result. Projected deterministically from `AuditEvent`s — the UI never invents
 * a decision the engines didn't emit. Each row's payload is expandable for
 * full transparency.
 */
import { useMemo, useState } from "react";
import { buildAuditTrail } from "@mova/core";
import { PAYMENT_AUDIT_STAGES, type PaymentAuditEntry } from "@mova/types";
import { useAppStore } from "@/lib/store/app-store";
import { formatDateTime, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";

const OUTCOME_TONE: Record<string, "green" | "red" | "amber" | "blue" | "slate" | "violet"> = {
  SETTLED: "green",
  CONFIRMED: "green",
  ALLOW: "green",
  PROCEED: "green",
  APPROVED: "green",
  HEDGE: "violet",
  FAILED: "red",
  BLOCK: "red",
  REVIEW: "amber",
  REJECTED: "red",
  AWAITING_APPROVAL: "amber",
  PENDING: "amber",
  EXECUTING: "blue",
  NO_HEDGE: "slate",
};

export function AuditTrailPanel() {
  const { records, audit, activeRecordId } = useAppStore();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;

  const trail = useMemo(
    () => (record ? buildAuditTrail(audit, record.correlationId) : null),
    [record, audit],
  );

  if (!record || !trail) {
    return (
      <Card title="Audit trail" subtitle="Every decision, recorded immutably.">
        <p className="text-sm text-slate-500">No payment yet — the decision log will appear here.</p>
      </Card>
    );
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const grouped = PAYMENT_AUDIT_STAGES.map((stage) => ({
    stage,
    entries: trail.entries.filter((e) => e.stage === stage),
  })).filter((g) => g.entries.length > 0);

  return (
    <Card
      title="Audit trail"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · {trail.entries.length} decision
          {trail.entries.length === 1 ? "" : "s"} ·{" "}
          {trail.terminal ? (
            <Badge tone={record.state === "SETTLED" ? "green" : "red"}>{record.state}</Badge>
          ) : (
            <Badge tone="blue">{trail.currentState ?? "…"}</Badge>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {grouped.map(({ stage, entries }) => (
          <div key={stage}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {entries[0]?.label ?? stage}
            </p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {entries.map((e) => (
                <AuditRow key={e.id} entry={e} open={open.has(e.id)} onToggle={() => toggle(e.id)} />
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <p className="text-xs text-slate-500">No audit events recorded for this payment yet.</p>
        )}
      </div>
    </Card>
  );
}

function AuditRow({
  entry,
  open,
  onToggle,
}: {
  entry: PaymentAuditEntry;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = OUTCOME_TONE[entry.outcome] ?? "slate";
  return (
    <div className="px-3 py-2.5">
      <button onClick={onToggle} className="flex w-full items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-slate-700">{entry.eventType}</span>
            <Badge tone={tone}>{entry.outcome}</Badge>
            {entry.simulated && <span className="text-[10px] text-slate-400">simulated</span>}
          </div>
          {entry.detail && <p className="mt-0.5 text-xs text-slate-600">{entry.detail}</p>}
          <p className="mt-0.5 text-[11px] text-slate-400">
            by {entry.actor.type}:{entry.actor.id.slice(0, 18)} · {formatDateTime(entry.at)}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
