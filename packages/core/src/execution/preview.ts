/**
 * MOVA Phase 7 — payment preview builder.
 *
 * Assembles the deterministic `PaymentPreview` — everything the human must
 * understand before approving — from validated record state, the signed
 * `TransactionSpec`, the routing optimization (savings), the financial risk +
 * hedge recommendation, and the compliance verdict. No LLM output appears here.
 */
import type {
  PaymentPreview,
  PaymentPreviewCompliance,
  PaymentPreviewHedge,
  PaymentPreviewRoute,
  RouteHedgeComparison,
  RouteOptimizationResult,
  RiskAssessment,
  Route,
  TransactionSpec,
} from "@mova/types";
import type { PaymentRecord } from "@mova/wallet";

export interface BuildPreviewInput {
  record: Pick<PaymentRecord, "id" | "correlationId" | "action" | "recipient" | "amount" | "network">;
  spec: TransactionSpec;
  optimization: RouteOptimizationResult;
  selected: Route;
  risk: RiskAssessment;
  hedge: RouteHedgeComparison;
  compliance: PaymentPreviewCompliance;
  expectedSettlement: "REAL" | "SIMULATED";
  createdAt?: number;
}

function toRouteView(route: Route): PaymentPreviewRoute {
  return {
    id: route.id,
    routeNo: route.routeNo,
    summary: route.summary,
    totalFee: route.totalFee,
    totalEstimatedCost: route.totalEstimatedCost,
    estimatedTimeMs: route.estimatedTimeMs,
    reliability: route.reliability,
    selectionReason: route.selectionReason,
  };
}

function toHedgeView(hedge: RouteHedgeComparison): PaymentPreviewHedge {
  return {
    strategy: hedge.strategy,
    decision: hedge.hedgeDecision,
    dataSource: hedge.dataSource,
    premium: hedge.delta,
    exposureReduction: hedge.exposureReduction,
    explanation: hedge.reason,
  };
}

/** Deterministically assemble the preview for a signed spec. */
export function buildPaymentPreview(input: BuildPreviewInput): PaymentPreview {
  const { record, spec } = input;
  return {
    recordId: record.id,
    correlationId: record.correlationId,
    clientRequestId: spec.clientRequestId,
    action: record.action,
    recipient: record.recipient,
    amount: record.amount,
    suiDestination: spec.recipient,
    route: toRouteView(input.selected),
    savings: input.optimization.savings,
    compliance: input.compliance,
    risk: input.risk,
    hedge: toHedgeView(input.hedge),
    totalCost: input.hedge.hedgeDecision === "HEDGE" ? input.hedge.withHedge : input.hedge.withoutHedge,
    expectedSettlement: input.expectedSettlement,
    planDigest: spec.planDigest,
    createdAt: input.createdAt ?? spec.createdAt,
    expiresAt: spec.expiresAt,
  };
}

/** Single-line human summary of the preview (notifications / logs). */
export function summarizePreview(preview: PaymentPreview): string {
  const hedge = preview.hedge.decision === "HEDGE" ? ` + hedge ${preview.hedge.strategy}` : "";
  return [
    `${preview.action} ${preview.amount.amount} ${preview.amount.asset}`,
    `→ ${preview.suiDestination}`,
    `route ${preview.route.routeNo} (${preview.route.summary.legOrder.join("→")})`,
    `cost ${preview.totalCost.amount} ${preview.totalCost.asset}${hedge}`,
    `risk ${preview.risk.band} ${preview.risk.score}/100`,
    `compliance ${preview.compliance.decision}`,
    `settlement ${preview.expectedSettlement}`,
    `digest ${preview.planDigest.slice(0, 12)}…`,
  ].join(" · ");
}
