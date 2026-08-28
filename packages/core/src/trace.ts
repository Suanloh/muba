/**
 * MOVA Phase 8 — deterministic audit-trail & txn-status projection.
 *
 * Turns the immutable, append-only `AuditEvent` stream into the human-facing
 * trust layer:
 *
 *   - `buildStatusTimeline` — the lifecycle ("txn Status"): every state the
 *     payment reached, in order, with WHO/WHEN/WHY (from the transition audit
 *     events). Pure projection — never fabricates a step the engine didn't
 *     emit.
 *   - `buildAuditTrail` — the decision log: every audited decision (original
 *     intent, parsed intent, route selection, compliance, risk, hedge,
 *     approval, execution) with its deterministic payload for expansion.
 *
 * No LLM produces anything here. The trail is derived exclusively from
 * `AuditEvent`s emitted by the deterministic engines and the approval service.
 */
import {
  PAYMENT_AUDIT_STAGES,
  PAYMENT_STATES,
  TERMINAL_STATES,
  type AuditEvent,
  type PaymentAuditEntry,
  type PaymentAuditStage,
  type PaymentAuditTrail,
  type PaymentState,
  type PaymentStatusStep,
} from "@mova/types";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<PaymentAuditStage, string> = {
  INTENT_CREATED: "Original intent",
  INTENT_PARSED: "Parsed intent",
  ROUTE: "Route selection",
  COMPLIANCE: "Compliance",
  RISK: "Risk assessment",
  HEDGE: "Hedging decision",
  APPROVAL: "User approval",
  EXECUTION: "Execution",
};

const STATE_LABELS: Record<PaymentState, string> = {
  CREATED: "Created",
  PARSED: "Parsed",
  ROUTE_FOUND: "Route selected",
  COMPLIANCE_CHECKED: "Compliance checked",
  RISK_ASSESSED: "Risk assessed",
  AWAITING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  EXECUTING: "Executing",
  SETTLED: "Settled",
  FAILED: "Failed",
};

/** Human label for an audit stage (e.g. "Route selection"). */
export function stageLabel(stage: PaymentAuditStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Human label for a lifecycle state (e.g. "Awaiting approval"). */
export function stateLabel(state: PaymentState): string {
  return STATE_LABELS[state] ?? state;
}

// ---------------------------------------------------------------------------
// Event → stage mapping (deterministic)
// ---------------------------------------------------------------------------

const STAGE_BY_EVENT: Record<string, PaymentAuditStage> = {
  INTENT_CREATED: "INTENT_CREATED",
  INTENT_PARSED: "INTENT_PARSED",
  VALIDATION_FAILED: "INTENT_PARSED",
  ROUTE_FOUND: "ROUTE",
  ROUTE_SELECTED: "ROUTE",
  ROUTING_FAILED: "ROUTE",
  COMPLIANCE_CHECKED: "COMPLIANCE",
  COMPLIANCE_BLOCKED: "COMPLIANCE",
  RISK_ASSESSED: "RISK",
  RISK_BLOCKED: "RISK",
  HEDGE_DECIDED: "HEDGE",
  APPROVAL_REQUESTED: "APPROVAL",
  APPROVED: "APPROVAL",
  APPROVAL_REJECTED: "APPROVAL",
  APPROVAL_EXPIRED: "APPROVAL",
  EXECUTION_STARTED: "EXECUTION",
  EXECUTION_SIMULATION_FAILED: "EXECUTION",
  EXECUTION_FAILED: "EXECUTION",
  SETTLED: "EXECUTION",
  CANCELLED: "EXECUTION",
};

/** Map an audit event type to its logical decision stage. */
export function auditStageForEvent(eventType: string): PaymentAuditStage {
  return STAGE_BY_EVENT[eventType] ?? "EXECUTION";
}

// ---------------------------------------------------------------------------
// Payload summarization (best-effort single-line detail)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function summarizePayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const parts: string[] = [];

  const failure = payload["failure"];
  if (isRecord(failure)) {
    const code = typeof failure["code"] === "string" ? failure["code"] : null;
    const msg = typeof failure["message"] === "string" ? failure["message"] : null;
    if (code) parts.push(code);
    if (msg) parts.push(msg);
  } else if (typeof payload["error"] === "string") {
    parts.push(payload["error"] as string);
  }
  if (typeof payload["reason"] === "string") parts.push(payload["reason"] as string);
  if (typeof payload["selectionReason"] === "string") parts.push(payload["selectionReason"] as string);
  if (typeof payload["decision"] === "string") parts.push(`decision: ${payload["decision"]}`);
  if (Array.isArray(payload["matchedLists"]) && (payload["matchedLists"] as unknown[]).length > 0) {
    parts.push(`matched: ${(payload["matchedLists"] as string[]).join(", ")}`);
  }
  if (typeof payload["band"] === "string" && typeof payload["score"] === "number") {
    parts.push(`risk ${payload["band"]} ${payload["score"]}/100`);
  }
  if (typeof payload["riskScore"] === "number") parts.push(`score ${payload["riskScore"]}/100`);
  if (typeof payload["strategy"] === "string") parts.push(`strategy ${payload["strategy"]}`);
  if (typeof payload["planDigest"] === "string") parts.push(`plan ${(payload["planDigest"] as string).slice(0, 16)}…`);
  if (typeof payload["txDigest"] === "string") parts.push(`digest ${(payload["txDigest"] as string).slice(0, 18)}…`);
  if (typeof payload["simulated"] === "boolean") parts.push(`simulated: ${payload["simulated"]}`);
  if (typeof payload["validated"] === "boolean") parts.push(`validated: ${payload["validated"]}`);
  if (typeof payload["candidateCount"] === "number") parts.push(`${payload["candidateCount"]} candidates`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// txn Status — lifecycle timeline
// ---------------------------------------------------------------------------

/**
 * Build the lifecycle timeline for a correlation: every state the payment
 * reached, in chronological order, from the transition audit events. Steps
 * whose `newState` is not a known lifecycle state are ignored (decision-only
 * events such as HEDGE_DECIDED do not create a step).
 */
export function buildStatusTimeline(
  events: readonly AuditEvent[],
  correlationId: string,
): PaymentStatusStep[] {
  const sorted = events
    .filter((e) => e.correlationId === correlationId)
    .sort((a, b) => a.timestamp - b.timestamp);

  const steps: PaymentStatusStep[] = [];
  for (const e of sorted) {
    if (e.newState === null || !PAYMENT_STATES.includes(e.newState as PaymentState)) continue;
    const state = e.newState as PaymentState;
    let detail: string | null = null;
    if (state === "FAILED") {
      const failure = isRecord(e.payload) ? e.payload["failure"] : null;
      if (isRecord(failure)) {
        const code = typeof failure["code"] === "string" ? failure["code"] : null;
        const msg = typeof failure["message"] === "string" ? failure["message"] : null;
        detail = [code, msg].filter(Boolean).join(" — ") || "failed";
      } else {
        detail = "failed";
      }
    } else {
      detail = summarizePayload(e.payload);
    }
    steps.push({
      state,
      label: STATE_LABELS[state] ?? state,
      event: e.eventType,
      actor: actorLabel(e),
      at: e.timestamp,
      simulated: e.simulated,
      detail,
    });
  }
  return steps;
}

function actorLabel(e: AuditEvent): string {
  if (e.actor.type === "USER" || e.actor.type === "APPROVER") {
    return e.actor.id.length > 14 ? `${e.actor.id.slice(0, 10)}…` : e.actor.id;
  }
  return e.actor.id;
}

// ---------------------------------------------------------------------------
// Audit trail — decision log
// ---------------------------------------------------------------------------

function outcomeForEvent(e: AuditEvent): string {
  const payload = isRecord(e.payload) ? e.payload : null;
  // Verdict events expose a meaningful `decision`.
  if (payload && typeof payload["decision"] === "string") {
    const d = payload["decision"] as string;
    if (d === "HEDGE" || d === "NO_HEDGE" || d === "ALLOW" || d === "REVIEW" || d === "BLOCK" || d === "PROCEED") {
      return d;
    }
  }
  if (e.newState !== null) return e.newState;
  return e.eventType;
}

/**
 * Build the full audit trail (decision log + status timeline) for a
 * correlation from its immutable audit events.
 */
export function buildAuditTrail(
  events: readonly AuditEvent[],
  correlationId: string,
): PaymentAuditTrail {
  const sorted = events
    .filter((e) => e.correlationId === correlationId)
    .sort((a, b) => a.timestamp - b.timestamp);

  const statusSteps = buildStatusTimeline(sorted, correlationId);

  const entries: PaymentAuditEntry[] = sorted.map((e) => {
    const stage = auditStageForEvent(e.eventType);
    return {
      id: e.id,
      stage,
      label: stageLabel(stage),
      eventType: e.eventType,
      actor: { type: e.actor.type, id: e.actor.id },
      at: e.timestamp,
      simulated: e.simulated,
      outcome: outcomeForEvent(e),
      detail: summarizePayload(e.payload) ?? e.eventType,
      data: e.payload,
    };
  });

  const currentState = statusSteps.length > 0 ? statusSteps[statusSteps.length - 1]!.state : null;
  const terminal = currentState !== null && TERMINAL_STATES.includes(currentState);

  return {
    correlationId,
    recordId: sorted[0]?.entityId ?? null,
    statusSteps,
    entries,
    currentState,
    terminal,
    createdAt: sorted[0]?.timestamp ?? 0,
    updatedAt: sorted[sorted.length - 1]?.timestamp ?? 0,
  };
}

/** The canonical ordered audit stages (display order for the UI). */
export const AUDIT_STAGES: readonly PaymentAuditStage[] = PAYMENT_AUDIT_STAGES;
