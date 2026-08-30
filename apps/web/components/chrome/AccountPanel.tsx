"use client";
/**
 * Account panel — the grouped multi-ecosystem wallet picker + connected
 * account info. Rendered inside the header `AccountMenu` popover and the
 * mobile bottom-bar account sheet.
 *
 * Sui wallets connect via `@mysten/dapp-kit` (Wallet Standard); EVM wallets
 * connect via the dependency-free EIP-1193/6963 adapter (read/sign only).
 */
import { useState } from "react";
import type { UiWallet } from "@mysten/dapp-kit-react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useEVM } from "@/lib/wallet/evm/hook";
import type { EvmProviderInfo } from "@/lib/wallet/evm/types";
import { EVM_CHAINS } from "@/lib/chrome/chains";
import { shortAddress } from "@/lib/pipeline/format";
import { Badge, Button } from "@/components/ui";

function evmExplorerUrl(chainId: string | null, address: string): string | null {
  const chain = EVM_CHAINS.find((c) => c.evmChainId === chainId);
  return chain ? `${chain.explorerUrl}/address/${address}` : null;
}

export function AccountPanel({ onClose }: { onClose?: () => void }) {
  const sui = useMovaWallet();
  const evm = useEVM();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const suiConnected = sui.connection.status === "connected" && sui.connection.account;
  const evmConnected = evm.connection.status === "connected";

  const copy = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(label);
    window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1200);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const connectSui = (w: UiWallet) => run(() => sui.connect(w));
  const connectEvm = (p: EvmProviderInfo) => run(() => evm.connect(p));

  const explorerUrl = (address: string) =>
    `https://suiscan.xyz/${sui.appNetwork ?? "testnet"}/account/${address}`;

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-[10px] border border-alarm-border bg-alarm-bg px-3 py-2 text-xs text-alarm-text">
          {error}
        </p>
      )}

      {!suiConnected && !evmConnected && (
        <>
          {/* ---- Sui wallets ---- */}
          <section>
            <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              Sui wallets
            </p>
            {sui.wallets.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                No Sui wallet detected. Install Sui Wallet, or enable the Demo Wallet.
              </p>
            ) : (
              <div className="space-y-1">
                {sui.wallets.map((w) => (
                  <button
                    key={w.name}
                    type="button"
                    disabled={busy}
                    onClick={() => connectSui(w)}
                    className="flex w-full items-center gap-3 rounded-[10px] border border-hairline bg-surface px-3 py-2 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.icon} alt="" className="h-6 w-6 rounded-md" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-xs font-bold text-ink">
                        {w.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="flex-1 truncate">{w.name}</span>
                    <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[9px] uppercase text-faint">
                      Sui
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---- EVM wallets ---- */}
          <section>
            <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              EVM wallets · read-only
            </p>
            {evm.providers.length === 0 ? (
              <p className="px-1 text-xs text-muted">
                No EVM wallet detected (MetaMask, Rabby…). Connect one to view EVM balances & sign.
              </p>
            ) : (
              <div className="space-y-1">
                {evm.providers.map((p) => (
                  <button
                    key={p.uuid}
                    type="button"
                    disabled={busy}
                    onClick={() => connectEvm(p)}
                    className="flex w-full items-center gap-3 rounded-[10px] border border-hairline bg-surface px-3 py-2 text-left text-sm text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                  >
                    {p.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.icon} alt="" className="h-6 w-6 rounded-md" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-xs font-bold text-ink">
                        {p.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[9px] uppercase text-faint">
                      EVM
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* ---- Connected: Sui ---- */}
      {suiConnected && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink">Sui account</p>
            <Badge tone="green">connected</Badge>
          </div>
          <div className="rounded-[12px] border border-hairline bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-ink">
                {sui.connection.account ? shortAddress(sui.connection.account.address) : "—"}
              </span>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => sui.connection.account && copy("sui", sui.connection.account.address)}>
                {copied === "sui" ? "Copied ✓" : "Copy"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Provider: {sui.connection.providerName ?? "wallet"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sui.connection.account && (
                <a href={explorerUrl(sui.connection.account.address)} target="_blank" rel="noreferrer" className="text-xs text-signal-text underline decoration-dotted">
                  View on SuiScan ↗
                </a>
              )}
              <button type="button" onClick={() => run(() => sui.disconnect())} disabled={busy} className="text-xs text-alarm-text underline decoration-dotted disabled:opacity-50">
                Disconnect
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ---- Connected: EVM ---- */}
      {evmConnected && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-ink">EVM account</p>
            <Badge tone="violet">connected · read-only</Badge>
          </div>
          <div className="rounded-[12px] border border-hairline bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-ink">
                {evm.connection.address ? shortAddress(evm.connection.address, 6, 6) : "—"}
              </span>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => evm.connection.address && copy("evm", evm.connection.address)}>
                {copied === "evm" ? "Copied ✓" : "Copy"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Provider: {evm.connection.provider?.name ?? "wallet"} ·{" "}
              {EVM_CHAINS.find((c) => c.evmChainId === evm.connection.chainId)?.label ?? evm.connection.chainId ?? "—"}
              {evm.balance !== null ? ` · ${(Number(evm.balance) / 1e18).toFixed(4)} ETH` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {evm.connection.address && evmExplorerUrl(evm.connection.chainId, evm.connection.address) && (
                <a href={evmExplorerUrl(evm.connection.chainId, evm.connection.address)!} target="_blank" rel="noreferrer" className="text-xs text-signal-text underline decoration-dotted">
                  View on explorer ↗
                </a>
              )}
              <button type="button" onClick={() => evm.disconnect()} className="text-xs text-alarm-text underline decoration-dotted">
                Disconnect
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
