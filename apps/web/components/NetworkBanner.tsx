"use client";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import {
  DAPP_NETWORKS,
  type DappNetwork,
} from "@/lib/wallet/networks";
import { Badge, Button } from "./ui";

/**
 * Network detection + switching/error handling.
 * Shows the MOVA expected network vs the wallet's detected chain, and lets the
 * user switch the app network (and the demo wallet's chain).
 */
export function NetworkBanner() {
  const { network, appNetwork, switchNetwork, connection } = useMovaWallet();

  if (connection.status !== "connected") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="font-medium">Network</p>
        <p className="mt-1 text-xs">
          Expected <Badge tone="blue">{network.expected}</Badge> — connect a wallet to detect its chain.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium text-slate-700">Network</p>
      <div className="mt-2 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Wallet chain</span>
          <Badge tone={network.matches ? "green" : "red"}>
            {network.detectedChain ?? "unknown"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">MOVA expected</span>
          <Badge tone="blue">{network.expected}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">App network</span>
          <Badge tone="slate">{appNetwork ?? "—"}</Badge>
        </div>

        {!network.matches && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {network.unknown
              ? "MOVA could not detect the wallet's chain. Switch it in your wallet, or select the expected network below."
              : `Wallet is on ${network.detectedNetwork}, but MOVA expects ${network.expected}. Payments will be refused until they match.`}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          {DAPP_NETWORKS.map((n: DappNetwork) => (
            <Button
              key={n}
              variant={appNetwork === n ? "primary" : "secondary"}
              className="!px-2.5 !py-1 text-xs"
              onClick={() => switchNetwork(n)}
            >
              {n}
            </Button>
          ))}
        </div>
        {network.expected !== network.detectedNetwork && network.detectedNetwork !== null && (
          <p className="mt-1 text-xs text-slate-500">
            Tip: switch the wallet itself to {network.expected} if your wallet exposes its own network picker.
          </p>
        )}
      </div>
    </div>
  );
}
