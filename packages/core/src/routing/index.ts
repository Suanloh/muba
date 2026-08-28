/**
 * MOVA Phase 4 — Route Discovery & Mathematical Route Optimization.
 *
 * Deterministic routing engine that accepts a normalized payment intent and
 * returns ranked routes with transparent, reproducible calculations:
 *
 *   1. Discovery  — enumerate candidate routes across supported rails, price
 *                    them from MarketDataProvider quotes (integer math only).
 *   2. Scoring    — deterministic min-max normalization + weighted composite
 *                    score (COST/SPEED/RELIABILITY profiles or user weights).
 *   3. Comparison — per-route factor scores + selectionReason with the math.
 *   4. Savings    — cheapest vs selected vs most-expensive route.
 *
 * Nothing here is produced by an LLM. `RouteEngine.compute` is the single
 * entry point for the pipeline.
 */
import type {
  ParsedIntent,
  PaymentIntent,
  RouteCandidate,
  RouteOptimizationResult,
  SelectionCriterion,
} from "@mova/types";
import type { MarketDataProvider } from "@mova/integrations";
import {
  RouteDiscoveryEngine,
  type RouteDiscoveryEngineOptions,
} from "./discovery.js";
import {
  DEFAULT_CRITERION_WEIGHTS,
  normalizeWeights,
  RouteOptimizerEngine,
  ROUTING_ENGINE_VERSION,
  type RouteOptimizerOptions,
} from "./scoring.js";

export * from "./money.js";
export * from "./rails.js";
export * from "./discovery.js";
export * from "./scoring.js";

export type { RouteDiscoveryEngineOptions, RouteOptimizerOptions };
export { DEFAULT_CRITERION_WEIGHTS, normalizeWeights, ROUTING_ENGINE_VERSION };

/** High-level entry point combining discovery + optimization. */
export class RouteEngine {
  private readonly discovery: RouteDiscoveryEngine;
  private readonly optimizer: RouteOptimizerEngine;

  constructor(marketData: MarketDataProvider, options: RouteDiscoveryEngineOptions = {}) {
    this.discovery = new RouteDiscoveryEngine(marketData, options);
    this.optimizer = new RouteOptimizerEngine();
  }

  /** Discover candidate routes (uses MarketDataProvider). */
  discover(intent: PaymentIntent, parsed: ParsedIntent): Promise<RouteCandidate[]> {
    return this.discovery.discover(intent, parsed);
  }

  /** Rank candidates and select the best route (pure + deterministic). */
  optimize(
    candidates: RouteCandidate[],
    criterion: SelectionCriterion,
    options?: RouteOptimizerOptions,
  ): RouteOptimizationResult {
    return this.optimizer.optimize(candidates, criterion, options);
  }

  /** Full pipeline: discovery → optimization → ranked routes + savings. */
  compute(
    intent: PaymentIntent,
    parsed: ParsedIntent,
    criterion: SelectionCriterion,
    options?: RouteOptimizerOptions,
  ): Promise<RouteOptimizationResult> {
    return this.discover(intent, parsed).then((candidates) =>
      this.optimize(candidates, criterion, options),
    );
  }
}
