/**
 * MOVA Phase 7 — browser-side payment execution engine bridge.
 *
 * Runs the full deterministic pipe for a `PaymentRecord` and produces the
 * signed `TransactionSpec` + human-facing `PaymentPreview`:
 *
 *   Intent → Validation (upstream) → Route Discovery → Route Optimization →
 *   Compliance (screening) → Risk/Hedge → Payment Explanation → Preview
 *
 * Uses the same mock/static provider set as the Phase 6 risk panel so figures
 * are reproducible in the browser (all flagged simulated/STATIC_DEV — never
 * faked as live). The preview digest is what the human approves; the wallet
 * authz records it; execution rebuilds + verifies the digest before building
 * any on-chain transaction.
 */
import {
  PaymentExecutionEngine,
  type BuildPlanResult,
} from "@mova/core";
import {
  MockMarketDataProvider,
  MockScreeningProvider,
  StaticThetanutsHedgingProvider,
  StaticVolatilityProvider,
} from "@mova/integrations";
import type {
  ParsedIntent,
  PaymentIntent,
  PaymentPreview,
  TransactionSpec,
} from "@mova/types";
import type { PaymentRecord } from "@mova/wallet";
import { EXPECTED_NETWORK } from "@/lib/wallet/networks";

/** Deterministic simulated price table (dev/demo). */
const PRICES: Record<string, string> = {
  SUI: "1.000000",
  USDC: "1.000000",
  MOV: "0.400000",
  MYR: "0.240000",
};

/** Assets the demo payer can source from. */
const DEMO_FUNDED_ASSETS = ["USDC", "SUI", "MOV", "MYR"];

export interface PaymentPlan {
  preview: PaymentPreview;
  spec: TransactionSpec;
  recommendation: BuildPlanResult["recommendation"];
  comparisons: BuildPlanResult["comparisons"];
  /** Phase 8 — full route candidates + optimization result (audit/explanation). */
  optimization: BuildPlanResult["optimization"];
}

/** The deterministic risk + hedge view shown in the RiskAssessmentPanel. */
export interface RiskView {
  recommendation: BuildPlanResult["recommendation"];
  comparisons: BuildPlanResult["comparisons"];
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
 * Run the full pipe for a validated payment record and return the signed spec
 * + preview. Deterministic; throws typed MovaErrors on blocking outcomes
 * (invalid recipient, compliance BLOCK, no route).
 */
export async function buildPaymentPlan(
  record: PaymentRecord,
  opts: {
    sender: string;
    expectedSettlement?: "REAL" | "SIMULATED";
    now?: number;
    ttlMs?: number;
  },
): Promise<PaymentPlan> {
  const engine = new PaymentExecutionEngine({
    marketData: new MockMarketDataProvider({ allowed: true, prices: PRICES, spreadBps: 5 }),
    screening: new MockScreeningProvider({ allowed: true }),
    hedging: new StaticThetanutsHedgingProvider({ allowed: true }),
    volatility: new StaticVolatilityProvider({ allowed: true }),
  });

  const { preview, spec, recommendation, comparisons, optimization } = await engine.buildPlan({
    intent: toPaymentIntent(record),
    parsed: toParsedIntent(record),
    record: {
      id: record.id,
      correlationId: record.correlationId,
      action: record.action === "TRANSFER" ? "TRANSFER" : "PAY",
      recipient: record.recipient,
      amount: record.amount,
    },
    clientRequestId: `mova-${record.correlationId}`,
    sender: opts.sender,
    network: EXPECTED_NETWORK,
    criterion: "COST",
    expectedSettlement: opts.expectedSettlement ?? "REAL",
    now: opts.now,
    ttlMs: opts.ttlMs ?? 15 * 60 * 1000,
    hedgedRoute: { availableAssets: DEMO_FUNDED_ASSETS, horizonDays: 7 },
  });

  return { preview, spec, recommendation, comparisons, optimization };
}
