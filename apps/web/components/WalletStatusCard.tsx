"use client";
import { useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import type { OwnershipProof } from "@mova/wallet";
import { shortAddress } from "@/lib/pipeline/format";
import { Badge, Button, Card, Code } from "./ui";

/**
 * Connected-wallet status + ownership proof (Sign-In-With-Sui).
 * Demonstrates that user identity (the Sui address) is available to the app.
 */
export function WalletStatusCard() {
  const { connection, requestOwnershipProof, verifyOwnershipProof } = useMovaWallet();
  const [proof, setProof] = useState<OwnershipProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = connection.status === "connected" && connection.account;

  const proveOwnership = async () => {
    setBusy(true);
    setError(null);
    setVerified(null);
    try {
      const p = await requestOwnershipProof();
      setProof(p);
      const ok = await verifyOwnershipProof(p);
      setVerified(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Wallet & identity" subtitle="The connected Sui address is the ownership anchor.">
      {!connected ? (
        <p className="text-sm text-slate-500">No wallet connected. Connect above to begin.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Address</span>
            <Code>{shortAddress(connection.account!.address)}</Code>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Provider</span>
            <Badge tone="violet">{connection.providerName ?? "wallet"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Status</span>
            <Badge tone="green">connected</Badge>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-600">Ownership proof (sign-in-with-Sui)</p>
            <Button variant="secondary" onClick={() => void proveOwnership()} disabled={busy} className="w-full">
              {busy ? "Waiting for signature…" : proof ? "Re-prove ownership" : "Prove ownership"}
            </Button>
            {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
            {proof && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">Signed challenge (nonce {proof.nonce.slice(0, 8)}…)</p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{proof.message}</p>
                <div className="mt-2">
                  {verified === null && <Badge tone="slate">verifying…</Badge>}
                  {verified === true && <Badge tone="green">Signature verified ✓</Badge>}
                  {verified === false && <Badge tone="red">Signature invalid ✗</Badge>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
