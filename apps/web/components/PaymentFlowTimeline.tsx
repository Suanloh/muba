"use client";
import { PAYMENT_STATES } from "@mova/types";
import { useAppStore } from "@/lib/store/app-store";
import { formatMoney, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";

const LABELS: Record<string, string> = {
  CREATED: "Created",
  PARSED: "Parsed",
  ROUTE_FOUND: "Route",
  COMPLIANCE_CHECKED: "Compliance",
  RISK_ASSESSED: "Risk",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  EXECUTING: "Executing",
  SETTLED: "Settled",
  FAILED: "Failed",
};

/** State-machine timeline for the active payment. */
export function PaymentFlowTimeline() {
  const { records, activeRecordId, setActiveRecordId } = useAppStore();
  const record = records.find((r) => r.id === activeRecordId) ?? records[0] ?? null;

  if (!record) {
    return (
      <Card title="Payment flow" subtitle="The @mova/types state machine.">
        <p className="text-sm text-slate-500">No payment yet. Create one to see the flow: Intent → Validation → Approval → Wallet authz → Execution.</p>
      </Card>
    );
  }

  const currentIndex = PAYMENT_STATES.indexOf(record.state);
  const isFailed = record.state === "FAILED";

  return (
    <Card
      title="Payment flow"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · {formatMoney(record.amount)} · owner{" "}
          <span className="font-mono">{record.ownerAddress.slice(0, 10)}…</span>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {PAYMENT_STATES.map((state, i) => {
          const done = !isFailed && i < currentIndex;
          const current = state === record.state;
          return (
            <div key={state} className="flex items-center gap-1.5">
              <span
                className={
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium " +
                  (isFailed && state === "FAILED"
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : current
                      ? "border-sky-500 bg-sky-600 text-white"
                      : done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-400")
                }
              >
                {LABELS[state] ?? state}
              </span>
              {i < PAYMENT_STATES.length - 1 && <span className="text-slate-300">→</span>}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>
          State: <Badge tone={isFailed ? "red" : currentIndex >= 6 ? "green" : "blue"}>{record.state}</Badge>
        </span>
        <div className="flex gap-1.5">
          {records.slice(0, 5).map((r) => (
            <button
              key={r.id}
              onClick={() => setActiveRecordId(r.id)}
              className={"rounded-md border px-2 py-0.5 font-mono text-[10px] " + (r.id === record.id ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
            >
              {shortId(r.id, 8)}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
