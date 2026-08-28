/**
 * Route discovery — Phase 4 routing engine.
 *
 * Given a validated payment intent, this engine enumerates candidate routes
 * across the supported payment rails and prices each one with deterministic
 * integer math. Every route ends with an ONCHAIN leg on Sui and a SETTLEMENT
 * leg to the recipient (MOVA always settles on Sui).
 *
 * Route families generated from the payer's `availableAssets`:
 *   - direct:        source == settlement token  → SUI_CHAIN + SETTLEMENT
 *   - conversion:    token source != settlement  → MOVA_DEX + SUI_CHAIN + SETTLEMENT
 *   - fiat:          fiat source                 → MOVA_FIAT_RAIL + MOVA_ONRAMP + SUI_CHAIN + SETTLEMENT
 *
 * Unpriceable routes (no market quote) are skipped, never guessed. If no
 * route can be priced the caller must fail routing (state machine guard).
 * Nothing here is LLM output; all figures come from the rail catalog and the
 * MarketDataProvider quotes.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import {
  FIAT_CURRENCY_SET,
  SUPPORTED_TOKENS,
  type Money,
  type ParsedIntent,
  type PaymentIntent,
  type RouteCandidate,
  type RouteLeg,
  type RouteRisk,
  type RouteRiskFactor,
  type RouteSummary,
} from "@mova/types";
import type { MarketDataProvider, PriceQuote } from "@mova/integrations";
import {
  bpsOf,
  fromQuote,
  ONE_PRICE,
  spreadBps,
  toBigInt,
  toDecimal,
  toQuote,
  zero,
} from "./money.js";
import { RailCatalog, type RailName, type RailParams } from "./rails.js";

export interface RouteDiscoveryEngineOptions {
  /** Assets the payer can source from (token symbols or fiat ISO codes). */
  availableAssets?: string[];
  /** Common numeraire for cost comparison (default "USDC"). */
  quoteAsset?: string;
  /** Overrides for the versioned rail catalog (testing / real params). */
  rails?: Partial<Record<RailName, Partial<RailParams>>>;
}

/** Severity bucket for a 0..1 risk level. */
function severityOf(level: number): "LOW" | "MEDIUM" | "HIGH" {
  if (level < 0.05) return "LOW";
  if (level < 0.15) return "MEDIUM";
  return "HIGH";
}

/** Round a dimensionless ratio to 3 decimals for stable scores. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export class RouteDiscoveryEngine {
  private readonly quoteAsset: string;
  private readonly availableAssets: string[] | undefined;
  private readonly rails: RailCatalog;
  private readonly quoteCache = new Map<string, PriceQuote | null>();

  constructor(
    private readonly marketData: MarketDataProvider,
    options: RouteDiscoveryEngineOptions = {},
  ) {
    this.quoteAsset = options.quoteAsset ?? "USDC";
    this.availableAssets = options.availableAssets;
    this.rails = new RailCatalog(options.rails);
  }

  /** Fetch a quote for `asset` against the quote asset (cached; null when unavailable). */
  private async quote(asset: string): Promise<PriceQuote | null> {
    if (asset === this.quoteAsset) {
      return {
        base: asset,
        quote: this.quoteAsset,
        price: ONE_PRICE,
        // Provider convention: bid/ask are integer strings in the price scale.
        bid: "1000000",
        ask: "1000000",
        timestamp: Date.now(),
        simulated: false,
      };
    }
    const cached = this.quoteCache.get(asset);
    if (cached !== undefined) return cached;
    try {
      const q = await this.marketData.getQuote({ base: asset, quote: this.quoteAsset });
      this.quoteCache.set(asset, q);
      return q;
    } catch (err) {
      // Gracefully skip unpriceable routes; rethrow real engine bugs.
      if (err instanceof MovaError && err.code === ErrorCode.INTEGRATION_UNAVAILABLE) {
        this.quoteCache.set(asset, null);
        return null;
      }
      throw err;
    }
  }

  /** Mid price of `asset` in the quote asset, or null when unavailable. */
  private async midPrice(asset: string): Promise<string | null> {
    if (asset === this.quoteAsset) return ONE_PRICE;
    const q = await this.quote(asset);
    return q?.price ?? null;
  }

  /** Convert a Money into the quote asset's smallest units (null when unpriceable). */
  private async quoteValue(m: Money): Promise<bigint | null> {
    const price = await this.midPrice(m.asset);
    if (price === null) return null;
    return toBigInt(toQuote(m, this.quoteAsset, price));
  }

  /** The shared Sui legs: ONCHAIN transfer + final SETTLEMENT. */
  private suiLegs(target: Money): RouteLeg[] {
    const chain = this.rails.get("SUI_CHAIN");
    const settle = this.rails.get("SUI_SETTLEMENT");
    const gas = chain.fixedFee!;
    const onchain: RouteLeg = {
      kind: "ONCHAIN",
      from: target.asset,
      to: target.asset,
      asset: target.asset,
      amount: target,
      provider: "SUI_CHAIN",
      fee: gas,
      estimatedTimeMs: chain.timeMs,
      reliability: chain.reliability,
      liquidity: chain.liquidity,
      riskFactor: chain.riskFactor,
      note: `On-chain transfer of ${target.asset} on Sui (network gas ${toDecimal(gas)} ${gas.asset})`,
    };
    const settlement: RouteLeg = {
      kind: "SETTLEMENT",
      from: target.asset,
      to: target.asset,
      asset: target.asset,
      amount: target,
      provider: "SUI_SETTLEMENT",
      fee: zero(target.asset),
      estimatedTimeMs: settle.timeMs,
      reliability: settle.reliability,
      liquidity: settle.liquidity,
      riskFactor: settle.riskFactor,
      note: `Settle ${toDecimal(target)} ${target.asset} to the recipient on Sui`,
    };
    return [onchain, settlement];
  }

  /** Build the deterministic composite risk (unweighted mean of leg factors). */
  private computeRisk(legs: RouteLeg[]): RouteRisk {
    const factors: RouteRiskFactor[] = [];
    for (const leg of legs) {
      if (leg.riskFactor > 0) {
        factors.push({
          factorId: `${leg.provider}_RISK`,
          label: `${leg.provider} (${leg.kind}) risk`,
          severity: severityOf(leg.riskFactor),
          weight: 1,
          level: leg.riskFactor,
          note: `Risk factor of the ${leg.kind} leg via ${leg.provider}`,
        });
      }
    }
    if (factors.length === 0) return { score: 0, factors: [] };
    const totalWeight = factors.reduce((acc, f) => acc + f.weight, 0);
    const score = factors.reduce((acc, f) => acc + f.level * f.weight, 0) / totalWeight;
    return { score: round3(score), factors };
  }

  private summarize(legs: RouteLeg[], source: string, destination: string): RouteSummary {
    const kinds = legs.map((l) => l.kind);
    return {
      sourceAsset: source,
      destinationAsset: destination,
      hasConversion: kinds.includes("CONVERSION"),
      conversionCount: kinds.filter((k) => k === "CONVERSION").length,
      hasOffchainLeg: kinds.includes("OFFCHAIN"),
      hasOnchainLeg: kinds.includes("ONCHAIN"),
      settleOnSui: kinds.includes("SETTLEMENT"),
      legOrder: kinds,
    };
  }

  /** Assemble a candidate: cost breakdown, aggregate metrics, risk, summary. */
  private finishRoute(
    legs: RouteLeg[],
    conv: { conversionCostUsdc: bigint; slippageUsdc: bigint },
    source: string,
  ): Promise<RouteCandidate | null> {
    return (async () => {
      let paymentFeesUsdc = 0n;
      for (const leg of legs) {
        const fee = await this.quoteValue(leg.fee);
        if (fee === null) return null; // unpriceable fee asset → skip route
        paymentFeesUsdc += fee;
      }
      const totalUsdc = paymentFeesUsdc + conv.slippageUsdc;
      const destination = legs[legs.length - 1]!.to;
      const reliability = round3(legs.reduce((acc, l) => acc * l.reliability, 1));
      const liquidity = round3(Math.min(...legs.map((l) => l.liquidity)));
      const estimatedTimeMs = legs.reduce((acc, l) => acc + l.estimatedTimeMs, 0);
      return {
        routeNo: 0, // assigned by discover()
        legs,
        summary: this.summarize(legs, source, destination),
        cost: {
          quoteAsset: this.quoteAsset,
          paymentFees: { asset: this.quoteAsset, amount: paymentFeesUsdc.toString() },
          conversionCost: { asset: this.quoteAsset, amount: conv.conversionCostUsdc.toString() },
          slippage: { asset: this.quoteAsset, amount: conv.slippageUsdc.toString() },
          other: zero(this.quoteAsset),
          total: { asset: this.quoteAsset, amount: totalUsdc.toString() },
        },
        totalFee: { asset: this.quoteAsset, amount: paymentFeesUsdc.toString() },
        totalEstimatedCost: { asset: this.quoteAsset, amount: totalUsdc.toString() },
        estimatedTimeMs,
        reliability,
        liquidity,
        risk: this.computeRisk(legs),
      };
    })();
  }

  /** Direct on-chain route: source == settlement token. */
  private directRoute(target: Money): Promise<RouteCandidate | null> {
    return this.finishRoute(this.suiLegs(target), { conversionCostUsdc: 0n, slippageUsdc: 0n }, target.asset);
  }

  /** Conversion route: swap a token source into the settlement token. */
  private async conversionRoute(source: string, target: Money): Promise<RouteCandidate | null> {
    const dex = this.rails.get("MOVA_DEX");
    const sourceQuote = await this.quote(source);
    const targetPrice = await this.midPrice(target.asset);
    if (sourceQuote === null || targetPrice === null) return null;

    const notionalUsdc = toBigInt(toQuote(target, this.quoteAsset, targetPrice));
    const spread = spreadBps(sourceQuote.bid, sourceQuote.ask, sourceQuote.price);
    const swapFeeUsdc = bpsOf(notionalUsdc, dex.feeBps);
    const spreadUsdc = bpsOf(notionalUsdc, spread);
    const slippageUsdc = bpsOf(notionalUsdc, dex.slippageBps ?? 0);
    const conversionUsdc = swapFeeUsdc + spreadUsdc;

    const leg: RouteLeg = {
      kind: "CONVERSION",
      from: source,
      to: target.asset,
      asset: target.asset,
      amount: target,
      provider: "MOVA_DEX",
      fee: { asset: this.quoteAsset, amount: conversionUsdc.toString() },
      estimatedTimeMs: dex.timeMs,
      reliability: dex.reliability,
      liquidity: dex.liquidity,
      riskFactor: dex.riskFactor,
      note: `Convert ${source} → ${target.asset} on Sui DEX (${dex.feeBps}bp swap fee + ${spread}bp spread)`,
    };
    return this.finishRoute(
      [leg, ...this.suiLegs(target)],
      { conversionCostUsdc: conversionUsdc, slippageUsdc },
      source,
    );
  }

  /** Fiat route: off-chain fiat leg → on-ramp → on-chain settlement. */
  private async fiatRoute(fiat: string, target: Money): Promise<RouteCandidate | null> {
    const onramp = this.rails.get("MOVA_ONRAMP");
    const fiatRail = this.rails.get("MOVA_FIAT_RAIL");
    const fiatQuote = await this.quote(fiat);
    const targetPrice = await this.midPrice(target.asset);
    if (fiatQuote === null || targetPrice === null) return null;

    const notionalUsdc = toBigInt(toQuote(target, this.quoteAsset, targetPrice));
    const onrampFeeUsdc = bpsOf(notionalUsdc, onramp.feeBps);
    const onrampSlippageUsdc = bpsOf(notionalUsdc, onramp.slippageBps ?? 0);
    const fiatRailFeeUsdc = bpsOf(notionalUsdc, fiatRail.feeBps);
    const fiatNotional = fromQuote({ asset: this.quoteAsset, amount: notionalUsdc.toString() }, fiat, fiatQuote.price);

    const offchain: RouteLeg = {
      kind: "OFFCHAIN",
      from: fiat,
      to: fiat,
      asset: fiat,
      amount: fiatNotional,
      provider: "MOVA_FIAT_RAIL",
      fee: { asset: this.quoteAsset, amount: fiatRailFeeUsdc.toString() },
      estimatedTimeMs: fiatRail.timeMs,
      reliability: fiatRail.reliability,
      liquidity: fiatRail.liquidity,
      riskFactor: fiatRail.riskFactor,
      note: `Off-chain ${fiat} leg to the on-ramp (${fiatRail.feeBps}bp rail fee)`,
    };
    const onrampLeg: RouteLeg = {
      kind: "CONVERSION",
      from: fiat,
      to: target.asset,
      asset: target.asset,
      amount: target,
      provider: "MOVA_ONRAMP",
      fee: { asset: this.quoteAsset, amount: onrampFeeUsdc.toString() },
      estimatedTimeMs: onramp.timeMs,
      reliability: onramp.reliability,
      liquidity: onramp.liquidity,
      riskFactor: onramp.riskFactor,
      note: `Fiat on-ramp ${fiat} → ${target.asset} (${onramp.feeBps}bp fee + ${onramp.slippageBps ?? 0}bp slippage)`,
    };
    return this.finishRoute(
      [offchain, onrampLeg, ...this.suiLegs(target)],
      { conversionCostUsdc: onrampFeeUsdc, slippageUsdc: onrampSlippageUsdc },
      fiat,
    );
  }

  /** Generate one route for a source asset, or null when unpriceable/unknown. */
  private async buildRoute(source: string, target: Money): Promise<RouteCandidate | null> {
    if (source === target.asset) return this.directRoute(target);
    if ((SUPPORTED_TOKENS as readonly string[]).includes(source)) return this.conversionRoute(source, target);
    if (FIAT_CURRENCY_SET.has(source)) return this.fiatRoute(source, target);
    return null; // unknown source asset — not a supported rail
  }

  /**
   * Discover candidate routes for a validated intent. `_intent` is accepted
   * for the module contract; the engine is driven by the normalized
   * `parsed.canonicalAmount` + configured source assets.
   */
  async discover(_intent: PaymentIntent, parsed: ParsedIntent): Promise<RouteCandidate[]> {
    const target = parsed.canonicalAmount;
    if (!target) return []; // no settleable amount → nothing to route
    const availableAssets = this.availableAssets ?? [target.asset];
    const routes: RouteCandidate[] = [];
    for (const source of availableAssets) {
      const route = await this.buildRoute(source.toUpperCase(), target);
      if (route) routes.push(route);
    }
    return routes.map((r, i) => ({ ...r, routeNo: i + 1 }));
  }
}
