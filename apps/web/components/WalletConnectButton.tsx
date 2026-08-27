"use client";
import { useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { shortAddress } from "@/lib/pipeline/format";
import { Button, Badge } from "./ui";

export function WalletConnectButton() {
  const { connection, wallets, connect, disconnect, error } = useMovaWallet();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  if (connection.status === "connected" && connection.account) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-slate-700">{connection.providerName}</p>
          <p className="font-mono text-xs text-slate-500">{shortAddress(connection.account.address)}</p>
        </div>
        <Badge tone="green">Connected</Badge>
        <Button variant="secondary" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      {error && <p className="mb-1 max-w-xs text-xs text-rose-600">{error}</p>}
      <Button onClick={() => setOpen((v) => !v)} disabled={busy || connection.status === "connecting"}>
        {connection.status === "connecting" ? "Connecting…" : "Connect wallet"}
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Choose a Sui wallet
            </p>
            {connectError && <p className="mb-2 text-xs text-rose-600">{connectError}</p>}
            <div className="max-h-72 space-y-1 overflow-auto">
              {wallets.length === 0 && (
                <p className="py-3 text-center text-xs text-slate-500">
                  No wallets detected. Install Sui Wallet, or enable the Demo Wallet.
                </p>
              )}
              {wallets.map((w) => (
                <button
                  key={w.name}
                  onClick={() => {
                    setBusy(true);
                    setConnectError(null);
                    void connect(w)
                      .then(() => setOpen(false))
                      .catch((err: unknown) => setConnectError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false));
                  }}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {w.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.icon} alt="" className="h-7 w-7 rounded-lg" />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-200 text-xs font-bold">
                      {w.name[0]?.toUpperCase()}
                    </span>
                  )}
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
