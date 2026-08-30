/**
 * MOVA Unified Plan Review runner (requirement 3).
 *
 * The plan review is a SINGLE unified prompt → one `runPlanReview` call runs
 * the whole downstream pipeline automatically — no extra user prompts:
 *
 *   a. Strategy Analysis            — intent parsed, routes discovered & ranked
 *   b. Compliance & Regulatory Check — counterparty screened (fail-closed)
 *   c. Risk & Route Optimization    — exposure assessed, route + hedge chosen
 *   d. Preview                      — signed plan digest assembled for approval
 *
 * The heavy lifting is the REAL deterministic engine (`buildPaymentPlan` →
 * `@mova/core` PaymentExecutionEngine). This wrapper overlays a live-run event
 * stream so the UI can show step-by-step progress WHILE the plan is being
 * built. Every "done" event carries real engine output (routes compared,
 * compliance verdict, risk band, hedge, digest) — never fabricated numbers.
 */
import type { PaymentRecord } from "@mova/wallet";
import { buildPaymentPlan, type PaymentPlan } from "./execution-engine";
import { formatMoney } from "./format";

export type PlanReviewStage = "strategy" | "compliance" | "risk" | "preview";

export interface LiveRunEntry {
  id: string;
  at: number;
  stage: PlanReviewStage;
  kind: "run" | "ok" | "warn" | "fail" | "info";
  text: string;
}

export interface RunPlanReviewOptions {
  sender: string;
  expectedSettlement?: "REAL" | "SIMULATED";
  /** Called for every streamed live-run event (in order). */
  onEntry?: (entry: LiveRunEntry) => void;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function entry(
  stage: PlanReviewStage,
  kind: LiveRunEntry["kind"],
  text: string,
): LiveRunEntry {
  return { id: crypto.randomUUID(), at: Date.now(), stage, kind, text };
}

export async function runPlanReview(
  record: PaymentRecord,
  opts: RunPlanReviewOptions,
): Promise<PaymentPlan> {
  const emit = (e: LiveRunEntry) => opts.onEntry?.(e);

  // Kick off the real engine immediately so it computes while the log streams.
  const planPromise = buildPaymentPlan(record, {
    sender: opts.sender,
    expectedSettlement: opts.expectedSettlement ?? "SIMULATED",
  });

  // 1) Strategy analysis — "running" phase.
  emit(
    entry(
      "strategy",
      "run",
      "Strategy analysis — parsing intent, discovering rails & quoting routes…",
    ),
  );
  await delay(240);

  // 2) Compliance — "running" phase.
  emit(
    entry(
      "compliance",
      "run",
      "Compliance & regulatory check — screening counterparty & transaction limits…",
    ),
  );
  await delay(280);

  // 3) Risk & route optimization — "running" phase.
  emit(
    entry(
      "risk",
      "run",
      "Risk & route optimization — assessing exposure, comparing hedges…",
    ),
  );

  // Real plan resolves (may throw on a blocking outcome — surfaced below).
  let plan: PaymentPlan;
  try {
    plan = await planPromise;
  } catch (err) {
    emit(
      entry(
        "preview",
        "fail",
        `Plan review halted — ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    throw err;
  }

  const optimization = plan.optimization;
  const rec = plan.recommendation;
  const preview = plan.preview;
  const selected = optimization.selected;

  // a) Strategy analysis result — real route count, selection & savings.
  const routeLabel = selected
    ? `#${selected.routeNo} ${selected.summary.legOrder.join(" → ")}`
    : "—";
  const savings =
    optimization.savings && !optimization.savings.selectedIsCheapest
      ? ` · saves ${formatMoney(optimization.savings.estimatedSavings)} vs most expensive`
      : "";
  emit(
    entry(
      "strategy",
      "ok",
      `Strategy — ${optimization.routes.length} route(s) ranked, selected ${routeLabel}${savings}`,
    ),
  );
  await delay(180);

  // b) Compliance result — real fail-closed verdict.
  const compliance = preview.compliance;
  emit(
    entry(
      "compliance",
      compliance.decision === "ALLOW"
        ? "ok"
        : compliance.decision === "REVIEW"
          ? "warn"
          : "fail",
      `Compliance ${compliance.decision === "ALLOW" ? "passed" : compliance.decision === "REVIEW" ? "flagged for review" : "blocked"} — ${compliance.explanation}`,
    ),
  );
  await delay(180);

  // c) Risk & route optimization result — real score, band & hedge decision.
  const hedgeTxt = rec.hedged
    ? `hedge ${rec.hedge.strategy} applied (+${formatMoney(rec.hedge.delta)})`
    : "no hedge needed";
  emit(
    entry(
      "risk",
      rec.decision === "BLOCK" ? "fail" : rec.decision === "REVIEW" ? "warn" : "ok",
      `Risk ${rec.risk.score}/100 (${rec.risk.band}) · ${hedgeTxt} · decision ${rec.decision}`,
    ),
  );
  await delay(160);

  // d) Preview — signed plan digest, ready for human approval.
  emit(
    entry(
      "preview",
      "ok",
      `Plan ready — digest ${plan.spec.planDigest.slice(0, 12)}… awaiting your approval`,
    ),
  );

  return plan;
}

/** Human label for each pipeline stage (used by the Live Run widget). */
export const STAGE_LABELS: Record<PlanReviewStage, string> = {
  strategy: "Strategy analysis",
  compliance: "Compliance check",
  risk: "Risk & route",
  preview: "Preview",
};
