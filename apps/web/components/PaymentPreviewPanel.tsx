"use client";
/**
 * MOVA Phase 7 — Payment Preview & Human Approval.
 *
 * Shows the user EVERYTHING they need to understand before approving: the
 * recipient, amount, asset, selected route, fees, savings, compliance status,
 * financial risk, hedge (if relevant), expected settlement, the Sui
 * destination, and the exact plan digest they are signing off on.
 *
 * Human approval is explicit: the Approve button stays disabled until the user
 * ticks "I understand what this executes". A BLOCK verdict (compliance or risk)
 * disables approval entirely. Rejection records a USER_REJECTED failure and
 * nothing is ever executed.
 */
import { useState } from "react";
import { failureLabel, failureUserMessage } from "@mova/core";
import type { PaymentPreview } from "@mova/types";
import { useAppStore } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { formatMoney, shortAddress, shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

function bandTone(band: string): "green" | "blue" | "amber" | "red" {
  switch (band) {
    case "LOW":
      return "green";
    case "MEDIUM":
      return "blue";
    case "HIGH":
      return "amber";
    default:
      return "red";
  }
}

function complianceTone(decision: string): "green" | "amber" | "red" {
  return decision === "ALLOW" ? "green" : decision === "REVIEW" ? "amber" : "red";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right text-xs font-medium text-slate-700">{children}</span>
    </div>
  );
}

export function PaymentPreviewPanel() {
  const {
    records,
    plans,
    activeRecordId,
    acknowledged,
    setAcknowledged,
    approve,
    reject,
  } = useAppStore();
  const { connection } = useMovaWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const record = records.find((r) => r.id === activeRecordId) ?? null;
  const plan = record ? plans[record.id] : undefined;
  const preview: PaymentPreview | null = plan?.preview ?? null;
  const connected = connection.status === "connected";

  const awaiting = record?.state === "AWAITING_APPROVAL";
  const approved = record?.state === "APPROVED";
  const failed = record?.state === "FAILED";
  const blocked =
    !!preview && (preview.compliance.decision === "BLOCK" || preview.risk.decision === "BLOCK");

  const isAcknowledged = record ? (acknowledged[record.id] ?? false) : false;

  const run = async (action: "approve" | "reject") => {
    if (!record) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "approve") await approve(record.id);
      else await reject(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!record) {
    return (
      <Card title="Payment preview" subtitle="Phase 7 — the full deterministic picture before you approve.">
        <p className="text-sm text-slate-500">No active payment. Create one to review the preview, then approve.</p>
      </Card>
    );
  }

  if (!preview || !plan) {
    return (
      <Card title="Payment preview" subtitle={`${shortId(record.id)} · awaiting plan`}>
        <p className="text-sm text-slate-500">Building the deterministic payment plan…</p>
      </Card>
    );
  }

  return (
    <Card
      title="Payment preview"
      subtitle={
        <>
          <span className="font-mono">{shortId(record.id)}</span> · plan digest{" "}
          <span className="font-mono text-sky-700">{preview.planDigest.slice(0, 16)}…</span>
        </>
      }
    >
      {/* Verdict badges */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={complianceTone(preview.compliance.decision)}>Compliance {preview.compliance.decision}</Badge>
        <Badge tone={bandTone(preview.risk.band)}>Risk {preview.risk.band} · {preview.risk.score}/100</Badge>
        <Badge tone={preview.risk.decision === "BLOCK" ? "red" : preview.risk.decision === "REVIEW" ? "amber" : "green"}>
          {preview.risk.decision}
        </Badge>
        <Badge tone={preview.hedge.decision === "HEDGE" ? "violet" : "slate"}>
          {preview.hedge.decision === "HEDGE" ? `Hedge ${preview.hedge.strategy}` : "No hedge"}
        </Badge>
        <Badge tone={preview.expectedSettlement === "REAL" ? "green" : "amber"}>
          Settlement {preview.expectedSettlement}
        </Badge>
      </div>

      {/* Recipient, amount, asset, destination */}
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What will be sent</h3>
        <Row label="Amount">{formatMoney(preview.amount)}</Row>
        <Row label="Asset">{preview.amount.asset}</Row>
        <Row label="Recipient">
          {preview.recipient.name ?? <span className="font-mono">{shortAddress(preview.suiDestination, 10, 8)}</span>}
        </Row>
        <Row label="Sui destination">
          <span className="font-mono">{shortAddress(preview.suiDestination, 12, 10)}</span>
        </Row>
        <Row label="Expected settlement">
          {preview.expectedSettlement === "REAL" ? "Real on-chain (testnet)" : "Simulated (no value moves)"}
        </Row>
      </div>

      {/* Route, fees, savings */}
      <div className="mt-3 rounded-lg border border-slate-100 p-3">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Route & cost</h3>
        <Row label="Route">#{preview.route.routeNo} · {preview.route.summary.legOrder.join(" → ")}</Row>
        <Row label="Fees">{formatMoney(preview.route.totalFee)}</Row>
        <Row label="Total cost">{formatMoney(preview.totalCost)}</Row>
        <Row label="Est. time">{Math.round(preview.route.estimatedTimeMs / 1000)}s</Row>
        <Row label="Reliability">{(preview.route.reliability * 100).toFixed(0)}%</Row>
        {preview.savings && (
          <>
            <Row label="Cheapest route">#{preview.savings.cheapestRouteNo} ({formatMoney(preview.savings.cheapestTotalCost)})</Row>
            <Row label="Savings vs worst">
              <span className="text-emerald-600">{formatMoney(preview.savings.estimatedSavings)}</span>
            </Row>
          </>
        )}
        <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">{preview.route.selectionReason}</p>
      </div>

      {/* Compliance, risk, hedge */}
      <div className="mt-3 rounded-lg border border-slate-100 p-3 text-xs">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Compliance</h3>
        <p className="text-slate-600">{preview.compliance.explanation}</p>
        {preview.compliance.matchedLists.length > 0 && (
          <p className="mt-1 text-rose-600">Matched: {preview.compliance.matchedLists.join(", ")}</p>
        )}
        <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Financial risk</h3>
        <p className="whitespace-pre-wrap text-slate-600">{preview.risk.explanation}</p>
        <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hedge</h3>
        <p className="text-slate-600">
          {preview.hedge.decision === "HEDGE"
            ? `${preview.hedge.strategy} via ${preview.hedge.dataSource} — premium ${formatMoney(preview.hedge.premium)}, removes ${formatMoney(preview.hedge.exposureReduction)} of exposure. ${preview.hedge.explanation}`
            : `No hedge (${preview.hedge.dataSource}). ${preview.hedge.explanation}`}
        </p>
      </div>

      {/* Blocked / failure state */}
      {blocked && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          This payment was <span className="font-semibold">blocked</span> by a deterministic engine (
          {preview.compliance.decision === "BLOCK" ? "compliance" : "risk"}) — it can never be approved or executed.
          {failed && record.execution?.failure && (
            <span className="mt-1 block">{failureUserMessage(record.execution.failure)}</span>
          )}
        </div>
      )}
      {failed && !blocked && record.execution?.failure && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <span className="font-semibold">{failureLabel(record.execution.failure.code)}</span> — {record.execution.failure.message}
        </div>
      )}

      {/* Approval */}
      {awaiting && !blocked && (
        <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="flex cursor-pointer items-start gap-2 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={isAcknowledged}
              onChange={(e) => setAcknowledged(record.id, e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-sky-600"
            />
            <span>
              I understand this executes <span className="font-semibold">{formatMoney(preview.amount)}</span> to{" "}
              <span className="font-mono">{shortAddress(preview.suiDestination, 10, 8)}</span> on {plan.spec.network}{" "}
              via route #{preview.route.routeNo}, with a{" "}
              {preview.expectedSettlement === "REAL" ? "real on-chain" : "simulated"} settlement. Plan digest{" "}
              <span className="font-mono">{preview.planDigest.slice(0, 12)}…</span>.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!connected || !isAcknowledged || busy !== null}
              onClick={() => void run("approve")}
            >
              {busy === "approve" ? "Approving…" : "Approve payment"}
            </Button>
            <Button variant="danger" disabled={!connected || busy !== null} onClick={() => void run("reject")}>
              Reject
            </Button>
          </div>
          {!connected && <p className="text-xs text-amber-800">Connect the owning wallet to approve.</p>}
        </div>
      )}

      {approved && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          Approved. The wallet authz is bound to plan digest{" "}
          <span className="font-mono">{preview.planDigest.slice(0, 16)}…</span>. Proceed to <span className="font-medium">Authorize & execute</span> below.
        </div>
      )}

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}
