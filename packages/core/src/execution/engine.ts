/**
 * MOVA Phase 7 — Payment Execution Engine.
 *
 * The deterministic orchestrator for the complete payment pipe:
 *
 *   Input → Intent Parsing → Intent Validation → Route Discovery → Route
 *   Optimization → Compliance → Risk/Hedge → Payment Explanation → Payment
 *   Preview (Human Approval) → [Wallet authz → Execution → Sui Settlement]
 *
 * `buildPlan` runs the deterministic engines (routing, compliance, risk,
 * hedge) and produces BOTH the signed `TransactionSpec` and the human-facing
 * `PaymentPreview`. The preview's digest is what the human approves; execution
 * later rebuilds and verifies the same digest before building any on-chain
 * transaction. The AI never contributes to the spec.
 *
 * This is the "Payment Explanation" + deterministic txn-construction layer of
 * Phase 7. Execution/settlement itself lives in the web layer (gate → wallet
 * authz → real-or-simulated Sui settlement), using only this spec.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  HedgingProvider,
  MarketDataProvider,
  ScreeningProvider,
  VolatilityProvider,
} from "@mova/integrations";
import type {
  Money,
  Network,
  ParsedIntent,
  PaymentIntent,
  PaymentPreview,
  RecipientType,
  SelectionCriterion,
  TransactionSpec,
} from "@mova/types";
import { HedgedRouteEngine, type HedgedRouteOptions } from "../risk/recommendation.js";
import { buildTransactionSpec, type BuildSpecInput } from "./plan.js";
import { runComplianceGate, type ComplianceContext } from "./compliance.js";
import { buildPaymentPreview } from "./preview.js";

export interface ExecutionEngineDeps {
  marketData: MarketDataProvider;
  screening: ScreeningProvider;
  hedging: HedgingProvider;
  volatility: VolatilityProvider;
}

export interface BuildPlanInput {
  intent: PaymentIntent;
  parsed: ParsedIntent;
  record: {
    id: string;
    correlationId: string;
    action: "PAY" | "TRANSFER";
    recipient: { type: RecipientType; value: string; name: string | null };
    amount: Money;
  };
  clientRequestId: string;
  sender: string;
  network: Network;
  criterion?: SelectionCriterion;
  /** Compliance screening context (name + identifier to screen). */
  compliance?: ComplianceContext;
  expectedSettlement?: "REAL" | "SIMULATED";
  now?: number;
  ttlMs?: number;
  hedgedRoute?: HedgedRouteOptions;
}

export interface BuildPlanResult {
  preview: PaymentPreview;
  spec: TransactionSpec;
  /** The Phase 6 recommendation (route + risk + hedge) for the UI. */
  recommendation: Awaited<ReturnType<HedgedRouteEngine["compute"]>>["recommendation"];
  comparisons: Awaited<ReturnType<HedgedRouteEngine["compute"]>>["comparisons"];
  optimization: Awaited<ReturnType<HedgedRouteEngine["compute"]>>["optimization"];
}

/**
 * Run the full deterministic pipe and produce the signed spec + preview.
 * Fail-closed: invalid recipient, blocked compliance, or no selected route all
 * throw typed MovaErrors — nothing partial is ever returned.
 */
export class PaymentExecutionEngine {
  constructor(private readonly deps: ExecutionEngineDeps) {}

  async buildPlan(input: BuildPlanInput): Promise<BuildPlanResult> {
    const now = input.now ?? Date.now();

    // 1) Deterministic intent validation is upstream (intent-validator). Here
    //    we only sanity-check the fields the spec needs (recipient/amount).
    if (!input.record.recipient?.value) {
      throw new MovaError(ErrorCode.INTENT_VALIDATION_FAILED, "no recipient to route to");
    }
    if (BigInt(input.record.amount.amount) <= 0n) {
      throw new MovaError(ErrorCode.INTENT_VALIDATION_FAILED, "amount must be positive");
    }

    // 2) Route discovery → optimization → risk → hedge (Phase 4 + 6).
    const hedged = new HedgedRouteEngine(
      this.deps.marketData,
      this.deps.hedging,
      this.deps.volatility,
      { now, ...(input.hedgedRoute ?? {}) },
    );
    const result = await hedged.compute(
      input.intent,
      input.parsed,
      input.criterion ?? "COST",
    );

    // 3) Compliance (fail-closed — never ALLOW on engine error).
    const compliance = await runComplianceGate(this.deps.screening, input.compliance ?? {
      name: input.record.recipient.name ?? null,
      identifier: input.record.recipient.value ?? null,
    });

    // 4) If compliance outright blocks, refuse to produce an executable plan.
    if (compliance.decision === "BLOCK") {
      throw new MovaError(ErrorCode.COMPLIANCE_BLOCKED, compliance.explanation, {
        details: { matchedLists: compliance.matchedLists },
      });
    }

    const selected = result.recommendation.route;
    const rec = result.recommendation;

    // 5) Construct the deterministic transaction spec from validated state.
    const spec: TransactionSpec = buildTransactionSpec({
      clientRequestId: input.clientRequestId,
      recordId: input.record.id,
      correlationId: input.record.correlationId,
      sender: input.sender,
      recipient: input.record.recipient.value,
      amount: input.record.amount,
      network: input.network,
      routeId: selected.id,
      fees: rec.totalCost, // total cost as the "fees" of this single-leg native transfer
      totalCost: rec.totalCost,
      kind: "NATIVE_TRANSFER",
      createdAt: now,
      ttlMs: input.ttlMs,
    } satisfies BuildSpecInput);

    // 6) Assemble the payment preview (the human-facing explanation).
    const preview: PaymentPreview = buildPaymentPreview({
      record: { ...input.record, network: input.network },
      spec,
      optimization: result.optimization,
      selected,
      risk: rec.risk,
      hedge: rec.hedge,
      compliance,
      expectedSettlement: input.expectedSettlement ?? "REAL",
      createdAt: now,
    });

    return { preview, spec, recommendation: rec, comparisons: result.comparisons, optimization: result.optimization };
  }
}
