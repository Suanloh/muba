"use client";
/**
 * MOVA Phase 7 — Approval & Execution panel.
 *
 * Once the human approved the preview (in `PaymentPreviewPanel`), this panel
 * is the "Authorize & execute" step: wallet authz (signature) → execution →
 * Sui settlement. Nothing reaches EXECUTING without an APPROVE decision bound
 * to the plan digest, and no record can execute twice (idempotency).
 */
import { useState } from "react";
import { failureLabel, failureUserMessage } from "@mova/core";
import { useAppStore } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { WEB_SETTLEMENT_MODE } from "@/lib/wallet/networks";
import { formatMoney, shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

export function ApprovalPanel() {
  const { records, plans, activeRecordId, execute } = useAppStore();
  const { connection } = useMovaWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const record = records.find((r) => r.id === activeRecordId) ?? null;
  const plan = record ? plans[record.id] : undefined;
  const connected = connection.status === "connected";

  if (!record) {
    return (
      <Card title="Approval & execution" subtitle="Human approval is required before any execution.">
        <p className="text-sm text-slate-500">No active payment.</p>
      </Card>
    );
  }

  const awaiting = record.state === "AWAITING_APPROVAL";
  const approved = record.state === "APPROVED";
  const executed = record.state === "SETTLED";
  const failed = record.state === "FAILED";
  const disabled = !connected || !plan;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await execute(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const failure = record.execution?.failure ?? null;

  return (
    <Card
      title="Approval & execution"
      subtitle={`${shortId(record.id)} · ${formatMoney(record.amount)} · to ${record.recipient.value}`}
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">State</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={failed ? "red" : awaiting ? "amber" : approved || executed ? "green" : "slate"}>
              {record.state}
            </Badge>
            {plan && <Badge tone="violet">plan {plan.spec.planDigest.slice(0, 10)}…</Badge>}
          </div>
        </div>

        {awaiting && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            This payment has passed validation, routing, compliance, and risk. Review the{" "}
            <span className="font-medium">Payment preview</span> and approve it there — until then, execution is
            structurally refused.
          </div>
        )}
        {approved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            Approved. A wallet-scoped <span className="font-medium">PaymentAuthz</span> bound to the plan digest was
            issued. The next step requires the wallet owner to authorize execution (signature), which then{" "}
            {WEB_SETTLEMENT_MODE === "real"
              ? "attempts a REAL on-chain settlement (falls back to simulated if the wallet can't fund/submit)."
              : "runs a simulated settlement."}
          </div>
        )}
        {executed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {record.settlement?.simulated === false && record.settlement?.txDigest ? (
              <>
                Settled <span className="font-medium">on-chain (real testnet)</span> — digest{" "}
                <a
                  href={`https://suiscan.xyz/testnet/tx/${record.settlement.txDigest}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sky-700 underline decoration-dotted"
                >
                  {record.settlement.txDigest.slice(0, 18)}…
                </a>
                . A receipt was issued to the owning address.
              </>
            ) : record.settlement?.error ? (
              <>
                Settled (simulated fallback). <span className="text-amber-700">{record.settlement.error}</span> A
                receipt was issued.
              </>
            ) : (
              <>Settled (simulated). A receipt was issued to the owning address. No real value moved.</>
            )}
          </div>
        )}
        {failed && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {failure ? (
              <>
                <span className="font-semibold">{failureLabel(failure.code)}</span> — {failureUserMessage(failure)}
              </>
            ) : (
              <>This payment failed or was rejected and will never be executed.</>
            )}
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        {approved && (
          <Button variant="success" disabled={disabled || busy} onClick={() => void run()}>
            {busy
              ? "Authorizing & settling…"
              : WEB_SETTLEMENT_MODE === "real"
                ? "Authorize & execute (real)"
                : "Authorize & execute (simulated)"}
          </Button>
        )}

        {!connected && <p className="text-xs text-slate-500">Connect the owning wallet to approve or execute.</p>}
      </div>
    </Card>
  );
}

