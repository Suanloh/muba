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
import { Badge, Button, Card } from "./ui";

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
  // Hidden by default — revealed only when the user requests an audit report.
  const [requested, setRequested] = useState(false);
  const [exported, setExported] = useState(false);
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

  /** Export the full audit report — every phase, raw decision payloads included. */
  const exportReport = () => {
    const report = {
      title: "MOVA payment audit report",
      generatedAt: new Date().toISOString(),
      record: {
        id: record.id,
        correlationId: record.correlationId,
        state: record.state,
        amount: record.amount,
        recipient: record.recipient,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        approval: record.approval ?? null,
        execution: record.execution ?? null,
        settlement: record.settlement ?? null,
      },
      lifecycle: trail.statusSteps,
      phases: PAYMENT_AUDIT_STAGES.map((stage) => ({
        stage,
        entries: trail.entries.filter((e) => e.stage === stage),
      })).filter((g) => g.entries.length > 0),
      currentState: trail.currentState,
      terminal: trail.terminal,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mova-audit-report-${record.id.slice(0, 12)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 3000);
  };

  // Hidden until the user requests the audit report via the file button.
  if (!requested) {
    return (
      <Card title="Audit trail" subtitle="Immutable decision log — hidden until you request it">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-500">{shortId(record.id)}</span>
          <Badge tone={trail.terminal ? (record.state === "SETTLED" ? "green" : "red") : "blue"}>
            {trail.currentState ?? record.state}
          </Badge>
          <span className="text-xs text-slate-500">
            {trail.entries.length} decision{trail.entries.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          The full report covers every phase — intent → parse → route → compliance → risk → hedge →
          approval → execution — including the raw decision payloads. Export it or review it here.
        </p>
        <Button variant="primary" className="mt-3 gap-2" onClick={() => setRequested(true)}>
          <FileIcon /> Request audit report
        </Button>
      </Card>
    );
  }

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
      {/* Report toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="gap-2 text-xs" onClick={exportReport}>
          <DownloadIcon /> Export report (.json)
        </Button>
        {exported && <span className="font-mono text-[11px] text-emerald-600">✓ exported</span>}
        <Button variant="ghost" className="ml-auto text-xs" onClick={() => setRequested(false)}>
          Hide report
        </Button>
      </div>

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

function FileIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v5h5M9 13h6M9 17h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
        <pre className="mt-2 max-h-64 overflow-auto rounded-[10px] bg-code p-3 font-mono text-[11px] leading-relaxed text-code-text">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
