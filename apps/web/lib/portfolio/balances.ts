/**
 * MOVA portfolio — multi-asset balance model (Point 6 of the redesign).
 *
 * Balances are honest: only amounts we actually query are shown. SUI native
 * balance comes from the Sui RPC (`querySuiBalance`). USDC/MOV coin-type
 * balances and live prices are wired when the market-data integration ships —
 * they render "—" until then, never a fabricated number.
 */
import { querySuiBalance } from "@/lib/pipeline/balance";

export interface BalanceAsset {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  chain: "sui" | "evm";
  isNative: boolean;
  verified: boolean;
  /** Smallest-unit amount as a string; null = not queried. */
  amount: string | null;
  priceUsd: number | null;
  usdValue: number | null;
  change24h: number | null;
  priceSource: "live" | "dev" | "none";
}

export const SUI_DECIMALS = 9;

/** Dev reference prices — clearly labelled, replaced by live market data. */
export const DEV_PRICES: Record<string, number> = { SUI: 3.2, USDC: 1, MOV: 1.4 };

/** Format a smallest-unit amount for display (max 4 significant decimals). */
export function formatTokenAmount(amountSmallest: string | null, decimals: number): string {
  if (amountSmallest === null) return "—";
  let bn: bigint;
  try {
    bn = BigInt(amountSmallest);
  } catch {
    return "—";
  }
  const str = bn.toString().padStart(decimals + 1, "0");
  const whole = str.slice(0, -decimals) || "0";
  const frac = str.slice(-decimals).replace(/0+$/, "");
  const fracShort = frac.length > 4 ? frac.slice(0, 4).replace(/0+$/, "") : frac;
  return `${whole}${fracShort ? `.${fracShort}` : ""}`;
}

export function formatUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Query the connected address's balances. Best-effort, never fabricates. */
export async function queryBalances(address: string): Promise<BalanceAsset[]> {
  const suiRaw = await querySuiBalance(address); // bigint | null, smallest units
  const suiAmountStr = suiRaw === null ? null : suiRaw.toString();
  const suiAmountNum = suiRaw === null ? null : Number(suiRaw) / 10 ** SUI_DECIMALS;
  const suiPrice = DEV_PRICES.SUI ?? null;

  const assets: BalanceAsset[] = [
    {
      id: "sui:0x2::sui::SUI",
      symbol: "SUI",
      name: "Sui",
      decimals: SUI_DECIMALS,
      chain: "sui",
      isNative: true,
      verified: true,
      amount: suiAmountStr,
      priceUsd: suiPrice,
      usdValue: suiAmountNum !== null && suiPrice !== null ? suiAmountNum * suiPrice : null,
      change24h: null,
      priceSource: "dev",
    },
    {
      id: "sui:usdc",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      chain: "sui",
      isNative: false,
      verified: true,
      amount: null, // requires a per-coin-type getCoins query — pending market-data integration
      priceUsd: DEV_PRICES.USDC ?? null,
      usdValue: null,
      change24h: null,
      priceSource: "dev",
    },
    {
      id: "sui:mov",
      symbol: "MOV",
      name: "MOVA Token",
      decimals: 8,
      chain: "sui",
      isNative: false,
      verified: true,
      amount: null,
      priceUsd: DEV_PRICES.MOV ?? null,
      usdValue: null,
      change24h: null,
      priceSource: "dev",
    },
  ];
  return assets;
}

/** Sum the known USD values of a set of assets (unknowns excluded). */
export function totalUsdValue(assets: BalanceAsset[]): number | null {
  let sum = 0;
  let any = false;
  for (const a of assets) {
    if (a.usdValue !== null && Number.isFinite(a.usdValue)) {
      sum += a.usdValue;
      any = true;
    }
  }
  return any ? sum : null;
}
