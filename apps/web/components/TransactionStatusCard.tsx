"use client";
/**
 * MOVA Phase 8 — txn Status.
 *
 * The complete, timestamped lifecycle of the active payment — every state it
 * reached, WHO/WHEN/WHY — derived deterministically from the immutable audit
 * event stream (never from the LLM). Also surfaces the selected route and cost
 * so "where is my payment" is answerable at a glance.
 */
import { buildStatusTimeline, stateLabel } from "@mova/core";
import { useAppStore } from "@/lib/store/app-store";
import { formatDateTime, formatDuration, formatMoney, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";

export function TransactionStatusCard() {
  const { records, audit, plans, activeRecordId } = useAppStore();
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;

  if (!record) {
    return (
      <Card title="Txn status" subtitle="Complete lifecycle tracking, timestamped.">
        <p className="text-sm text-slate-500">No payment yet. Create one to trace it from intent to settlement.</p>
      </Card>
    );
  }

  const plan = plans[record.id];
  const steps = buildStatusTimeline(audit, record.correlationId);
  const route = plan?.preview.route;
  const terminal = record.state === "SETTLED" || record.state === "FAILED";

  const tone =
    record.state === "SETTLED"
      ? "green"
      : record.state === "FAILED"
        ? "red"
        : record.state === "AWAITING_APPROVAL"
          ? "amber"
          : record.state === "EXECUTING" || record.state === "APPROVED"
            ? "blue"
            : "slate";

  return (
    <Card
      title="Txn status"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · {formatMoney(record.amount)} →{" "}
          <span className="font-mono">{record.recipient.value.slice(0, 12)}…</span> · created {formatDateTime(record.createdAt)}
        </>
      }
    >
      {/* Current state + key facts */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={tone}>{record.state}</Badge>
        {record.settlement?.simulated && <Badge tone="violet">simulated</Badge>}
        {record.settlement && !record.settlement.simulated && <Badge tone="green">real on-chain</Badge>}
        <span className="ml-auto text-xs text-slate-500">updated {formatDateTime(record.updatedAt)}</span>
      </div>

      {/* Route & cost (when planned) */}
      {route && (
        <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs sm:grid-cols-2">
          <div>
            <span className="text-slate-500">Route</span>{" "}
            <span className="font-mono text-slate-800">
              #{route.routeNo} {route.summary.legOrder.join("→")}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Total cost</span>{" "}
            <span className="font-medium text-slate-800">{formatMoney(plan!.preview.totalCost)}</span>
          </div>
          <div>
            <span className="text-slate-500">Fees</span>{" "}
            <span className="text-slate-800">{formatMoney(route.totalFee)}</span>
          </div>
          <div>
            <span className="text-slate-500">Est. time</span>{" "}
            <span className="text-slate-800">{formatDuration(route.estimatedTimeMs)}</span>
          </div>
          {route.selectionReason && (
            <p className="sm:col-span-2 text-slate-600">
              <span className="text-slate-500">Why: </span>
              {route.selectionReason}
            </p>
          )}
        </div>
      )}

      {/* Timestamped lifecycle timeline */}
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Lifecycle {steps.length > 0 && `· ${steps.length} step${steps.length === 1 ? "" : "s"}`}
        </p>
        {steps.length === 0 ? (
          <p className="text-xs text-slate-500">No audit events recorded yet — the lifecycle will appear here as it progresses.</p>
        ) : (
          <ol className="space-y-0">
            {steps.map((s, i) => {
              const isLast = i === steps.length - 1;
              const isCurrent = isLast && !terminal;
              const isFailed = s.state === "FAILED";
              return (
                <li key={`${s.state}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                  {!isLast && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
                  <span
                    className={
                      "relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 " +
                      (isFailed
                        ? "border-rose-400 bg-rose-100"
                        : isCurrent
                          ? "border-sky-500 bg-sky-500"
                          : terminal && isLast
                            ? "border-emerald-500 bg-emerald-500"
                            : "border-hairline-strong bg-surface")
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={"text-xs font-medium " + (isFailed ? "text-rose-700" : isCurrent ? "text-sky-700" : "text-slate-700")}>
                        {s.label}
                      </span>
                      <Badge tone={isFailed ? "red" : isCurrent ? "blue" : "slate"}>{s.state}</Badge>
                      {s.simulated && <span className="text-[10px] text-slate-400">simulated</span>}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      <span className="font-mono">{s.event}</span> · by {s.actor} · {formatDateTime(s.at)}
                    </p>
                    {s.detail && <p className="mt-0.5 text-[11px] text-slate-600">{s.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!terminal && (
          <p className="mt-2 text-[11px] text-slate-400">
            Terminal state: <span className="font-mono">{stateLabel(record.state)}</span> (next transition appends here).
          </p>
        )}
      </div>
    </Card>
  );
}
