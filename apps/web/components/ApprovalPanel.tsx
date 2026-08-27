"use client";
import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { formatMoney, shortId } from "@/lib/pipeline/format";
import { Badge, Button, Card } from "./ui";

/**
 * Human approval interface (the gate before execution) + wallet-authz execute
 * step. Nothing reaches EXECUTING without an APPROVE decision.
 */
export function ApprovalPanel() {
  const { records, activeRecordId, approve, reject, execute } = useAppStore();
  const { connection } = useMovaWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const record = records.find((r) => r.id === activeRecordId) ?? null;
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
  const disabled = !connected;

  const run = async (action: "approve" | "reject" | "execute") => {
    setBusy(action);
    setError(null);
    try {
      if (action === "approve") await approve(record.id);
      else if (action === "reject") await reject(record.id);
      else await execute(record.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Approval & execution"
      subtitle={`${shortId(record.id)} · ${formatMoney(record.amount)} · to ${record.recipient.value}`}
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">State</span>
          <Badge tone={failed ? "red" : awaiting ? "amber" : approved || executed ? "green" : "slate"}>
            {record.state}
          </Badge>
        </div>

        {awaiting && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            This payment has passed validation, routing, compliance, and risk (simulated). It is now waiting for
            an explicit human approval from the owning wallet. Without approval, execution is structurally refused.
          </div>
        )}
        {approved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            Approved. A wallet-scoped <span className="font-medium">PaymentAuthz</span> was issued. The next step
            requires the wallet owner to authorize execution (signature), which then runs a simulated settlement.
          </div>
        )}
        {executed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            Settled (simulated). A receipt was issued to the owning address. No real value moved — real Sui
            settlement arrives in Phase 2.
          </div>
        )}
        {failed && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            This payment failed or was rejected and will never be executed.
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {awaiting && (
            <>
              <Button variant="primary" disabled={disabled || busy !== null} onClick={() => void run("approve")}>
                {busy === "approve" ? "Approving…" : "Approve payment"}
              </Button>
              <Button variant="danger" disabled={disabled || busy !== null} onClick={() => void run("reject")}>
                Reject
              </Button>
            </>
          )}
          {approved && (
            <Button
              variant="primary"
              disabled={disabled || busy !== null || !connection.account}
              onClick={() => void run("execute")}
            >
              {busy === "execute" ? "Authorizing & settling…" : "Authorize & execute (simulated)"}
            </Button>
          )}
        </div>

        {!connected && <p className="text-xs text-slate-500">Connect the owning wallet to approve or execute.</p>}
      </div>
    </Card>
  );
}
