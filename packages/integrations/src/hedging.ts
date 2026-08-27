/**
 * Hedging providers — Thetanuts-style structured products (options / yield).
 *
 * The `HedgingProvider` interface is the replaceable sponsor boundary: the
 * deterministic `HedgingEngine` consumes quotes; a real Thetanuts integration
 * swaps in behind the same interface. The mock returns deterministic quotes
 * marked `simulated: true` (never treated as executable positions).
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type { HedgingStrategy, Money, ProviderDescriptor } from "@mova/types";

export interface HedgeQuoteRequest {
  asset: string;
  amount: Money;
  strategy: HedgingStrategy;
  durationDays: number;
}

export interface HedgeQuote {
  provider: string;
  strategy: HedgingStrategy;
  /** Premium/cost of the hedge, smallest units. */
  premium: Money;
  notional: Money;
  /** Optional strike for options strategies. */
  strike: string | null;
  validUntil: number;
  simulated: boolean;
}

export interface HedgingProvider {
  readonly descriptor: ProviderDescriptor;
  quote(request: HedgeQuoteRequest): Promise<HedgeQuote>;
}

export interface MockHedgingOptions {
  allowed: boolean;
  /** Deterministic premium basis points for put protection (default 120bp). */
  premiumBps?: number;
}

/**
 * Deterministic mock. Premium = `premiumBps` of notional, no live pricing,
 * no real Thetanuts positions. Never usable when mocks are forbidden.
 */
export class MockHedgingProvider implements HedgingProvider {
  readonly descriptor: ProviderDescriptor = {
    kind: "MOCK",
    name: "THETANUTS_SIMULATED",
    network: null,
  };

  constructor(private readonly options: MockHedgingOptions) {}

  private assertAllowed(): void {
    if (!this.options.allowed) {
      throw new MovaError(
        ErrorCode.MOCK_FORBIDDEN,
        "MockHedgingProvider is not permitted in this runtime boundary",
      );
    }
  }

  async quote(request: HedgeQuoteRequest): Promise<HedgeQuote> {
    this.assertAllowed();
    const bps = this.options.premiumBps ?? 120;
    const notional = BigInt(request.amount.amount);
    const premium = ((notional * BigInt(bps)) / 10000n).toString();

    return {
      provider: this.descriptor.name,
      strategy: request.strategy,
      premium: { asset: request.amount.asset, amount: premium },
      notional: request.amount,
      strike: request.strategy === "PUT_OPTION" ? "0" : null,
      validUntil: Date.now() + request.durationDays * 86_400_000,
      simulated: true,
    };
  }
}
