/**
 * MOVA Phase 6 — Deterministic hedge evaluation.
 *
 * Decides whether a routed payment needs a hedge, which instrument, what it
 * costs, and what it buys — then compares the route WITH vs WITHOUT the hedge
 * so the routing engine can expose both sides of the decision.
 *
 * Decision rules (all deterministic, all explainable):
 *
 *   hedgeNeeded      = risk.score >= hedgeTrigger
 *                      AND material adverse move (asset or FX VaR >= 1%)
 *   strategy         = PUT_OPTION (protection) when there is price exposure
 *                      else NONE (a payment hedge is protection, not yield)
 *   coverage         = quote.coverage (ATM put ≈ 0.5 of the tail VaR)
 *   exposureReduction= valueAtRisk × coverage
 *   hedgeWorthIt     = hedgeCost < exposureReduction        (cost < risk removed)
 *                      AND premium <= 5% of notional         (sanity cap)
 *   decision         = HEDGE iff hedgeNeeded AND hedgeWorthIt AND quote available
 *                      else NO_HEDGE
 *
 * The premium is also reported as basis points of the ROUTE cost (`deltaBps`)
 * so the "effect on overall route cost" is visible — but the decision uses the
 * notional-relative cap, not the fee-relative one (fees are tiny vs notional).
 *
 * Honesty (Phase 6 task 5): when the hedging provider reports the live
 * integration unavailable, the evaluation records `dataSource: "UNAVAILABLE"`,
 * sets `recommended: false` and explains the gap. It never substitutes a fake
 * live quote. Static/dev quotes are `simulated: true`, `dataSource: "STATIC_DEV"`.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  HedgeQuote,
  HedgeQuoteRequest,
  HedgingProvider,
  MarketDataProvider,
} from "@mova/integrations";
import type {
  HedgeDataSource,
  HedgeDecision,
  HedgeImpact,
  HedgingPlan,
  HedgingStrategy,
  Money,
  PaymentIntent,
  RiskAssessment,
  Route,
  RouteCandidate,
  RouteHedgeComparison,
} from "@mova/types";
import { ONE_PRICE, fromQuote, toBigInt, toDecimal, toQuote, zero } from "../routing/money.js";
import { valueAtRisk } from "./volatility.js";

export interface HedgingEngineContext {
  marketData: MarketDataProvider;
  hedgingProvider: HedgingProvider;
  /** Volatility provider used to size the exposure (same as the risk engine). */
  volatility: import("@mova/integrations").VolatilityProvider;
  /** Common numeraire for cost (default "USDC"). */
  quoteAsset?: string;
  /** Exposure horizon in days (must match the risk engine). */
  horizonDays?: number;
  /** Confidence level for VaR (must match the risk engine). */
  confidenceLevel?: number;
  /** Risk score at or above which hedging is considered (default 30). */
  hedgeTrigger?: number;
  /** Minimum adverse move (VaR ratio) that counts as material (default 1%). */
  minAdverseMovePct?: number;
  /** Sanity cap on the hedge premium as bps of NOTIONAL (default 500 = 5%). */
  maxHedgePremiumBps?: number;
  /** Hedge duration in days (default matches the exposure horizon). */
  durationDays?: number;
  now?: number;
}

export interface HedgeEvaluation {
  /** The risk assessment with its hedging plan filled in. */
  assessment: RiskAssessment;
  plan: HedgingPlan;
  impact: HedgeImpact;
  comparison: RouteHedgeComparison;
}

export const HEDGING_ENGINE_VERSION = "1.0.0";

export class HedgingEngine {
  private readonly quoteAsset: string;
  private readonly horizonDays: number;
  private readonly confidenceLevel: number;
  private readonly hedgeTrigger: number;
  private readonly minAdverseMovePct: number;
  private readonly maxHedgePremiumBps: number;
  private readonly durationDays: number;

  constructor(private readonly ctx: HedgingEngineContext) {
    this.quoteAsset = ctx.quoteAsset ?? "USDC";
    this.horizonDays = ctx.horizonDays ?? 1;
    this.confidenceLevel = ctx.confidenceLevel ?? 0.95;
    this.hedgeTrigger = ctx.hedgeTrigger ?? 30;
    this.minAdverseMovePct = ctx.minAdverseMovePct ?? 0.01;
    this.maxHedgePremiumBps = ctx.maxHedgePremiumBps ?? 500;
    this.durationDays = ctx.durationDays ?? this.horizonDays;
  }

  private async midPrice(asset: string): Promise<string> {
    if (asset === this.quoteAsset) return ONE_PRICE;
    const q = await this.ctx.marketData.getQuote({ base: asset, quote: this.quoteAsset });
    return q.price;
  }

  private async volatilityFor(asset: string): Promise<number | null> {
    try {
      const v = await this.ctx.volatility.getVolatility({
        asset,
        horizonDays: this.horizonDays,
        confidenceLevel: this.confidenceLevel,
      });
      return v.dailyVol;
    } catch (err) {
      if (err instanceof MovaError && err.code === ErrorCode.INTEGRATION_UNAVAILABLE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Evaluate the hedge for a routed payment and return the assessment (with
   * the hedging plan), the plan, the impact, and the with-vs-without comparison.
   */
  async evaluate(
    _intent: PaymentIntent,
    route: RouteCandidate | Route,
    risk: RiskAssessment,
  ): Promise<HedgeEvaluation> {
    const now = this.ctx.now ?? Date.now();

    // -- Exposure sizing (in quoteAsset smallest units) -----------------------
    const target = route.legs[route.legs.length - 1]!.amount;
    const notionalUsdc = toBigInt(
      toQuote(target, this.quoteAsset, await this.midPrice(target.asset)),
    );

    const hasConversion = route.summary.hasConversion;
    const sourceAsset = route.summary.sourceAsset;
    const targetDailyVol = await this.volatilityFor(target.asset);
    const sourceDailyVol = hasConversion ? await this.volatilityFor(sourceAsset) : null;

    const targetVar = targetDailyVol === null
      ? 0n
      : valueAtRisk(notionalUsdc, targetDailyVol, this.horizonDays, this.confidenceLevel);
    const sourceVar = sourceDailyVol === null
      ? 0n
      : valueAtRisk(notionalUsdc, sourceDailyVol, this.horizonDays, this.confidenceLevel);

    const varPct = (v: bigint) => (notionalUsdc > 0n ? Number(v) / Number(notionalUsdc) : 0);
    const targetVarPct = varPct(targetVar);
    const sourceVarPct = varPct(sourceVar);

    // The exposure asset is the one whose price move threatens the payment:
    // the FX source when converting, otherwise the settlement token.
    const exposureAsset = hasConversion ? sourceAsset : target.asset;
    const materialMove =
      (hasConversion ? sourceVarPct : targetVarPct) >= this.minAdverseMovePct;
    // The exposure to hedge is the LARGEST price risk: the FX/source VaR when
    // converting, otherwise the settlement token's VaR.
    const hedgedVar = hasConversion ? sourceVar : targetVar;
    const valueAtRiskMoney: Money = { asset: this.quoteAsset, amount: hedgedVar.toString() };

    // A hedge is CONSIDERED when either the composite risk is elevated OR there
    // is a material adverse price move (e.g. a 12.5% FX VaR on a conversion).
    const hedgeNeeded =
      risk.score >= this.hedgeTrigger ||
      materialMove ||
      targetVarPct >= this.minAdverseMovePct;
    const strategy: HedgingStrategy = hedgeNeeded ? "PUT_OPTION" : "NONE";

    // -- Quote from the hedging provider --------------------------------------
    let quote: HedgeQuote | null = null;
    let quoteError: string | null = null;
    let dataSource: HedgeDataSource = "UNAVAILABLE";
    if (hedgeNeeded) {
      const exposureMoney = fromQuote(
        { asset: this.quoteAsset, amount: notionalUsdc.toString() },
        exposureAsset,
        await this.midPrice(exposureAsset),
      );
      const request: HedgeQuoteRequest = {
        asset: exposureAsset,
        amount: exposureMoney,
        strategy,
        durationDays: this.durationDays,
      };
      try {
        quote = await this.ctx.hedgingProvider.quote(request);
        dataSource = quote.dataSource;
      } catch (err) {
        dataSource = "UNAVAILABLE";
        quoteError =
          err instanceof MovaError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
      }
    }

    // -- Hedge math ------------------------------------------------------------
    const grossExposure = { asset: this.quoteAsset, amount: notionalUsdc.toString() };
    const coverage = quote?.coverage ?? quote?.delta ?? 0.5;
    const exposureReductionBig = quote ? (hedgedVar * BigInt(Math.round(coverage * 100))) / 100n : 0n;
    const netExposureBig = notionalUsdc - exposureReductionBig;
    const exposureReduction: Money = {
      asset: this.quoteAsset,
      amount: exposureReductionBig.toString(),
    };
    const netExposure: Money = {
      asset: this.quoteAsset,
      amount: (netExposureBig < 0n ? 0n : netExposureBig).toString(),
    };
    const exposureReductionRatio =
      notionalUsdc > 0n ? Number(exposureReductionBig) / Number(notionalUsdc) : 0;

    const routeCost = toBigInt(route.totalEstimatedCost);
    let hedgeCost: Money = zero(this.quoteAsset);
    let hedgeCostQuote = 0n;
    let hedgeCostBps = 0;
    if (quote) {
      hedgeCostQuote =
        quote.premium.asset === this.quoteAsset
          ? toBigInt(quote.premium)
          : toBigInt(toQuote(quote.premium, this.quoteAsset, await this.midPrice(quote.premium.asset)));
      hedgeCost = { asset: this.quoteAsset, amount: hedgeCostQuote.toString() };
      hedgeCostBps =
        routeCost > 0n ? Number((hedgeCostQuote * 10000n) / routeCost) : 0;
    }

    // -- Deterministic decision -------------------------------------------------
    const hedgePremiumBpsOfNotional =
      notionalUsdc > 0n ? Number((hedgeCostQuote * 10000n) / notionalUsdc) : 0;
    const hedgeWorthIt =
      quote !== null &&
      exposureReductionBig > 0n &&
      hedgeCostQuote < exposureReductionBig &&
      hedgePremiumBpsOfNotional <= this.maxHedgePremiumBps;

    let hedgeDecision: HedgeDecision;
    let reason: string;
    if (!hedgeNeeded) {
      hedgeDecision = "NO_HEDGE";
      reason =
        `Hedge not needed: risk score ${risk.score} is below the ${this.hedgeTrigger} trigger ` +
        `and the adverse move (asset ${(targetVarPct * 100).toFixed(2)}%, ` +
        `FX ${(sourceVarPct * 100).toFixed(2)}%) is below the ${(this.minAdverseMovePct * 100).toFixed(0)}% materiality floor.`;
    } else if (quote === null) {
      hedgeDecision = "NO_HEDGE";
      reason =
        `Hedge would be considered (risk ${risk.score}) but the hedge quote is unavailable — ` +
        `integration gap: ${quoteError ?? "no quote returned"}. No hedge was assumed. ` +
        `Cached/static dev data is only used in dev/demo mode and never presented as live.`;
    } else if (hedgeWorthIt) {
      hedgeDecision = "HEDGE";
      reason =
        `Hedging recommended: risk ${risk.score} >= trigger ${this.hedgeTrigger}, ` +
        `${strategy} premium ${toDecimal(hedgeCost)} ${this.quoteAsset} removes ` +
        `${toDecimal(exposureReduction)} ${this.quoteAsset} of Value-at-Risk ` +
        `(${(exposureReductionRatio * 100).toFixed(1)}% of notional) at ` +
        `${hedgePremiumBpsOfNotional}bp of notional — the hedge costs less than the risk it removes.`;
    } else {
      hedgeDecision = "NO_HEDGE";
      const why =
        exposureReductionBig === 0n
          ? "the hedge removes no measurable Value-at-Risk (no volatility data)"
          : hedgeCostQuote >= exposureReductionBig
            ? `the hedge premium (${toDecimal(hedgeCost)} ${this.quoteAsset}) is not below the exposure it removes (${toDecimal(exposureReduction)} ${this.quoteAsset})`
            : `the hedge premium (${hedgePremiumBpsOfNotional}bp of notional) exceeds the ${this.maxHedgePremiumBps}bp cap`;
      reason = `Hedge evaluated but not cost-effective: ${why}.`;
    }

    const withHedge = routeCost + (hedgeDecision === "HEDGE" ? hedgeCostQuote : 0n);
    const routeCostWithHedge: Money = { asset: this.quoteAsset, amount: withHedge.toString() };
    const deltaBig = withHedge - routeCost;

    const comparison: RouteHedgeComparison = {
      routeNo: route.routeNo,
      strategy: hedgeDecision === "HEDGE" ? strategy : "NONE",
      hedgeDecision,
      recommended: hedgeDecision === "HEDGE",
      withoutHedge: route.totalEstimatedCost,
      withHedge: routeCostWithHedge,
      delta: { asset: this.quoteAsset, amount: deltaBig.toString() },
      deltaBps: hedgeCostBps,
      exposureReduction,
      exposureReductionRatio: Math.round(exposureReductionRatio * 1000) / 1000,
      dataSource,
      reason,
    };

    const impact: HedgeImpact = {
      hedgedAsset: exposureAsset,
      grossExposure,
      netExposure,
      exposureReduction,
      exposureReductionRatio: Math.round(exposureReductionRatio * 1000) / 1000,
      valueAtRisk: valueAtRiskMoney,
      hedgeCost,
      hedgeCostBps,
      routeCostWithoutHedge: route.totalEstimatedCost,
      routeCostWithHedge,
      dataSource,
    };

    const plan: HedgingPlan = {
      recommended: hedgeDecision === "HEDGE",
      strategy: hedgeDecision === "HEDGE" ? strategy : "NONE",
      provider: this.ctx.hedgingProvider.descriptor.name,
      params: {
        exposureAsset,
        coverage: coverage.toFixed(3),
        horizonDays: String(this.horizonDays),
        confidenceLevel: String(this.confidenceLevel),
        ...(quote?.strike ? { strike: quote.strike } : {}),
        ...(quote?.impliedVol !== undefined ? { impliedVol: quote.impliedVol.toFixed(4) } : {}),
      },
      estimatedCost: hedgeCost,
      expiresAt: quote?.validUntil ?? now,
      dataSource,
      note: reason,
    };

    return {
      assessment: { ...risk, hedging: plan, createdAt: risk.createdAt },
      plan,
      impact,
      comparison,
    };
  }
}
