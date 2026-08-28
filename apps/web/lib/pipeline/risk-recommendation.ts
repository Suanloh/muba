/**
 * MOVA Phase 6 — browser-side risk & hedge recommendation for a payment record.
 *
 * Runs the deterministic `HedgedRouteEngine` (route discovery → optimization →
 * risk assessment → hedge evaluation) against the demo provider set:
 *
 *   - MockMarketDataProvider        (deterministic simulated prices)
 *   - StaticThetanutsHedgingProvider(cached dev quote table, simulated)
 *   - StaticVolatilityProvider      (cached dev volatility table)
 *
 * Every figure is deterministic and honest: static/dev data is flagged
 * `simulated: true` / `STATIC_DEV`; if the live Thetanuts integration were
 * used and unavailable, the hedge decision would report `UNAVAILABLE` — never
 * a fabricated live quote. The result feeds MOVA's final payment
 * recommendation shown in the RiskAssessmentPanel.
 */
import { HedgedRouteEngine } from "@mova/core";
import {
  MockMarketDataProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
} from "@mova/integrations";
import type {
  ParsedIntent,
  PaymentIntent,
  PaymentRecommendation,
  RouteHedgeComparison,
} from "@mova/types";
import type { PaymentRecord } from "@mova/wallet";

/** Deterministic simulated price table (dev/demo). */
const PRICES: Record<string, string> = {
  SUI: "1.000000",
  USDC: "1.000000",
  MOV: "0.400000",
  MYR: "0.240000",
};

/** Assets the demo payer can source from. */
const DEMO_FUNDED_ASSETS = ["USDC", "SUI", "MOV", "MYR"];

export interface RiskView {
  recommendation: PaymentRecommendation;
  comparisons: RouteHedgeComparison[];
}

function toParsedIntent(record: PaymentRecord): ParsedIntent {
  return {
    id: `pi-${record.id}`,
    paymentIntentId: record.id,
    action: record.action,
    amount: record.amount,
    recipient: record.recipient,
    network: record.network,
    scheduleAt: null,
    memo: record.memo,
    confidence: 1,
    needsClarification: false,
    clarificationQuestion: null,
    rawLlmOutput: null,
    validationStatus: "VALIDATED",
    validatorNotes: [],
    canonicalAmount: record.amount,
    createdAt: record.createdAt,
  };
}

function toPaymentIntent(record: PaymentRecord): PaymentIntent {
  return {
    id: record.id,
    correlationId: record.correlationId,
    intentRef: `PAY-${record.id.slice(0, 8)}`,
    userId: "demo-user",
    walletId: "demo-wallet",
    source: "CHAT",
    rawText: record.rawText,
    network: record.network,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Deterministic risk + hedge assessment for a payment record. Runs fully in the
 * browser with the mock/static provider set (dev/demo mode).
 */
export async function assessPaymentRisk(record: PaymentRecord): Promise<RiskView> {
  const marketData = new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 });
  const volatility = new StaticVolatilityProvider({ allowed: true });
  const hedging = new StaticThetanutsHedgingProvider({ allowed: true });

  const engine = new HedgedRouteEngine(marketData, hedging, volatility, {
    availableAssets: DEMO_FUNDED_ASSETS,
    horizonDays: 7,
  });
  const result = await engine.compute(
    toPaymentIntent(record),
    toParsedIntent(record),
    "COST",
  );

  return {
    recommendation: result.recommendation,
    comparisons: result.comparisons,
  };
}
