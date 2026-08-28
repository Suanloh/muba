/**
 * MOVA Phase 6 — Hedged route engine (the "route vs route+hedge" facade).
 *
 * Composes the Phase 4 routing engine with the Phase 6 risk + hedging engines
 * and produces MOVA's FINAL payment recommendation:
 *
 *   discovery → optimization → risk assessment → hedge evaluation
 *     → PaymentRecommendation { route, risk, hedge, totalCost, decision }
 *
 * The routing engine's selected route is the primary recommendation; the hedge
 * comparison tells you whether to add a hedge and at what cost. Everything is
 * deterministic and explainable — no LLM, no randomness.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  HedgingProvider,
  MarketDataProvider,
  VolatilityProvider,
} from "@mova/integrations";
import type {
  Money,
  ParsedIntent,
  PaymentIntent,
  PaymentRecommendation,
  Route,
  RouteHedgeComparison,
  SelectionCriterion,
} from "@mova/types";
import {
  RouteEngine,
  type RouteOptimizerOptions,
} from "../routing/index.js";
import type { RouteDiscoveryEngineOptions } from "../routing/discovery.js";
import { toDecimal } from "../routing/money.js";
import {
  HedgingEngine,
  HEDGING_ENGINE_VERSION,
  type HedgeEvaluation,
  type HedgingEngineContext,
} from "./hedging-engine.js";
import {
  RiskEngine,
  RISK_ENGINE_VERSION,
  type RiskWeights,
} from "./risk-engine.js";

export interface HedgedRouteOptions {
  /** Common numeraire for cost/exposure (default "USDC"). */
  quoteAsset?: string;
  /** Assets the payer can source from (route discovery). */
  availableAssets?: string[];
  /** Rail parameter overrides (route discovery). */
  rails?: RouteDiscoveryEngineOptions["rails"];
  /** Exposure horizon in days (default 1). */
  horizonDays?: number;
  /** Confidence level for VaR (default 0.95). */
  confidenceLevel?: number;
  /** Risk signal weights override. */
  riskWeights?: Partial<RiskWeights>;
  /** Hedge evaluation overrides (trigger, materiality, cost caps). */
  hedge?: Partial<Pick<HedgingEngineContext, "hedgeTrigger" | "minAdverseMovePct" | "maxHedgePremiumBps" | "durationDays">>;
  /** Fixed clock for deterministic tests/demos. */
  now?: number;
}

export interface HedgedRouteResult {
  /** Phase 4 routing output (ranked routes + savings). */
  optimization: Awaited<ReturnType<RouteEngine["compute"]>>;
  /** MOVA's final payment recommendation (selected route + risk + hedge). */
  recommendation: PaymentRecommendation;
  /** Per-route route-vs-route+hedge comparisons (for the UI table). */
  comparisons: RouteHedgeComparison[];
}

/**
 * The Phase 6 entry point. `compute` returns the routing optimization plus the
 * final recommendation (route + risk + hedge decision) and a per-route
 * with-vs-without-hedge comparison table.
 */
export class HedgedRouteEngine {
  private readonly quoteAsset: string;
  private readonly horizonDays: number;
  private readonly confidenceLevel: number;
  private readonly riskEngine: RiskEngine;
  private readonly hedgingEngine: HedgingEngine;

  constructor(
    private readonly marketData: MarketDataProvider,
    hedgingProvider: HedgingProvider,
    volatility: VolatilityProvider,
    private readonly options: HedgedRouteOptions = {},
  ) {
    this.quoteAsset = options.quoteAsset ?? "USDC";
    this.horizonDays = options.horizonDays ?? 1;
    this.confidenceLevel = options.confidenceLevel ?? 0.95;
    this.riskEngine = new RiskEngine({
      marketData,
      volatility,
      quoteAsset: this.quoteAsset,
      horizonDays: this.horizonDays,
      confidenceLevel: this.confidenceLevel,
      weights: options.riskWeights,
      now: options.now,
    });
    this.hedgingEngine = new HedgingEngine({
      marketData,
      hedgingProvider,
      volatility,
      quoteAsset: this.quoteAsset,
      horizonDays: this.horizonDays,
      confidenceLevel: this.confidenceLevel,
      ...options.hedge,
      now: options.now,
    });
  }

  async compute(
    intent: PaymentIntent,
    parsed: ParsedIntent,
    criterion: SelectionCriterion,
    optimizer?: RouteOptimizerOptions,
  ): Promise<HedgedRouteResult> {
    const routeEngine = new RouteEngine(this.marketData, {
      quoteAsset: this.quoteAsset,
      availableAssets: this.options.availableAssets,
      rails: this.options.rails,
    });
    const optimization = await routeEngine.compute(intent, parsed, criterion, {
      paymentIntentId: intent.id,
      now: this.options.now,
      ...optimizer,
    });

    const comparisons: RouteHedgeComparison[] = [];
    let selectedEval: { evaluation: HedgeEvaluation; route: Route } | null = null;

    for (const route of optimization.routes) {
      const risk = await this.riskEngine.assess(intent, route);
      const evaluation = await this.hedgingEngine.evaluate(intent, route, risk);
      comparisons.push(evaluation.comparison);
      if (route.status === "SELECTED") {
        selectedEval = { evaluation, route };
      }
    }

    if (!selectedEval) {
      throw new MovaError(
        ErrorCode.ROUTING_FAILED,
        "no route selected — cannot produce a payment recommendation (routing or market data unavailable)",
      );
    }

    const recommendation = this.buildRecommendation(intent, selectedEval.evaluation, selectedEval.route);
    return { optimization, recommendation, comparisons };
  }

  private buildRecommendation(
    intent: PaymentIntent,
    evaluation: HedgeEvaluation,
    route: Route,
  ): PaymentRecommendation {
    const now = this.options.now ?? Date.now();
    const hedged = evaluation.comparison.hedgeDecision === "HEDGE";
    const totalCost: Money = hedged
      ? evaluation.comparison.withHedge
      : evaluation.comparison.withoutHedge;
    const risk = evaluation.assessment;

    const explanation = [
      `MOVA recommendation for payment ${intent.id}: `,
      `route ${route.routeNo} (${route.summary.legOrder.join(" → ")})`,
      `cost ${toDecimal(route.totalEstimatedCost)} ${this.quoteAsset},`,
      `financial risk ${risk.score}/100 (${risk.band}).`,
      hedged
        ? `Hedge ${evaluation.comparison.strategy} via ${evaluation.plan.provider}: adds ${toDecimal(evaluation.comparison.delta)} ${this.quoteAsset} ` +
          `but removes ${toDecimal(evaluation.comparison.exposureReduction)} ${this.quoteAsset} of exposure ` +
          `(${(evaluation.comparison.exposureReductionRatio * 100).toFixed(1)}%); final total cost ${toDecimal(totalCost)} ${this.quoteAsset}.`
        : `No hedge: ${evaluation.comparison.reason}`,
      `Risk decision: ${risk.decision}.`,
    ].join("\n");

    return {
      id: `rec-${intent.id}-${route.routeNo}`,
      paymentIntentId: intent.id,
      route,
      risk,
      hedge: evaluation.comparison,
      totalCost,
      hedged,
      decision: risk.decision,
      explanation,
      createdAt: now,
    };
  }
}

/** Version stamp of the risk+hedge recommendation pipeline. */
export const RECOMMENDATION_ENGINE_VERSION = `${RISK_ENGINE_VERSION}+${HEDGING_ENGINE_VERSION}`;
