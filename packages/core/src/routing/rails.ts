/**
 * Payment rail catalog for the routing engine.
 *
 * Each supported rail has deterministic, versioned parameters: fee basis
 * points, optional fixed fee, execution time, and 0..1 reliability /
 * liquidity / risk factor. These numbers are DATA (a versioned catalog), not
 * LLM output — they are the same inputs a real provider table would expose.
 *
 * MOVA always settles on Sui: the ONCHAIN leg moves the settlement token on
 * the Sui chain and the SETTLEMENT leg delivers it to the recipient.
 */
import type { RouteLegKind } from "@mova/types";

/** Deterministic parameters of one payment rail. */
export interface RailParams {
  kind: RouteLegKind;
  /** Fee as basis points of the leg notional (10000 = 100%). */
  feeBps: number;
  /** Optional fixed fee (e.g. Sui gas), in `fixedFee.asset`. */
  fixedFee?: { asset: string; amount: string };
  /** Base execution time of this leg. */
  timeMs: number;
  /** Deterministic 0..1 reliability. */
  reliability: number;
  /** Deterministic 0..1 liquidity. */
  liquidity: number;
  /** Deterministic 0..1 risk factor (higher = riskier). */
  riskFactor: number;
  /** Estimated slippage in basis points (CONVERSION legs only). */
  slippageBps?: number;
}

export type RailName =
  | "SUI_CHAIN" // on-chain transfer of a token on Sui
  | "SUI_SETTLEMENT" // final settlement to the recipient on Sui
  | "MOVA_DEX" // Sui DEX/aggregator conversion
  | "MOVA_ONRAMP" // fiat -> token on-ramp conversion
  | "MOVA_FIAT_RAIL"; // off-chain fiat leg (bank/e-wallet/card rail)

/** Versioned default catalog. */
export const DEFAULT_RAILS: Readonly<Record<RailName, RailParams>> = {
  SUI_CHAIN: {
    kind: "ONCHAIN",
    feeBps: 0,
    fixedFee: { asset: "SUI", amount: "1000000" }, // 0.001 SUI gas
    timeMs: 2500,
    reliability: 0.99,
    liquidity: 1,
    riskFactor: 0.01,
  },
  SUI_SETTLEMENT: {
    kind: "SETTLEMENT",
    feeBps: 0,
    timeMs: 500,
    reliability: 0.99,
    liquidity: 1,
    riskFactor: 0.01,
  },
  MOVA_DEX: {
    kind: "CONVERSION",
    feeBps: 20, // 0.20% swap fee
    slippageBps: 30, // 0.30% estimated slippage
    timeMs: 6000,
    reliability: 0.97,
    liquidity: 0.95,
    riskFactor: 0.06,
  },
  MOVA_ONRAMP: {
    kind: "CONVERSION",
    feeBps: 150, // 1.50% on-ramp fee
    slippageBps: 20, // 0.20%
    timeMs: 600000, // ~10 min
    reliability: 0.9,
    liquidity: 0.8,
    riskFactor: 0.2,
  },
  MOVA_FIAT_RAIL: {
    kind: "OFFCHAIN",
    feeBps: 100, // 1.00% cross-border fee
    timeMs: 900000, // ~15 min
    reliability: 0.85,
    liquidity: 0.7,
    riskFactor: 0.25,
  },
};

/** Resolved catalog with defaults merged over any user overrides. */
export class RailCatalog {
  readonly rails: Readonly<Record<RailName, RailParams>>;

  constructor(overrides?: Partial<Record<RailName, Partial<RailParams>>>) {
    const merged = { ...DEFAULT_RAILS } as Record<RailName, RailParams>;
    if (overrides) {
      for (const [name, params] of Object.entries(overrides)) {
        const key = name as RailName;
        if (params) merged[key] = { ...merged[key], ...params };
      }
    }
    this.rails = merged;
  }

  get(name: RailName): RailParams {
    return this.rails[name];
  }
}
