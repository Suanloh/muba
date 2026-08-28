/**
 * MOVA Phase 8 — browser-side trust layer bridge.
 *
 * Two jobs:
 *
 *   1. `buildPaymentExplanation(record, plan)` — the unified, human-facing
 *      "Payment Explanation" answering the 6 trust questions: what MOVA
 *      understood, why this route, which compliance checks passed, why
 *      hedging, what the user approved, and what happened on-chain. Every
 *      figure comes from the deterministic `PaymentPlan` (preview /
 *      recommendation / optimization) — never from raw LLM output.
 *
 *   2. Enriched decision payloads (`routeDecisionPayload`,
 *      `compliancePayload`, `riskPayload`, `hedgePayload`) — attached to the
 *      audit events the pipeline emits, so the audit trail carries the actual
 *      deterministic decision data (candidates, scores, verdicts), not just a
 *      state transition name.
 */
import type { PaymentExplanation, PaymentPreviewCompliance } from "@mova/types";
import type { PaymentRecord } from "@mova/wallet";
import type { PaymentPlan } from "./execution-engine";

// ---------------------------------------------------------------------------
// Payment Explanation — the 6 trust questions
// ---------------------------------------------------------------------------

/** Human-readable list of the compliance checks that were run (deterministic). */
export function complianceChecks(c: PaymentPreviewCompliance): string[] {
  return [
    `Counterparty screening — ${c.matchedLists.length > 0 ? `matched: ${c.matchedLists.join(", ")}` : "no matches"}`,
    `Risk score — ${c.riskScore}/100`,
    `Fail-closed — ${c.failClosed ? "enforced" : "not triggered"}`,
    `Verdict — ${c.decision}`,
  ];
}

/**
 * Build the full Phase 8 explanation for a record + its deterministic plan.
 * Pure derivation — throws nothing; missing plan data is simply reflected as
 * "pending".
 */
export function buildPaymentExplanation(
  record: PaymentRecord,
  plan: PaymentPlan | null,
): PaymentExplanation {
  const p = plan?.preview ?? null;
  const rec = plan?.recommendation ?? null;
  const opt = plan?.optimization ?? null;

  return {
    recordId: record.id,
    correlationId: record.correlationId,
    status: record.state,
    createdAt: record.createdAt,

    // 1 — What MOVA understood (the validated intent).
    understood: {
      rawText: record.rawText,
      action: record.action,
      amount: record.amount,
      recipient: record.recipient,
      network: record.network,
      memo: record.memo,
    },

    // 2 — Why this route.
    route: {
      routeNo: p?.route.routeNo ?? 0,
      routeId: p?.route.id ?? "",
      legOrder: p?.route.summary.legOrder ?? [],
      fees: p?.route.totalFee ?? { asset: record.amount.asset, amount: "0" },
      totalEstimatedCost: p?.route.totalEstimatedCost ?? { asset: record.amount.asset, amount: "0" },
      estimatedTimeMs: p?.route.estimatedTimeMs ?? 0,
      reliability: p?.route.reliability ?? 0,
      selectionReason: p?.route.selectionReason ?? "no route selected yet",
      candidateCount: opt?.routes.length ?? (p ? 1 : 0),
      savings: p?.savings ?? null,
      totalCost: p?.totalCost ?? { asset: record.amount.asset, amount: "0" },
    },

    // 3 — Which compliance checks passed.
    compliance: {
      decision: p?.compliance.decision ?? "REVIEW",
      riskScore: p?.compliance.riskScore ?? 0,
      failClosed: p?.compliance.failClosed ?? true,
      matchedLists: p?.compliance.matchedLists ?? [],
      checks: p ? complianceChecks(p.compliance) : ["Compliance not yet run — pending."],
      explanation: p?.compliance.explanation ?? "Compliance gate has not run yet.",
    },

    // 4 — Financial risk + why hedging was used.
    risk: {
      band: p?.risk.band ?? "LOW",
      score: p?.risk.score ?? 0,
      decision: p?.risk.decision ?? "PROCEED",
      topSignals: (p?.risk.signals ?? []).slice(0, 4).map((s) => ({
        description: s.description,
        value: s.value,
        threshold: s.threshold,
      })),
      explanation: p?.risk.explanation ?? "Risk assessment has not run yet.",
    },
    hedge: {
      decision: p?.hedge.decision ?? "NO_HEDGE",
      recommended: rec?.hedge.recommended ?? false,
      strategy: p?.hedge.strategy ?? "NONE",
      premium: p?.hedge.premium ?? { asset: record.amount.asset, amount: "0" },
      exposureReduction: p?.hedge.exposureReduction ?? { asset: record.amount.asset, amount: "0" },
      dataSource: p?.hedge.dataSource ?? "STATIC_DEV",
      explanation: p?.hedge.explanation ?? "No hedge decision yet.",
    },

    // 5 — What the user approved.
    approval: {
      status: record.approval?.status ?? "PENDING",
      decision: record.approval?.decision ?? null,
      approvedAt: record.approval?.resolvedAt ?? null,
      planDigest: p?.planDigest ?? "",
      authzNonce: record.authz?.nonce ?? null,
      expiresAt: p?.expiresAt ?? 0,
    },

    // 6 — What happened on-chain.
    onChain: {
      expectedSettlement: p?.expectedSettlement ?? "SIMULATED",
      status: record.settlement?.status ?? null,
      txDigest: record.settlement?.txDigest ?? null,
      simulated: record.settlement?.simulated ?? null,
      signedBy: record.settlement?.signedBy ?? null,
      signedAt: record.settlement?.signedAt ?? null,
      error: record.settlement?.error ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Enriched decision payloads (attached to audit events by the pipeline)
// ---------------------------------------------------------------------------

/** Route decision payload — candidates, selected route, cost calculation. */
export function routeDecisionPayload(plan: PaymentPlan) {
  const p = plan.preview;
  const opt = plan.optimization;
  const candidates = (opt?.routes ?? []).map((r) => ({
    routeNo: r.routeNo,
    id: r.id,
    totalFee: r.totalFee,
    totalEstimatedCost: r.totalEstimatedCost,
    estimatedTimeMs: r.estimatedTimeMs,
    reliability: r.reliability,
    riskScore: r.risk.score,
    selectionScore: r.selectionScore,
  }));
  return {
    routeNo: p.route.routeNo,
    routeId: p.route.id,
    legOrder: p.route.summary.legOrder,
    fees: p.route.totalFee,
    totalEstimatedCost: p.route.totalEstimatedCost,
    estimatedTimeMs: p.route.estimatedTimeMs,
    reliability: p.route.reliability,
    selectionReason: p.route.selectionReason,
    criterion: opt?.criterion ?? "COST",
    candidateCount: candidates.length,
    candidates,
    savings: p.savings,
    totalCost: p.totalCost,
  };
}

/** Compliance decision payload — verdict, score, lists checked, checks. */
export function compliancePayload(plan: PaymentPlan) {
  const c = plan.preview.compliance;
  return {
    decision: c.decision,
    riskScore: c.riskScore,
    failClosed: c.failClosed,
    matchedLists: c.matchedLists,
    checks: complianceChecks(c),
    explanation: c.explanation,
  };
}

/** Financial risk payload — band, score, decision, signals. */
export function riskPayload(plan: PaymentPlan) {
  const r = plan.preview.risk;
  return {
    band: r.band,
    score: r.score,
    decision: r.decision,
    signals: r.signals.map((s) => ({
      signalId: s.signalId,
      description: s.description,
      value: s.value,
      threshold: s.threshold,
    })),
    explanation: r.explanation,
  };
}

/** Hedge decision payload — decision, strategy, premium, exposure reduction. */
export function hedgePayload(plan: PaymentPlan) {
  const h = plan.preview.hedge;
  const rec = plan.recommendation.hedge;
  return {
    decision: h.decision,
    recommended: rec.recommended,
    strategy: h.strategy,
    premium: h.premium,
    exposureReduction: h.exposureReduction,
    dataSource: h.dataSource,
    reason: h.explanation,
  };
}
