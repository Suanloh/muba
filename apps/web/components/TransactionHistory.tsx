"use client";
import { useAppStore } from "@/lib/store/app-store";
import { formatMoney, shortAddress, shortId } from "@/lib/pipeline/format";
import { Badge, Card } from "./ui";

/** Txn history: payment records + receipts, bound to the owner. */
export function TransactionHistory() {
  const { records, receipts } = useAppStore();

  if (records.length === 0) {
    return (
      <Card title="Transaction history" subtitle="Records & receipts owned by your address.">
        <p className="text-sm text-slate-500">No transactions yet.</p>
      </Card>
    );
  }

  return (
    <Card title="Transaction history" subtitle="Records & receipts owned by your address.">
      <div className="divide-y divide-slate-100">
        {records.map((r) => {
          const receipt = receipts.find((rc) => rc.paymentRecordId === r.id);
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs text-slate-700">{shortId(r.id)}</span>
                  <Badge tone={r.state === "SETTLED" ? "green" : r.state === "FAILED" ? "red" : r.state === "AWAITING_APPROVAL" ? "amber" : "slate"}>
                    {r.state}
                  </Badge>
                  {r.settlement?.simulated && <Badge tone="violet">simulated</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {formatMoney(r.amount)} → {shortAddress(r.recipient.value, 8, 6)}
                  {r.approval?.decision === "APPROVE" ? " · approved" : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-xs text-slate-700">{r.settlement?.txDigest ?? (r.settlement ? "no digest (simulated)" : "—")}</p>
                {receipt && <p className="mt-0.5 text-[11px] text-emerald-600">receipt {shortId(receipt.id, 10)}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
