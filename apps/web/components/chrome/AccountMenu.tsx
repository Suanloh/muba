"use client";
/**
 * Wallet pill in the header — the "account" entry point. Shows a compact
 * connected state (Sui or EVM) with the wallet value + a menu, or a primary
 * "Connect wallet" button opening the grouped multi-ecosystem picker.
 */
import { useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useEVM } from "@/lib/wallet/evm/hook";
import { useAppStore } from "@/lib/store/app-store";
import { shortAddress } from "@/lib/pipeline/format";
import { formatUsd, MOCK_PORTFOLIO } from "@/lib/portfolio/mock-data";
import { Button } from "@/components/ui";
import { AccountPanel } from "./AccountPanel";

export function AccountMenu() {
  const sui = useMovaWallet();
  const evm = useEVM();
  const { setView } = useAppStore();
  const [open, setOpen] = useState(false);

  const suiConnected = sui.connection.status === "connected" && sui.connection.account;
  const evmConnected = evm.connection.status === "connected";
  const connecting = sui.connection.status === "connecting" || evm.connection.status === "connecting";

  const address = suiConnected
    ? sui.connection.account!.address
    : evmConnected
      ? evm.connection.address
      : null;
  const dot = suiConnected ? "var(--ledger)" : evmConnected ? "var(--chain-base)" : "var(--text-faint)";

  const portfolio = MOCK_PORTFOLIO;

  return (
    <div className="relative">
      {suiConnected || evmConnected ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-9 max-w-[220px] items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-xs transition hover:border-hairline-strong"
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />
          <span className="hidden truncate font-medium text-ink sm:inline">
            {formatUsd(MOCK_PORTFOLIO.totalUsd)}
          </span>
          <span className="truncate font-mono text-muted">{address ? shortAddress(address, 6, 4) : "—"}</span>
        </button>
      ) : (
        <Button onClick={() => setOpen((v) => !v)} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </Button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-[14px] border border-hairline bg-surface p-3 shadow-pop">
            {/* Compact portfolio strip — keeps the portfolio reachable on touch, too. */}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setView("portfolio");
              }}
              className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-hairline bg-surface-2 px-3 py-2 text-left transition hover:border-hairline-strong"
            >
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                  Portfolio
                </span>
                <span className="font-display text-[15px] font-semibold text-ink">
                  {formatUsd(portfolio.totalUsd)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ledger-text">
                  ▲ {portfolio.totalChange24hPct.toFixed(1)}%
                </span>
                <span className="font-mono text-[10px] text-faint">View →</span>
              </span>
            </button>
            <div className="my-2 border-t border-hairline" />
            <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              Account & wallets
            </p>
            <AccountPanel onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
