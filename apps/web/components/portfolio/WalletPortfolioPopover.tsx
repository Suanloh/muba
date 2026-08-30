"use client";
/**
 * Wallet-portfolio hover popover (requirement 1).
 *
 * Revealed when hovering / interacting with the "Connect wallet" pill in the
 * header. Shows a compact mock portfolio (total, top balances, mini allocation
 * + performance) and a "View full portfolio" action that jumps to the
 * Portfolio view. Clearly labelled demo data.
 */
import { useAppStore } from "@/lib/store/app-store";
import { allocationPct, formatUsd, MOCK_PORTFOLIO } from "@/lib/portfolio/mock-data";
import { Badge } from "@/components/ui";

export function WalletPortfolioPopover({ onDone }: { onDone?: () => void }) {
  const { setView } = useAppStore();
  const p = MOCK_PORTFOLIO;
  const positive = p.totalChange24hPct >= 0;

  return (
    <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-[14px] border border-hairline bg-surface shadow-pop">
      {/* Header */}
      <div className="border-b border-hairline px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display text-[15px] font-semibold text-ink">Portfolio</p>
          <Badge tone="amber">demo data</Badge>
        </div>
        <p className="mt-0.5 font-mono text-[10px] text-faint">{p.addressLabel}</p>
      </div>

      {/* Total + 24h */}
      <div className="flex items-end justify-between px-4 pt-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint">Total value</p>
          <p className="font-display text-[22px] font-semibold leading-tight text-ink">{formatUsd(p.totalUsd)}</p>
        </div>
        <span
          className={`mb-0.5 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
            positive
              ? "border-ledger-border bg-ledger-bg text-ledger-text"
              : "border-alarm-border bg-alarm-bg text-alarm-text"
          }`}
        >
          {positive ? "▲" : "▼"} {Math.abs(p.totalChange24hPct).toFixed(1)}%
        </span>
      </div>

      {/* Top balances */}
      <ul className="px-4 py-2">
        {p.assets
          .filter((a) => a.usdValue > 0)
          .map((a) => (
            <li key={a.symbol} className="flex items-center gap-2.5 py-1.5">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[10px] font-bold"
                style={{ backgroundColor: "color-mix(in srgb, " + a.color + " 22%, var(--surface-2))", color: a.color }}
              >
                {a.symbol[0] ?? "?"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">{a.symbol}</span>
                  <span className="font-mono text-xs text-ink">{formatUsd(a.usdValue)}</span>
                </div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${allocationPct(a, p.totalUsd)}%`, backgroundColor: a.color }} />
                </div>
              </div>
            </li>
          ))}
      </ul>

      {/* Mini performance */}
      <div className="grid grid-cols-4 gap-1.5 px-4 pb-3">
        {p.performance.map((m) => (
          <div key={m.label} className="rounded-[8px] border border-hairline bg-surface-2 px-1 py-1 text-center">
            <p className="font-mono text-[9px] uppercase text-faint">{m.label}</p>
            <p className={`font-mono text-[11px] font-semibold ${m.valuePct >= 0 ? "text-ledger-text" : "text-alarm-text"}`}>
              {m.valuePct >= 0 ? "+" : ""}
              {m.valuePct.toFixed(1)}%
            </p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-hairline bg-surface-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            setView("portfolio");
            onDone?.();
          }}
          className="flex-1 rounded-[10px] border border-signal bg-signal px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
        >
          View full portfolio
        </button>
      </div>
    </div>
  );
}
