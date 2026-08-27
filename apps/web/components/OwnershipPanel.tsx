"use client";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useAppStore } from "@/lib/store/app-store";
import { shortAddress, shortId } from "@/lib/pipeline/format";
import { Badge, Card, Code } from "./ui";

/**
 * The Sui ownership model made visible: ownership anchor, payment
 * authorizations, records, and receipts — all bound to the user's address.
 */
export function OwnershipPanel() {
  const { connection, network } = useMovaWallet();
  const { records, receipts } = useAppStore();

  const owner = connection.status === "connected" ? connection.account?.address ?? null : null;
  const authz = records.find((r) => r.authz)?.authz ?? null;
  const ownedRecords = owner ? records.filter((r) => r.ownerAddress === owner.toLowerCase()) : [];
  const ownedReceipts = owner ? receipts.filter((r) => r.ownerAddress === owner.toLowerCase()) : [];

  return (
    <Card title="Sui ownership model" subtitle="Payment state is anchored to your Sui address — not to MOVA.">
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-xs font-medium text-slate-600">Ownership anchor</p>
          {owner ? (
            <div className="mt-1 flex items-center gap-2">
              <Code>{shortAddress(owner)}</Code>
              <Badge tone="green">user-owned</Badge>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Connect a wallet to establish the anchor.</p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Expected chain: <Badge tone="blue">{network.expected}</Badge>
          </p>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600">Payment authorization (PaymentAuthz)</p>
          {authz ? (
            <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
              <p>Bound to {shortAddress(authz.ownerAddress)} · {authz.amount.amount} {authz.amount.asset}</p>
              <p className="mt-0.5 font-mono text-[11px]">nonce {authz.nonce.slice(0, 10)}… · expires {new Date(authz.expiresAt).toLocaleTimeString()}</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              Issued only after an <span className="font-medium">APPROVE</span> human decision. None yet.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <div>
            <p className="text-xs font-medium text-slate-600">Payment records</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{ownedRecords.length}</p>
            {ownedRecords.slice(0, 3).map((r) => (
              <p key={r.id} className="mt-1 truncate font-mono text-[11px] text-slate-500">
                {shortId(r.id)} · {r.state}
              </p>
            ))}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-600">Receipts (owned)</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{ownedReceipts.length}</p>
            {ownedReceipts.slice(0, 3).map((r) => (
              <p key={r.id} className="mt-1 truncate font-mono text-[11px] text-slate-500">
                {shortId(r.id)} {r.simulated ? "· simulated" : ""}
              </p>
            ))}
          </div>
        </div>

        <p className="border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">
          Phase 2 mirrors these as Sui-owned Move objects (<Code>contracts/mova</Code>):{" "}
          <Code>MovaPaymentAuthz</Code>, <Code>OwnedPaymentRecord</Code>, <Code>MovaReceipt</Code>.
        </p>
      </div>
    </Card>
  );
}
