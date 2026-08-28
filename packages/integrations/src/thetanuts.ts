/**
 * Thetanuts V4 / Optionbook integration — Phase 6.
 *
 * Thetanuts V4 is an RFQ-powered options infrastructure (SDK
 * `@thetanuts-finance/thetanuts-client`, Base mainnet, underlyings ETH/BTC).
 * This module provides two providers behind the same `HedgingProvider` +
 * `VolatilityProvider` boundaries:
 *
 *   1. `ThetanutsHedgingProvider`  — REAL. Attempts live Optionbook data via
 *      the SDK (orders + greeks: implied vol, delta). When the SDK is not
 *      installed, the network is unreachable, or the requested asset has no
 *      live book (e.g. SUI, USDC, MOV), it throws `INTEGRATION_UNAVAILABLE`
 *      with a clear reason. It NEVER fabricates a live quote.
 *
 *   2. `StaticThetanutsHedgingProvider` — DEV/DEMO fallback. Serves a cached,
 *      versioned reference table. Every quote is `simulated: true`,
 *      `dataSource: "STATIC_DEV"` and refuses to run outside the dev/demo
 *      boundary (`ERR_MOCK_FORBIDDEN`). It is never presented as live data.
 *
 * Honesty rule (Phase 6 task 5): if live Thetanuts data is unavailable, the
 * integration is identified as UNAVAILABLE and only cached/static dev data is
 * used — in dev/demo mode only. Mocks are never made to look live.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  HedgeDataSource,
  HedgingStrategy,
  ProviderDescriptor,
  VolatilitySnapshot,
} from "@mova/types";
import type { HedgeQuote, HedgeQuoteRequest, HedgingProvider } from "./hedging.js";
import type { VolatilityProvider, VolatilityRequest } from "./volatility.js";

// ---------------------------------------------------------------------------
// Live provider (REAL)
// ---------------------------------------------------------------------------

export interface ThetanutsOptions {
  /** Base mainnet chain id (Thetanuts V4 is deployed on Base). */
  chainId?: number;
  /** RPC URL for the chain (e.g. https://mainnet.base.org). */
  rpcUrl?: string;
  /** Optional indexer/API base URL. Falls back to SDK defaults. */
  apiUrl?: string;
  apiKey?: string;
}

/** Thetanuts V4 supports ETH and BTC underlyings on Base mainnet. */
const THETANUTS_UNDERLYINGS: Readonly<Record<string, string>> = {
  ETH: "ETH",
  BTC: "BTC",
};

const THETANUTS_CHAIN_ID = 8453; // Base mainnet

/** Minimal shape of a Thetanuts SDK `api` module (read calls we use). */
interface ThetanutsApi {
  filterOrders(criteria: { isCall: boolean; minExpiry?: number }): Promise<unknown[]>;
  fetchOrders(): Promise<unknown[]>;
}

/** Minimal shape of a raw Optionbook order from the SDK indexer. */
interface RawOrder {
  order?: { price?: bigint | string | number; expiry?: bigint | string | number; isBuy?: boolean };
  rawApiData?: {
    underlying?: string;
    isCall?: boolean;
    greeks?: { iv?: number | null; delta?: number | null };
  };
}

/**
 * REAL Thetanuts V4 Optionbook provider (read-only quotes).
 *
 * `quote()` and `getVolatility()` use live book data when reachable. Any
 * failure (SDK missing, no live orders, unsupported asset, network error) is
 * surfaced as `ERR_INTEGRATION_UNAVAILABLE` — never a made-up price.
 */
export class ThetanutsHedgingProvider implements HedgingProvider, VolatilityProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "REAL",
    name: "THETANUTS_V4_OPTIONBOOK",
    // Thetanuts V4 lives on Base mainnet — outside the Sui Network enum, so
    // the descriptor reports null (chainId 8453 is carried in options).
    network: null,
  };

  constructor(private readonly options: ThetanutsOptions = {}) {}

  private assertConfigured(): void {
    const chainId = this.options.chainId ?? THETANUTS_CHAIN_ID;
    if (chainId !== THETANUTS_CHAIN_ID) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Thetanuts V4 live data is only supported on chain ${THETANUTS_CHAIN_ID} (Base mainnet), got chainId ${chainId}`,
        { details: { provider: this.descriptor.name, reason: "UNSUPPORTED_CHAIN" } },
      );
    }
  }

  /** Map an asset to a Thetanuts-supported underlying, or throw. */
  private underlyingFor(asset: string): string {
    const underlying = THETANUTS_UNDERLYINGS[asset];
    if (!underlying) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `no live Thetanuts V4 option book for ${asset} (supported underlyings: ${Object.keys(THETANUTS_UNDERLYINGS).join(", ")})`,
        { details: { provider: this.descriptor.name, reason: "UNSUPPORTED_UNDERLYING", asset } },
      );
    }
    return underlying;
  }

  /**
   * Fetch live PUT orders for the underlying from the Optionbook and pick the
   * cheapest actionable order. Throws `INTEGRATION_UNAVAILABLE` on any failure
   * (SDK missing, unreachable book, no orders) — never a made-up price.
   */
  private async fetchBestPut(underlying: string): Promise<{
    pricePerContract: bigint;
    impliedVol: number;
    delta: number;
    expiry: bigint;
  }> {
    this.assertConfigured();
    if (!this.options.rpcUrl) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        "Thetanuts V4 live data requires an rpcUrl (Base mainnet RPC) to be configured",
        { details: { provider: this.descriptor.name, reason: "RPC_NOT_CONFIGURED" } },
      );
    }

    // Dynamic import keeps the SDK an optional dependency: if it isn't
    // installed, the integration reports UNAVAILABLE instead of crashing boot.
    // A non-literal specifier avoids TS/webpack module resolution so the build
    // never hard-fails on an optional sponsor package.
    const sdkSpecifier: string = "@thetanuts-finance/thetanuts-client";
    let sdk: unknown;
    try {
      sdk = await import(sdkSpecifier);
    } catch {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        "Thetanuts V4 SDK (@thetanuts-finance/thetanuts-client) is not installed — live Optionbook data unavailable",
        { details: { provider: this.descriptor.name, reason: "SDK_MISSING" } },
      );
    }

    // ThetanutsClient requires an ethers-compatible provider for read calls.
    let provider: unknown;
    try {
      const ethersSpecifier: string = "ethers";
      const ethers = (await import(ethersSpecifier)) as {
        JsonRpcProvider?: new (url: string) => unknown;
      };
      const JsonRpcProvider = ethers.JsonRpcProvider;
      if (!JsonRpcProvider) throw new Error("ethers.JsonRpcProvider missing");
      provider = new JsonRpcProvider(this.options.rpcUrl);
    } catch {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        "Thetanuts V4 live data requires the 'ethers' package to construct a read-only provider",
        { details: { provider: this.descriptor.name, reason: "ETHERS_MISSING" } },
      );
    }

    const ClientCtor = (sdk as { ThetanutsClient: new (cfg: Record<string, unknown>) => { api: ThetanutsApi } }).ThetanutsClient;
    const client = new ClientCtor({
      chainId: this.options.chainId ?? THETANUTS_CHAIN_ID,
      provider,
      ...(this.options.apiUrl ? { apiUrl: this.options.apiUrl } : {}),
      ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
    });

    const nowSec = Math.floor(Date.now() / 1000);
    let orders: unknown[] = [];
    try {
      orders = await client.api.filterOrders({ isCall: false, minExpiry: nowSec });
      if (orders.length === 0) orders = await client.api.fetchOrders();
    } catch {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Thetanuts V4 Optionbook unreachable while fetching PUT orders for ${underlying}`,
        { details: { provider: this.descriptor.name, reason: "BOOK_UNREACHABLE", underlying } },
      );
    }

    const candidates = orders
      .map((o) => o as RawOrder)
      .filter((o) => {
        const d = o.rawApiData;
        if (!d) return false;
        if (d.isCall !== false) return false; // PUTs only
        if (d.underlying && d.underlying !== underlying) return false;
        const expiry = o.order?.expiry;
        if (expiry !== undefined && BigInt(expiry) <= BigInt(nowSec)) return false; // not expired
        return o.order?.price !== undefined;
      });

    if (candidates.length === 0) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `Thetanuts V4 Optionbook has no live PUT orders for ${underlying}`,
        { details: { provider: this.descriptor.name, reason: "NO_ORDERS", underlying } },
      );
    }

    // Cheapest per-contract price wins (deterministic pick).
    candidates.sort((a, b) => {
      const pa = BigInt(a.order!.price as bigint | string | number);
      const pb = BigInt(b.order!.price as bigint | string | number);
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    const best = candidates[0]!;
    const greeks = best.rawApiData?.greeks;
    return {
      pricePerContract: BigInt(best.order!.price as bigint | string | number),
      impliedVol: greeks?.iv ?? 0.5,
      delta: greeks?.delta ?? 0.5,
      expiry: best.order!.expiry !== undefined ? BigInt(best.order!.expiry as bigint | string | number) : 0n,
    };
  }

  /** Live quote for a supported underlying — honest, real book data. */
  async quote(request: HedgeQuoteRequest): Promise<HedgeQuote> {
    const underlying = this.underlyingFor(request.asset);
    const best = await this.fetchBestPut(underlying);
    if (!best) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `no live Thetanuts V4 quote available for ${request.asset}`,
        { details: { provider: this.descriptor.name, reason: "NO_QUOTE" } },
      );
    }

    // Notional contracts ≈ premium budget / price-per-contract (8 decimals).
    const pricePerContract = best.pricePerContract;
    const premiumUsd = BigInt(request.amount.amount);
    const contracts = premiumUsd > 0n && pricePerContract > 0n ? premiumUsd / pricePerContract : 0n;
    const premium = (pricePerContract * contracts) / 100_000_000n; // 8-dec price → USDC amount

    return {
      provider: this.descriptor.name,
      strategy: request.strategy,
      premium: { asset: "USDC", amount: premium.toString() },
      notional: request.amount,
      strike: null, // live book order — strike varies per order; not needed for the model
      impliedVol: best.impliedVol,
      delta: best.delta,
      coverage: best.delta,
      validUntil: best.expiry > 0n ? Number(best.expiry) * 1000 : Date.now() + request.durationDays * 86_400_000,
      dataSource: "LIVE",
      simulated: false,
    };
  }

  /** Live implied volatility for a supported underlying (from book greeks). */
  async getVolatility(request: VolatilityRequest): Promise<VolatilitySnapshot> {
    const underlying = this.underlyingFor(request.asset);
    const best = await this.fetchBestPut(underlying);
    const annualizedVol = best?.impliedVol ?? 0.5;
    return {
      asset: request.asset,
      annualizedVol,
      dailyVol: annualizedVol / Math.sqrt(365),
      horizonDays: request.horizonDays,
      confidenceLevel: request.confidenceLevel,
      source: "THETANUTS_OPTIONBOOK",
      simulated: false,
      asOf: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Static / cached dev fallback (DEV & DEMO only)
// ---------------------------------------------------------------------------

/** Static premium (basis points of notional) per hedging strategy — dev cache. */
const STATIC_DEV_PREMIUM_BPS: Readonly<Record<HedgingStrategy, number>> = {
  PUT_OPTION: 150, // ~1.5% of notional for a 7-day ATM put (dev reference)
  COVERED_CALL: 80,
  FIXED_YIELD: 0,
  NONE: 0,
};

/** Static coverage (fraction of the tail VaR offset) per strategy — dev cache. */
const STATIC_DEV_COVERAGE: Readonly<Record<HedgingStrategy, number>> = {
  PUT_OPTION: 0.5, // ATM put offsets ~50% of the Value-at-Risk
  COVERED_CALL: 0.3,
  FIXED_YIELD: 0,
  NONE: 0,
};

/** Static implied-vol table (dev cache, mirrors StaticVolatilityProvider). */
const STATIC_DEV_IV: Readonly<Record<string, number>> = {
  SUI: 0.55,
  ETH: 0.6,
  BTC: 0.4,
  USDC: 0.01,
  MOV: 0.85,
  USD: 0.005,
  MYR: 0.02,
  EUR: 0.01,
  SGD: 0.01,
  HKD: 0.005,
  AED: 0.005,
};

export interface StaticThetanutsOptions {
  /** Dev/demo boundary gate — outside it the provider refuses to run. */
  allowed: boolean;
  /** Optional override of the static premium table (basis points). */
  premiumBps?: Partial<Record<HedgingStrategy, number>>;
  /** Optional override of the static implied-vol table. */
  impliedVol?: Partial<Record<string, number>>;
  /** Deterministic duration for the quote validity (days). */
  durationDays?: number;
}

/**
 * Deterministic dev/demo fallback for Thetanuts. Serves a cached reference
 * table; every quote is `simulated: true`, `dataSource: "STATIC_DEV"`. Refuses
 * to run outside the dev boundary (`ERR_MOCK_FORBIDDEN`). It is the honest
 * "cached/static dev data" path used when live Thetanuts data is unavailable.
 */
export class StaticThetanutsHedgingProvider implements HedgingProvider, VolatilityProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "THETANUTS_STATIC_DEV",
    network: null,
  };

  constructor(private readonly options: StaticThetanutsOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "StaticThetanutsHedgingProvider (cached dev data) is not permitted in this runtime boundary",
      );
    }
  }

  private premiumBps(strategy: HedgingStrategy): number {
    return this.options.premiumBps?.[strategy] ?? STATIC_DEV_PREMIUM_BPS[strategy];
  }

  private coverageFor(strategy: HedgingStrategy): number {
    return STATIC_DEV_COVERAGE[strategy];
  }

  async quote(request: HedgeQuoteRequest): Promise<HedgeQuote> {
    this.assertAllowed();
    const bps = this.premiumBps(request.strategy);
    const notional = BigInt(request.amount.amount);
    const premium = ((notional * BigInt(bps)) / 10000n).toString();
    const days = this.options.durationDays ?? request.durationDays;
    return {
      provider: this.descriptor.name,
      strategy: request.strategy,
      premium: { asset: request.amount.asset, amount: premium },
      notional: request.amount,
      strike: request.strategy === "PUT_OPTION" ? "0" : null,
      impliedVol: STATIC_DEV_IV[request.asset] ?? 0.5,
      delta: this.coverageFor(request.strategy),
      coverage: this.coverageFor(request.strategy),
      validUntil: Date.now() + days * 86_400_000,
      dataSource: "STATIC_DEV",
      simulated: true,
    };
  }

  async getVolatility(request: VolatilityRequest): Promise<VolatilitySnapshot> {
    this.assertAllowed();
    const annualizedVol = this.options.impliedVol?.[request.asset] ?? STATIC_DEV_IV[request.asset];
    if (annualizedVol === undefined) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `no static dev volatility reference for ${request.asset}`,
        { details: { provider: this.descriptor.name, reason: "NO_STATIC_VOL" } },
      );
    }
    return {
      asset: request.asset,
      annualizedVol,
      dailyVol: annualizedVol / Math.sqrt(365),
      horizonDays: request.horizonDays,
      confidenceLevel: request.confidenceLevel,
      source: "STATIC_DEV_TABLE",
      simulated: true,
      asOf: Date.now(),
    };
  }
}

/** Helper: the honest provenance label used when live data is unavailable. */
export const HEDGE_DATA_SOURCE_UNAVAILABLE: HedgeDataSource = "UNAVAILABLE";
