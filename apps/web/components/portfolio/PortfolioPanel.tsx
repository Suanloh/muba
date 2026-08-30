"use client";
/**
 * MOVA demo Portfolio panel (requirement: Portfolio embedded in Home + shown
 * on hover over "Connect wallet"). Renders the hardcoded mock snapshot from
 * `lib/portfolio/mock-data.ts` — wallet balances, asset allocations and
 * performance metrics — clearly labelled as demo data. Reused by:
 *   - the Home page embed (full)
 *   - the wallet-button hover popover (compact via `compact`)
 */
import { Badge, Card } from "@/components/ui";
import {
  allocationPct,
  formatAmount,
  formatUsd,
  MOCK_PORTFOLIO,
} from "@/lib/portfolio/mock-data";

function changeClass(pct: number): string {
  if (pct > 0) return "text-ledger-text";
  if (pct < 0) return "text-alarm-text";
  return "text-faint";
}

function AssetRow({ symbol, name, amount, usdValue, change24hPct, color }: {
  symbol: string;
  name: string;
  amount: number;
  usdValue: number;
  change24hPct: number;
  color: string;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-xs font-bold"
          style={{ backgroundColor: "color-mix(in srgb, " + color + " 22%, var(--surface-2))", color }}
        >
          {symbol[0] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-ink">{symbol}</span>
            {name && <span className="hidden truncate text-[11px] text-faint sm:inline">{name}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1 w-full max-w-[110px] overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${Math.max(3, allocationPct({ symbol, name, chain: "sui", amount, usdValue, change24hPct, color }, MOCK_PORTFOLIO.totalUsd))}%`, backgroundColor: color }} />
            </div>
            <span className="font-mono text-[10px] text-faint">
              {allocationPct({ symbol, name, chain: "sui", amount, usdValue, change24hPct, color }, MOCK_PORTFOLIO.totalUsd).toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm text-ink">{formatAmount(amount)}</p>
          <p className={`font-mono text-[11px] ${changeClass(change24hPct)}`}>
            {formatUsd(usdValue)} · {change24hPct > 0 ? "▲" : change24hPct < 0 ? "▼" : ""}{change24hPct.toFixed(2)}%
          </p>
        </div>
      </div>
    </li>
  );
}

export function PortfolioPanel({ compact = false }: { compact?: boolean }) {
  const p = MOCK_PORTFOLIO;
  const totalPositive = p.totalChange24hPct >= 0;

  return (
    <Card
      title="Portfolio"
      subtitle={
        <span className="flex items-center gap-2">
          <span>Balances on your wallet</span>
          <Badge tone="amber">demo data</Badge>
          {!compact && <span className="font-mono text-faint">{p.addressLabel}</span>}
        </span>
      }
    >
      {/* Total + 24h */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Total value</p>
          <p className="font-display text-[26px] font-semibold tracking-[-0.01em] text-ink">
            {formatUsd(p.totalUsd)}
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${
            totalPositive
              ? "border-ledger-border bg-ledger-bg text-ledger-text"
              : "border-alarm-border bg-alarm-bg text-alarm-text"
          }`}
        >
          {totalPositive ? "▲" : "▼"} {Math.abs(p.totalChange24hPct).toFixed(1)}% 24h
        </span>
      </div>

      {/* Balances */}
      <ul className="mt-3 divide-y divide-hairline">
        {p.assets.filter((a) => a.usdValue > 0).map((a) => (
          <AssetRow key={a.symbol} {...a} />
        ))}
      </ul>

      {/* Allocation breakdown */}
      {!compact && (
        <div className="mt-4 rounded-[12px] border border-hairline bg-surface-2 p-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
            Asset allocation
          </p>
          <div className="flex h-2 w-full overflow-hidden rounded-full">
            {p.assets.filter((a) => a.usdValue > 0).map((a) => (
              <div
                key={a.symbol}
                style={{ width: `${allocationPct(a, p.totalUsd)}%`, backgroundColor: a.color }}
                title={`${a.symbol} ${allocationPct(a, p.totalUsd).toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {p.assets.filter((a) => a.usdValue > 0).map((a) => (
              <span key={a.symbol} className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                <span className="font-mono">{a.symbol}</span>
                <span className="font-mono text-faint">{allocationPct(a, p.totalUsd).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance metrics */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {p.performance.map((m) => (
          <div key={m.label} className="rounded-[10px] border border-hairline bg-surface-2 px-2 py-2 text-center">
            <p className="font-mono text-[10px] uppercase text-faint">{m.label}</p>
            <p className={`font-mono text-[13px] font-semibold ${m.valuePct >= 0 ? "text-ledger-text" : "text-alarm-text"}`}>
              {m.valuePct >= 0 ? "+" : ""}
              {m.valuePct.toFixed(1)}%
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] text-faint">
        Hardcoded demo snapshot — live balances are read in the Portfolio view.
      </p>
    </Card>
  );
}
