"use client";
/**
 * Network / Chain switcher — used in the header (pill + popover), the sidebar
 * ecosystem rail, and the multi-ecosystem bottom bar sheet.
 *
 * Sui chains switch via the existing `switchNetwork(DappNetwork)`; EVM chains
 * switch via the dependency-free EVM adapter (read/sign only until EVM
 * settlement ships). Everything renders from `lib/chrome/chains.ts`.
 */
import { useCallback, useState } from "react";
import { useMovaWallet } from "@/lib/wallet/mova-wallet-context";
import { useEVM } from "@/lib/wallet/evm/hook";
import { EVM_CHAINS, SUI_CHAINS, type ChainOption } from "@/lib/chrome/chains";

export interface ChainActions {
  activeSuiKey: string | null;
  activeEvmKey: string | null;
  evmConnected: boolean;
  onSelect: (chain: ChainOption) => void;
  error: string | null;
  clearError: () => void;
}

/** Shared chain-selection logic (header popover, sidebar rail, bottom sheet). */
export function useChainActions(): ChainActions {
  const { appNetwork, switchNetwork } = useMovaWallet();
  const evm = useEVM();
  const [error, setError] = useState<string | null>(null);

  const activeSuiKey = appNetwork ? `sui:${appNetwork}` : null;
  const activeEvmKey = evm.connection.chainId
    ? (EVM_CHAINS.find((c) => c.evmChainId === evm.connection.chainId)?.key ?? null)
    : null;

  const onSelect = useCallback(
    (chain: ChainOption) => {
      setError(null);
      if (chain.ecosystem === "sui" && chain.dappNetwork) {
        switchNetwork(chain.dappNetwork);
      } else if (chain.ecosystem === "evm" && chain.evmChainId) {
        if (evm.connection.status !== "connected") {
          setError("Connect an EVM wallet first (Account menu) — EVM is read-only today.");
          return;
        }
        void evm
          .switchChain(chain.evmChainId)
          .catch((err) => setError(err instanceof Error ? err.message : String(err)));
      }
    },
    [switchNetwork, evm],
  );

  return {
    activeSuiKey,
    activeEvmKey,
    evmConnected: evm.connection.status === "connected",
    onSelect,
    error,
    clearError: () => setError(null),
  };
}

function ChainRow({
  chain,
  active,
  onSelect,
}: {
  chain: ChainOption;
  active: boolean;
  onSelect: (c: ChainOption) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(chain)}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm transition ${
        active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"
      }`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chain.colorVar }} />
      <span className="flex-1 truncate">{chain.label}</span>
      {chain.readonly && (
        <span className="rounded-full border border-hairline px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-faint">
          read
        </span>
      )}
      {active && <span className="font-mono text-xs text-signal-text">●</span>}
    </button>
  );
}

/** The full chain list, grouped by ecosystem (reused by header + bottom sheet). */
export function ChainList({ onClose }: { onClose?: () => void }) {
  const { activeSuiKey, activeEvmKey, evmConnected, onSelect, error, clearError } =
    useChainActions();

  const handleSelect = (c: ChainOption) => {
    onSelect(c);
    onClose?.();
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-[10px] border border-alarm-border bg-alarm-bg px-3 py-2 text-xs text-alarm-text">
          {error}
          <button type="button" onClick={clearError} className="ml-2 font-mono underline" aria-label="Dismiss">
            ✕
          </button>
        </p>
      )}
      <section>
        <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Sui</p>
        <div className="space-y-0.5">
          {SUI_CHAINS.map((c) => (
            <ChainRow key={c.key} chain={c} active={c.key === activeSuiKey} onSelect={handleSelect} />
          ))}
        </div>
      </section>
      <section>
        <p className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
          EVM {evmConnected ? "" : "· connect a wallet to switch"}
        </p>
        <div className="space-y-0.5">
          {EVM_CHAINS.map((c) => (
            <ChainRow key={c.key} chain={c} active={c.key === activeEvmKey} onSelect={handleSelect} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Compact pill + popover for the header bar. */
export function ChainSwitcher() {
  const { appNetwork } = useMovaWallet();
  const evm = useEVM();
  const [open, setOpen] = useState(false);

  const suiActive = SUI_CHAINS.find((c) => c.dappNetwork === appNetwork);
  const evmActive = EVM_CHAINS.find((c) => c.evmChainId === evm.connection.chainId);
  const active =
    (evm.connection.status === "connected" && evmActive ? evmActive : suiActive) ??
    SUI_CHAINS[0]!;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-9 items-center gap-2 rounded-full border border-hairline bg-surface px-3 text-xs font-medium text-muted transition hover:border-hairline-strong hover:text-ink"
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: active.colorVar }} />
        <span className="hidden max-w-[110px] truncate sm:inline">{active.label}</span>
        <svg className="h-3.5 w-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-40 mt-2 w-72 rounded-[14px] border border-hairline bg-surface p-3 shadow-pop">
            <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
              Network
            </p>
            <ChainList onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
