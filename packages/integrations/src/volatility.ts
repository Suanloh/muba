/**
 * Volatility providers — deterministic market-volatility snapshots consumed by
 * the Phase 6 risk engine (Value-at-Risk model).
 *
 * The `VolatilityProvider` is a replaceable sponsor boundary, like
 * `MarketDataProvider` / `HedgingProvider`. A real Thetanuts integration can
 * derive implied volatility from the V4 OptionBook greeks (`greeks.iv`);
 * the static dev provider serves a versioned, cached reference table marked
 * `simulated: true`. MOVA never treats dev data as live.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { HedgeDataSource, ProviderDescriptor, VolatilitySnapshot } from "@mova/types";

export interface VolatilityRequest {
  asset: string;
  /** Exposure horizon in days (annualized → daily scaling). */
  horizonDays: number;
  /** Confidence level for Value-at-Risk (0..1, e.g. 0.95). */
  confidenceLevel: number;
}

export interface VolatilityProvider {
  readonly descriptor: ProviderDescriptor;
  getVolatility(request: VolatilityRequest): Promise<VolatilitySnapshot>;
}

export interface StaticVolatilityOptions {
  allowed: boolean;
  /**
   * Versioned dev table: asset -> annualized vol (0.20 = 20%). This is a
   * CACHED / STATIC reference table for dev & demo only — never live data.
   */
  annualizedVol?: Record<string, number>;
}

/** Reference annualized volatilities (dev/demo cache — NOT live). */
const DEFAULT_ANNUALIZED_VOL: Record<string, number> = {
  SUI: 0.55, // high-beta layer-1 (dev reference)
  ETH: 0.60, // thetanuts-supported underlying (dev reference)
  BTC: 0.40, // thetanuts-supported underlying (dev reference)
  USDC: 0.01, // stablecoin — near-zero drift
  MOV: 0.85, // long-tail project token (dev reference)
  USD: 0.005, // fiat base — negligible
  MYR: 0.02, // fiat — small managed float
  EUR: 0.01,
  SGD: 0.01,
  HKD: 0.005,
  AED: 0.005,
};

/**
 * Deterministic static/dev volatility provider. Serves the cached reference
 * table ONLY when allowed (dev/demo boundary) and always marks the snapshot
 * `simulated: true`, `source: "STATIC_DEV_TABLE"` — never presented as live.
 */
export class StaticVolatilityProvider implements VolatilityProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "STATIC_VOLATILITY_DEV",
    network: null,
  };

  constructor(private readonly options: StaticVolatilityOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "StaticVolatilityProvider is not permitted in this runtime boundary",
      );
    }
  }

  private annualizedVolFor(asset: string): number | null {
    const table = this.options.annualizedVol ?? DEFAULT_ANNUALIZED_VOL;
    return table[asset] ?? null;
  }

  async getVolatility(request: VolatilityRequest): Promise<VolatilitySnapshot> {
    this.assertAllowed();
    const annualizedVol = this.annualizedVolFor(request.asset);
    if (annualizedVol === null || annualizedVol === undefined) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `no static dev volatility reference for ${request.asset}`,
      );
    }
    const dailyVol = annualizedVol / Math.sqrt(365);
    return {
      asset: request.asset,
      annualizedVol,
      dailyVol,
      horizonDays: request.horizonDays,
      confidenceLevel: request.confidenceLevel,
      source: "STATIC_DEV_TABLE",
      simulated: true,
      asOf: Date.now(),
    };
  }
}

/** Convenience type alias for the honest provenance labels used by providers. */
export type { HedgeDataSource };
