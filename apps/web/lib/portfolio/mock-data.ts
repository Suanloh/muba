/**
 * MOVA demo portfolio — hardcoded mock data (hackathon showcase).
 *
 * The prototype brief asks for a Portfolio revealed on hover over "Connect
 * wallet" with wallet balances, asset allocations and performance metrics.
 * This is the explicitly-labelled DEMO dataset behind it. It is decorative:
 * real balances live in `BalanceCard` (honest RPC reads); this file feeds the
 * Home-page embed and the wallet-button hover popover with a rich, readable
 * snapshot for the demo.
 */

export interface MockPortfolioAsset {
  symbol: string;
  name: string;
  chain: "sui" | "evm";
  /** Display balance (human units, not smallest units). */
  amount: number;
  usdValue: number;
  /** Per-asset 24h change. */
  change24hPct: number;
  /** Allocation bar colour (a CSS var reference). */
  color: string;
}

export interface MockPortfolioPerformance {
  label: string;
  valuePct: number;
}

export interface MockPortfolio {
  label: string;
  addressLabel: string;
  totalUsd: number;
  totalChange24hPct: number;
  assets: MockPortfolioAsset[];
  performance: MockPortfolioPerformance[];
}

/** Deterministic hardcoded snapshot — clearly a demo, never mistaken for live. */
export const MOCK_PORTFOLIO: MockPortfolio = {
  label: "Demo portfolio",
  addressLabel: "0xea17…9c2f",
  totalUsd: 4214.5,
  totalChange24hPct: 1.8,
  assets: [
    {
      symbol: "USDC",
      name: "USD Coin",
      chain: "sui",
      amount: 2500.0,
      usdValue: 2500.0,
      change24hPct: 0.01,
      color: "var(--signal)",
    },
    {
      symbol: "SUI",
      name: "Sui",
      chain: "sui",
      amount: 320.5,
      usdValue: 1025.6,
      change24hPct: 3.4,
      color: "var(--chain-sui)",
    },
    {
      symbol: "MOV",
      name: "MOVA Token",
      chain: "sui",
      amount: 492.0,
      usdValue: 688.8,
      change24hPct: 1.2,
      color: "var(--ledger)",
    },
    {
      symbol: "ETH",
      name: "Ethereum",
      chain: "evm",
      amount: 0.0, // read-only EVM — included to show the allocation pie
      usdValue: 0.0,
      change24hPct: 0.0,
      color: "var(--chain-eth)",
    },
  ],
  performance: [
    { label: "1h", valuePct: 0.2 },
    { label: "24h", valuePct: 1.8 },
    { label: "7d", valuePct: 4.2 },
    { label: "30d", valuePct: 12.6 },
  ],
};

/** Percentage share of total for each asset (for the allocation bars). */
export function allocationPct(asset: MockPortfolioAsset, totalUsd: number): number {
  if (totalUsd <= 0) return 0;
  return (asset.usdValue / totalUsd) * 100;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
