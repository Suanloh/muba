/**
 * MOVA Phase 7 — compliance gate for the execution pipe (deterministic).
 *
 * Runs counterparty screening through a `ScreeningProvider` and produces the
 * compliance verdict shown in the payment preview. Fail-closed: any provider
 * error, unknown data, or unavailable engine => REVIEW/BLOCK, never ALLOW.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  ComplianceDecision,
  PaymentPreviewCompliance,
  ScreeningDecision,
} from "@mova/types";
import type { ScreeningProvider } from "@mova/integrations";

export interface ComplianceContext {
  name: string | null;
  /** Address / account identifier to screen. */
  identifier: string | null;
  listVersion?: string;
}

/** Deterministic mapping of a screening decision into the preview verdict. */
export function screeningToCompliance(
  decision: ScreeningDecision,
  matchedLists: string[],
  score: number,
  listVersion: string,
): PaymentPreviewCompliance {
  switch (decision) {
    case "HIT":
      return {
        decision: "BLOCK",
        riskScore: score,
        failClosed: false,
        matchedLists,
        explanation: `Counterparty matched ${matchedLists.join(", ")} — payment blocked (fail-closed).`,
      };
    case "REVIEW":
      return {
        decision: "REVIEW",
        riskScore: score,
        failClosed: true,
        matchedLists,
        explanation: "Counterparty could not be cleared with confidence — review required before execution.",
      };
    case "CLEAR":
      return {
        decision: "ALLOW",
        riskScore: score,
        failClosed: false,
        matchedLists,
        explanation: `Counterparty cleared against ${listVersion}.`,
      };
  }
}

/**
 * Run the compliance gate. Returns a fail-closed verdict — a throwing or
 * unavailable provider yields REVIEW (the human can still review), never an
 * automatic ALLOW.
 */
export async function runComplianceGate(
  screening: ScreeningProvider,
  ctx: ComplianceContext,
): Promise<PaymentPreviewCompliance> {
  try {
    const result = await screening.screen({ name: ctx.name, identifier: ctx.identifier });
    return screeningToCompliance(
      result.decision,
      result.matchedLists,
      result.score,
      result.listVersion,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MovaError(
      ErrorCode.COMPLIANCE_UNAVAILABLE,
      `compliance engine unavailable — failing closed to REVIEW: ${reason}`,
      { details: { failClosed: true } },
    );
  }
}

/** A compliance verdict blocks execution outright (BLOCK). */
export function complianceBlocks(compliance: PaymentPreviewCompliance): boolean {
  return compliance.decision === "BLOCK";
}

/** A compliance verdict requires human review before execution. */
export function complianceNeedsReview(compliance: PaymentPreviewCompliance): boolean {
  return compliance.decision === "REVIEW";
}

export function complianceAllows(compliance: PaymentPreviewCompliance): boolean {
  return compliance.decision === "ALLOW";
}

/** Deterministic aggregate over the preview's engines — BLOCK wins. */
export function pipeDecision(preview: {
  compliance: PaymentPreviewCompliance;
  risk: { decision: "PROCEED" | "REVIEW" | "BLOCK" };
}): ComplianceDecision {
  if (preview.compliance.decision === "BLOCK" || preview.risk.decision === "BLOCK") return "BLOCK";
  if (preview.compliance.decision === "REVIEW" || preview.risk.decision === "REVIEW") return "REVIEW";
  return "ALLOW";
}
