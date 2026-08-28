/**
 * MOVA Phase 6 — Deterministic financial risk assessment.
 *
 * Scores the financial exposure of a routed payment across five explainable
 * signals and maps the result to a risk band + decision:
 *
 *   1. ASSET_VOLATILITY — VaR of the settlement token over the horizon
 *   2. FX_EXPOSURE      — VaR of the conversion leg when the source asset
 *                         differs from the settlement token (FX risk)
 *   3. ROUTE_RISK       — the route's composite leg-risk factor
 *   4. LIQUIDITY_RISK   — illiquidity of the least-liquid leg
 *   5. SETTLEMENT_RISK  — reliability of the final settlement leg
 *
 *   signal contribution (0..100)  = for VaR signals: min(100, varPct / 5% · 100)
 *   risk score (0..100)           = Σ weight_i · contribution_i   (Σ weights = 1)
 *   band / decision:  LOW→PROCEED, MEDIUM→PROCEED, HIGH→REVIEW, CRITICAL→BLOCK
 *
 * No LLM, no network randomness; every number is reproducible. Volatility data
 * comes from a `VolatilityProvider` (live Thetanuts greeks or static dev
 * table). When volatility is unavailable the signal reports 0 and records the
 * gap — MOVA never fabricates a risk number.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  MarketDataProvider,
  VolatilityProvider,
} from "@mova/integrations";
import type {
  HedgingPlan,
  PaymentIntent,
  RiskAssessment,
  RiskBand,
  RiskDecision,
  RiskSignal,
  Route,
  RouteCandidate,
  RouteLeg,
  VolatilitySnapshot,
} from "@mova/types";
import { ONE_PRICE, toBigInt, toDecimal, toQuote, zero } from "../routing/money.js";
import { clamp100, round3, valueAtRisk } from "./volatility.js";

export interface RiskWeights {
  assetVolatility: number;
  fxExposure: number;
  routeRisk: number;
  liquidityRisk: number;
  settlementRisk: number;
}

/** Default signal weights (sum to 1). Deterministic, never AI-generated. */
export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  assetVolatility: 0.25,
  fxExposure: 0.25,
  routeRisk: 0.2,
  liquidityRisk: 0.15,
  settlementRisk: 0.15,
};

export interface RiskEngineContext {
  marketData: MarketDataProvider;
  volatility: VolatilityProvider;
  /** Common numeraire for exposure (default "USDC"). */
  quoteAsset?: string;
  /** Exposure horizon in days (default 1). */
  horizonDays?: number;
  /** Confidence level for VaR (default 0.95). */
  confidenceLevel?: number;
  /** Explicit signal weights — override the defaults (normalized to sum 1). */
  weights?: Partial<RiskWeights>;
  now?: number;
}

export const RISK_ENGINE_VERSION = "1.0.0";

/** Reference adverse move that maps to a full 100 contribution (5% of notional). */
const VAR_REFERENCE_PCT = 0.05;

/** Normalize risk weights to sum to 1 (validated, deterministic). */
export function normalizeRiskWeights(w: RiskWeights): RiskWeights {
  const sum =
    w.assetVolatility + w.fxExposure + w.routeRisk + w.liquidityRisk + w.settlementRisk;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new MovaError(
      ErrorCode.VALIDATION_ERROR,
      "risk weights must be finite, non-negative and sum to > 0",
    );
  }
  return {
    assetVolatility: w.assetVolatility / sum,
    fxExposure: w.fxExposure / sum,
    routeRisk: w.routeRisk / sum,
    liquidityRisk: w.liquidityRisk / sum,
    settlementRisk: w.settlementRisk / sum,
  };
}

function bandOf(score: number): RiskBand {
  if (score < 25) return "LOW";
  if (score < 50) return "MEDIUM";
  if (score < 75) return "HIGH";
  return "CRITICAL";
}

function decisionOf(band: RiskBand): RiskDecision {
  switch (band) {
    case "LOW":
    case "MEDIUM":
      return "PROCEED";
    case "HIGH":
      return "REVIEW";
    case "CRITICAL":
      return "BLOCK";
  }
}

/** Deterministic placeholder hedging plan — the hedging engine replaces it. */
function pendingHedgingPlan(quoteAsset: string, now: number): HedgingPlan {
  return {
    recommended: false,
    strategy: "NONE",
    provider: "",
    params: {},
    estimatedCost: zero(quoteAsset),
    expiresAt: now,
    dataSource: "UNAVAILABLE",
    note: "Hedge evaluation pending — computed by the hedging engine.",
  };
}

export class RiskEngine {
  private readonly quoteAsset: string;
  private readonly horizonDays: number;
  private readonly confidenceLevel: number;
  private readonly weights: RiskWeights;

  constructor(private readonly ctx: RiskEngineContext) {
    this.quoteAsset = ctx.quoteAsset ?? "USDC";
    this.horizonDays = ctx.horizonDays ?? 1;
    this.confidenceLevel = ctx.confidenceLevel ?? 0.95;
    this.weights = normalizeRiskWeights({
      ...DEFAULT_RISK_WEIGHTS,
      ...ctx.weights,
    });
  }

  /** Settlement token amount of the route (the final leg's amount). */
  private targetAmount(route: RouteCandidate): { asset: string; amount: bigint } {
    const leg = route.legs[route.legs.length - 1]!;
    return { asset: leg.amount.asset, amount: toBigInt(leg.amount) };
  }

  private async midPrice(asset: string): Promise<string> {
    if (asset === this.quoteAsset) return ONE_PRICE;
    const q = await this.ctx.marketData.getQuote({ base: asset, quote: this.quoteAsset });
    return q.price;
  }

  /** Volatility snapshot for an asset, or null when unavailable (never guessed). */
  private async volatilityFor(asset: string): Promise<VolatilitySnapshot | null> {
    try {
      return await this.ctx.volatility.getVolatility({
        asset,
        horizonDays: this.horizonDays,
        confidenceLevel: this.confidenceLevel,
      });
    } catch (err) {
      if (err instanceof MovaError && err.code === ErrorCode.INTEGRATION_UNAVAILABLE) {
        return null;
      }
      throw err;
    }
  }

  /**
   * VaR contribution (0..100): min(100, varPct / 5% · 100). `varPct` is the
   * fraction of the quote-asset notional at risk over the horizon.
   */
  private varContribution(
    varMoney: bigint,
    notionalUsdc: bigint,
  ): { contribution: number; varPct: number; varMoney: bigint } {
    const varPct = notionalUsdc > 0n ? Number(varMoney) / Number(notionalUsdc) : 0;
    const contribution = clamp100((varPct / VAR_REFERENCE_PCT) * 100);
    return { contribution, varPct, varMoney };
  }

  /**
   * Assess financial risk for a routed payment. `parsed.canonicalAmount` is not
   * required — the route's settlement leg is the authoritative target amount.
   */
  async assess(intent: PaymentIntent, route: RouteCandidate | Route): Promise<RiskAssessment> {
    const now = this.ctx.now ?? Date.now();
    const target = this.targetAmount(route);
    const notionalUsdc = toBigInt(toQuote({ asset: target.asset, amount: target.amount.toString() }, this.quoteAsset, await this.midPrice(target.asset)));

    const vol = await this.volatilityFor(target.asset);
    const varMoney =
      vol === null
        ? 0n
        : valueAtRisk(notionalUsdc, vol.dailyVol, this.horizonDays, this.confidenceLevel);
    const assetVol = this.varContribution(varMoney, notionalUsdc);

    // FX exposure: the conversion leg when source != settlement token.
    const hasConversion = route.summary.hasConversion;
    let fx: { contribution: number; varPct: number; varMoney: bigint } = {
      contribution: 0,
      varPct: 0,
      varMoney: 0n,
    };
    const fxSource = hasConversion ? route.summary.sourceAsset : null;
    if (fxSource !== null) {
      const fxVol = await this.volatilityFor(fxSource);
      if (fxVol !== null) {
        const fxVar = valueAtRisk(notionalUsdc, fxVol.dailyVol, this.horizonDays, this.confidenceLevel);
        fx = this.varContribution(fxVar, notionalUsdc);
      }
    }

    const routeRiskLevel = route.risk.score;
    const liquidityLevel = 1 - route.liquidity;
    const settlementLeg = route.legs.find((l) => l.kind === "SETTLEMENT") as RouteLeg | undefined;
    const settlementReliability = settlementLeg?.reliability ?? 1;
    const settlementLevel = 1 - settlementReliability;

    const signals: RiskSignal[] = [
      this.signal(
        "ASSET_VOLATILITY",
        `Value-at-Risk of the settlement token ${target.asset} over ${this.horizonDays}d @ ${(this.confidenceLevel * 100).toFixed(0)}% confidence`,
        vol === null
          ? "unavailable"
          : `${(assetVol.varPct * 100).toFixed(2)}% of notional (${toDecimal({ asset: this.quoteAsset, amount: varMoney.toString() })} ${this.quoteAsset})`,
        "5% of notional (reference adverse move)",
        this.weights.assetVolatility,
        assetVol.contribution,
        vol === null
          ? "Volatility data unavailable — no VaR computed (data gap recorded, not guessed)."
          : `VaR = notional × z(${this.confidenceLevel}) × dailyVol(${vol.dailyVol.toFixed(4)}) × √${this.horizonDays} = ${(assetVol.varPct * 100).toFixed(2)}% of notional.`,
      ),
      this.signal(
        "FX_EXPOSURE",
        hasConversion
          ? `FX exposure on the ${fxSource} → ${target.asset} conversion leg`
          : "FX exposure (direct settlement, no conversion leg)",
        hasConversion ? `${(fx.varPct * 100).toFixed(2)}% of notional` : "0.00% — no conversion leg",
        "5% of notional (reference adverse move)",
        this.weights.fxExposure,
        fx.contribution,
        hasConversion
          ? `The source asset ${fxSource} is priced in ${target.asset}; its adverse move over the horizon is VaR ${(fx.varPct * 100).toFixed(2)}% of notional.`
          : "Payer settles directly in the settlement token — no currency conversion, no FX exposure.",
      ),
      this.signal(
        "ROUTE_RISK",
        "Composite risk factor of the route's legs",
        routeRiskLevel.toFixed(3),
        "0 (safest) to 1 (riskiest)",
        this.weights.routeRisk,
        clamp100(routeRiskLevel * 100),
        `Weighted mean of the legs' deterministic risk factors (${route.risk.factors.length} factor(s)).`,
      ),
      this.signal(
        "LIQUIDITY_RISK",
        "Illiquidity of the least-liquid leg",
        liquidityLevel.toFixed(3),
        "0 (liquid) to 1 (illiquid)",
        this.weights.liquidityRisk,
        clamp100(liquidityLevel * 100),
        `Minimum leg liquidity is ${route.liquidity.toFixed(3)}; the lower the liquidity, the higher the slippage risk.`,
      ),
      this.signal(
        "SETTLEMENT_RISK",
        "Unreliability of the final settlement leg",
        settlementLevel.toFixed(3),
        "0 (reliable) to 1 (unreliable)",
        this.weights.settlementRisk,
        clamp100(settlementLevel * 100),
        `Settlement leg reliability is ${settlementReliability.toFixed(3)} via ${settlementLeg?.provider ?? "SETTLEMENT"}.`,
      ),
    ];

    const score = Math.round(
      signals.reduce((acc, s) => acc + s.weight * s.contribution, 0),
    );
    const band = bandOf(score);
    const decision = decisionOf(band);

    const explanation = [
      `Financial risk score ${score}/100 (band ${band}) — ${band === "LOW" ? "low" : band === "MEDIUM" ? "medium" : band === "HIGH" ? "high" : "critical"} exposure for payment ${intent.id}.`,
      ...signals.map(
        (s) =>
          `  ${s.signalId}: ${s.contribution}/100 (weight ${round3(s.weight)}) — ${s.description.toLowerCase()}. ${s.note}`,
      ),
      `Decision: ${decision}.`,
    ].join("\n");

    return {
      id: `risk-${intent.id}-${route.routeNo}`,
      paymentIntentId: intent.id,
      routeId: `route-${intent.id}-${route.routeNo}`,
      band,
      score,
      signals,
      hedging: pendingHedgingPlan(this.quoteAsset, now),
      decision,
      engineVersion: RISK_ENGINE_VERSION,
      explanation,
      createdAt: now,
    };
  }

  private signal(
    signalId: string,
    description: string,
    value: string,
    threshold: string,
    weight: number,
    contribution: number,
    note: string,
  ): RiskSignal {
    return {
      signalId,
      description,
      value,
      threshold,
      weight: round3(weight),
      contribution: Math.round(contribution * 1000) / 1000,
      note,
    };
  }
}
