/**
 * Route optimization — Phase 4 routing engine.
 *
 * Pure + deterministic ranking of discovered candidates. No LLM, no network.
 *
 * Scoring model (all factors normalized to 1 = best via min-max across the
 * candidate set, so no factor can dominate just because its units differ):
 *
 *   costScore        = 1 − minMax(totalEstimatedCost)   (1 = cheapest)
 *   speedScore       = 1 − minMax(estimatedTimeMs)      (1 = fastest)
 *   riskScore        = 1 − minMax(risk.score)           (1 = safest)
 *   reliabilityScore = minMax(reliability)              (1 = most reliable)
 *   liquidityScore   = minMax(liquidity)                (1 = most liquid)
 *
 *   selectionScore = Σ weight_f · factorScore_f         (weights sum to 1)
 *
 * Weights come from a deterministic criterion profile (COST / SPEED /
 * RELIABILITY) or an explicit user preference — never an AI guess. Ties are
 * broken by lower cost, then lower time, then lower routeNo.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  RouteCandidate,
  RouteComparisonRow,
  RouteFactorScores,
  RouteOptimizationResult,
  RoutePreferenceWeights,
  RouteSavings,
  SelectionCriterion,
} from "@mova/types";
import { compareMoney, subMoney, toBigInt, toDecimal, zero } from "./money.js";

export const ROUTING_ENGINE_VERSION = "1.0.0";

/** Deterministic default weight profiles per selection criterion. */
export const DEFAULT_CRITERION_WEIGHTS: Readonly<Record<SelectionCriterion, RoutePreferenceWeights>> = {
  COST: { cost: 0.5, speed: 0.1, reliability: 0.2, risk: 0.15, liquidity: 0.05 },
  SPEED: { cost: 0.1, speed: 0.5, reliability: 0.2, risk: 0.15, liquidity: 0.05 },
  RELIABILITY: { cost: 0.15, speed: 0.1, reliability: 0.5, risk: 0.15, liquidity: 0.1 },
};

export interface RouteOptimizerOptions {
  /** Explicit user preference weights — overrides the criterion profile. */
  weights?: RoutePreferenceWeights;
  paymentIntentId?: string;
  now?: number;
}

/** Round a dimensionless ratio to 3 decimals for stable scores. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Validate + normalize weights to sum to 1. */
export function normalizeWeights(w: RoutePreferenceWeights): RoutePreferenceWeights {
  const sum = w.cost + w.speed + w.reliability + w.risk + w.liquidity;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new MovaError(
      ErrorCode.VALIDATION_ERROR,
      "route preference weights must be finite, non-negative and sum to > 0",
    );
  }
  return {
    cost: w.cost / sum,
    speed: w.speed / sum,
    reliability: w.reliability / sum,
    risk: w.risk / sum,
    liquidity: w.liquidity / sum,
  };
}

/**
 * Normalized score where 1 = lowest (best) value. When all candidates share
 * the same value they are all equally best → 1, never 0.
 */
function scoreLowerIsBetter(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => 1 - (v - min) / range);
}

/** Normalized score where 1 = highest (best) value. Equal values → 1. */
function scoreHigherIsBetter(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => (v - min) / range);
}

/** Per-factor scores (1 = best on each factor) across the candidate set. */
function computeFactorScores(candidates: RouteCandidate[]): Map<number, RouteFactorScores> {
  const costs = candidates.map((c) => Number(toBigInt(c.totalEstimatedCost)));
  const times = candidates.map((c) => c.estimatedTimeMs);
  const risks = candidates.map((c) => c.risk.score);
  const rels = candidates.map((c) => c.reliability);
  const liqs = candidates.map((c) => c.liquidity);

  const costS = scoreLowerIsBetter(costs);
  const speedS = scoreLowerIsBetter(times);
  const riskS = scoreLowerIsBetter(risks);
  const relS = scoreHigherIsBetter(rels);
  const liqS = scoreHigherIsBetter(liqs);

  const out = new Map<number, RouteFactorScores>();
  candidates.forEach((c, i) => {
    out.set(c.routeNo, {
      cost: round3(costS[i]!),
      speed: round3(speedS[i]!),
      risk: round3(riskS[i]!),
      reliability: round3(relS[i]!),
      liquidity: round3(liqS[i]!),
    });
  });
  return out;
}

/** Composite score = Σ weight_f · factorScore_f. */
function composite(w: RoutePreferenceWeights, s: RouteFactorScores): number {
  return round3(
    w.cost * s.cost +
    w.speed * s.speed +
    w.risk * s.risk +
    w.reliability * s.reliability +
    w.liquidity * s.liquidity,
  );
}

/** Human-readable math behind a score (used in selectionReason). */
function scoreMath(w: RoutePreferenceWeights, s: RouteFactorScores): string {
  const parts = [
    `${round3(w.cost)}·cost(${s.cost.toFixed(3)})`,
    `${round3(w.speed)}·speed(${s.speed.toFixed(3)})`,
    `${round3(w.risk)}·risk(${s.risk.toFixed(3)})`,
    `${round3(w.reliability)}·reliability(${s.reliability.toFixed(3)})`,
    `${round3(w.liquidity)}·liquidity(${s.liquidity.toFixed(3)})`,
  ];
  return parts.join(" + ");
}

function compareByCost(a: RouteCandidate, b: RouteCandidate): number {
  return compareMoney(a.totalEstimatedCost, b.totalEstimatedCost);
}

export class RouteOptimizerEngine {
  optimize(
    candidates: RouteCandidate[],
    criterion: SelectionCriterion,
    options: RouteOptimizerOptions = {},
  ): RouteOptimizationResult {
    const weights = normalizeWeights(
      options.weights ?? DEFAULT_CRITERION_WEIGHTS[criterion],
    );

    if (candidates.length === 0) {
      return {
        routes: [],
        selected: null,
        criterion,
        weights,
        comparison: [],
        savings: null,
        engineVersion: ROUTING_ENGINE_VERSION,
      };
    }

    const factorScoresMap = computeFactorScores(candidates);
    const now = options.now ?? Date.now();
    const intentId = options.paymentIntentId ?? "unknown";
    const quoteAsset = candidates[0]!.cost.quoteAsset;

    // Rank: score desc → cost asc → time asc → routeNo asc (deterministic).
    const ranked = [...candidates].sort((a, b) => {
      const sa = composite(weights, factorScoresMap.get(a.routeNo)!);
      const sb = composite(weights, factorScoresMap.get(b.routeNo)!);
      if (sa !== sb) return sb - sa;
      const costCmp = compareByCost(a, b);
      if (costCmp !== 0) return costCmp;
      if (a.estimatedTimeMs !== b.estimatedTimeMs) return a.estimatedTimeMs - b.estimatedTimeMs;
      return a.routeNo - b.routeNo;
    });

    const best = ranked[0]!;

    const routes = candidates.map((c) => {
      const factorScores = factorScoresMap.get(c.routeNo)!;
      const score = composite(weights, factorScores);
      const selected = c.routeNo === best.routeNo;
      const reason = selected
        ? `Selected route ${c.routeNo} — score ${score.toFixed(3)} = ${scoreMath(weights, factorScores)}. `
          + `Cost ${toDecimal(c.totalEstimatedCost)} ${quoteAsset}, time ${c.estimatedTimeMs}ms, risk ${c.risk.score.toFixed(3)}, reliability ${c.reliability.toFixed(3)}, liquidity ${c.liquidity.toFixed(3)}.`
        : `Route ${c.routeNo} — score ${score.toFixed(3)} = ${scoreMath(weights, factorScores)}. Ranked ${ranked.findIndex((r) => r.routeNo === c.routeNo) + 1} of ${candidates.length}.`;
      return {
        ...c,
        id: `route-${intentId}-${c.routeNo}`,
        paymentIntentId: intentId,
        status: selected ? ("SELECTED" as const) : ("REJECTED" as const),
        selectionScore: score,
        selectionReason: reason,
        factorScores,
        createdAt: now,
      };
    });

    const selected = routes.find((r) => r.status === "SELECTED") ?? null;
    const comparison: RouteComparisonRow[] = routes
      .slice()
      .sort((a, b) => a.routeNo - b.routeNo)
      .map((r) => ({
        routeNo: r.routeNo,
        totalCost: r.totalEstimatedCost,
        estimatedTimeMs: r.estimatedTimeMs,
        riskScore: r.risk.score,
        reliability: r.reliability,
        liquidity: r.liquidity,
        selectionScore: r.selectionScore,
      }));

    const savings = computeSavings(routes, selected, quoteAsset);

    return {
      routes,
      selected,
      criterion,
      weights,
      comparison,
      savings,
      engineVersion: ROUTING_ENGINE_VERSION,
    };
  }
}

/** Savings analysis: cheapest, selected, and the premium/savings math. */
export function computeSavings(
  routes: ReturnType<RouteOptimizerEngine["optimize"]>["routes"],
  selected: ReturnType<RouteOptimizerEngine["optimize"]>["routes"][number] | null,
  quoteAsset: string,
): RouteSavings | null {
  if (routes.length === 0) return null;

  const sorted = [...routes].sort(compareByCost);
  const cheapest = sorted[0]!;
  const mostExpensive = sorted[sorted.length - 1]!;

  if (!selected) {
    return {
      cheapestRouteNo: cheapest.routeNo,
      cheapestTotalCost: cheapest.totalEstimatedCost,
      selectedRouteNo: null,
      selectedTotalCost: null,
      mostExpensiveRouteNo: mostExpensive.routeNo,
      mostExpensiveTotalCost: mostExpensive.totalEstimatedCost,
      premiumVsCheapest: zero(quoteAsset),
      estimatedSavings: zero(quoteAsset),
      selectedIsCheapest: false,
      explanation: "No route selected — no savings to report.",
    };
  }

  const premiumVsCheapest = subMoney(selected.totalEstimatedCost, cheapest.totalEstimatedCost);
  const estimatedSavings = subMoney(mostExpensive.totalEstimatedCost, selected.totalEstimatedCost);
  const selectedIsCheapest = selected.routeNo === cheapest.routeNo;

  const explanation = selectedIsCheapest
    ? `Cheapest route is route ${cheapest.routeNo} (cost ${toDecimal(cheapest.totalEstimatedCost)} ${quoteAsset}). `
      + `Selected route ${selected.routeNo} is the cheapest, so the premium over the cheapest is 0. `
      + `It saves ${toDecimal(estimatedSavings)} ${quoteAsset} vs the most expensive viable route ${mostExpensive.routeNo} (cost ${toDecimal(mostExpensive.totalEstimatedCost)} ${quoteAsset}).`
    : `Cheapest route is route ${cheapest.routeNo} (cost ${toDecimal(cheapest.totalEstimatedCost)} ${quoteAsset}). `
      + `Selected route ${selected.routeNo} costs ${toDecimal(premiumVsCheapest)} ${quoteAsset} more than the cheapest (the premium paid for speed/reliability), `
      + `and saves ${toDecimal(estimatedSavings)} ${quoteAsset} vs the most expensive viable route ${mostExpensive.routeNo} (cost ${toDecimal(mostExpensive.totalEstimatedCost)} ${quoteAsset}).`;

  return {
    cheapestRouteNo: cheapest.routeNo,
    cheapestTotalCost: cheapest.totalEstimatedCost,
    selectedRouteNo: selected.routeNo,
    selectedTotalCost: selected.totalEstimatedCost,
    mostExpensiveRouteNo: mostExpensive.routeNo,
    mostExpensiveTotalCost: mostExpensive.totalEstimatedCost,
    premiumVsCheapest,
    estimatedSavings,
    selectedIsCheapest,
    explanation,
  };
}
