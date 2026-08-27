/**
 * Market data providers — price quotes consumed by routing/optimization and
 * portfolio snapshots. Deterministic mock supplies a fixed, versioned price
 * table so routing is reproducible in Phase 0.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { ProviderDescriptor } from "@mova/types";

export interface QuoteRequest {
  base: string;
  quote: string;
}

export interface PriceQuote {
  base: string;
  quote: string;
  /** Mid price, quote units per base unit. */
  price: string;
  bid: string;
  ask: string;
  timestamp: number;
  simulated: boolean;
}

export interface MarketDataProvider {
  readonly descriptor: ProviderDescriptor;
  getQuote(request: QuoteRequest): Promise<PriceQuote>;
}

export interface MockMarketDataOptions {
  allowed: boolean;
  /** Deterministic simulated price table (base -> price in USDC). */
  prices?: Record<string, string>;
  /** Half-spread in basis points (default 5bp). */
  spreadBps?: number;
}

const DEFAULT_PRICES: Record<string, string> = {
  SUI: "1.000000",
  USDC: "1.000000",
};

/**
 * Deterministic mock: returns a fixed, versioned quote table. No live feeds,
 * no oracle risk. Never usable when mocks are forbidden.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "MOCK_MARKET_DATA",
    network: null,
  };

  constructor(private readonly options: MockMarketDataOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "MockMarketDataProvider is not permitted in this runtime boundary",
      );
    }
  }

  async getQuote(request: QuoteRequest): Promise<PriceQuote> {
    this.assertAllowed();
    const price = (this.options.prices ?? DEFAULT_PRICES)[request.base];
    if (!price) {
      throw new MovaError(
        ErrorCode.INTEGRATION_UNAVAILABLE,
        `no simulated quote for ${request.base}/${request.quote}`,
      );
    }
    const halfSpreadBps = this.options.spreadBps ?? 5;
    const bid = (BigInt(price.replace(".", "")) * (10000n - BigInt(halfSpreadBps))) / 10000n;
    const ask = (BigInt(price.replace(".", "")) * (10000n + BigInt(halfSpreadBps))) / 10000n;

    return {
      base: request.base,
      quote: request.quote,
      price,
      bid: bid.toString(),
      ask: ask.toString(),
      timestamp: Date.now(),
      simulated: true,
    };
  }
}
