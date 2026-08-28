/**
 * Phase 8 — audit-trail & txn-status projection tests.
 *
 * The trail is a PURE projection of `AuditEvent`s: it must (1) never
 * fabricate a step the engine didn't emit, (2) preserve chronological order,
 * (3) map events to the right logical stage, and (4) derive honest verdicts
 * from deterministic payloads (never from free text).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditEvent } from "@mova/types";
import {
  AUDIT_STAGES,
  auditStageForEvent,
  buildAuditTrail,
  buildStatusTimeline,
  stageLabel,
  stateLabel,
} from "./trace.js";

let n = 0;
const now = Date.now();

function ev(
  eventType: string,
  newState: string | null,
  payload: unknown,
  opts: { previousState?: string | null; simulated?: boolean; actor?: string } = {},
): AuditEvent {
  n += 1;
  return {
    id: `evt-${n}`,
    correlationId: "corr-1",
    entityType: "PAYMENT_INTENT",
    entityId: "pay_1",
    eventType,
    actor: { type: opts.actor ? "SYSTEM" : "USER", id: opts.actor ?? "0xowner" },
    payload,
    previousState: opts.previousState ?? null,
    newState,
    simulated: opts.simulated ?? false,
    timestamp: now + n,
  };
}

function fullLifecycle(): AuditEvent[] {
  return [
    ev("INTENT_CREATED", "CREATED", { rawText: "pay 10 SUI to 0xabc", validated: true }),
    ev("INTENT_PARSED", "PARSED", { action: "PAY", amount: { asset: "SUI", amount: "10000000000" } }, { previousState: "CREATED" }),
    ev("ROUTE_FOUND", "ROUTE_FOUND", { candidateCount: 3, decision: "SELECTED", selectionReason: "cheapest viable route", routeNo: 2 }, { previousState: "PARSED", simulated: true }),
    ev("COMPLIANCE_CHECKED", "COMPLIANCE_CHECKED", { decision: "ALLOW", riskScore: 12, failClosed: false, matchedLists: [] }, { previousState: "ROUTE_FOUND", simulated: true }),
    ev("RISK_ASSESSED", "RISK_ASSESSED", { band: "LOW", score: 24, decision: "PROCEED" }, { previousState: "COMPLIANCE_CHECKED", simulated: true }),
    ev("HEDGE_DECIDED", null, { decision: "NO_HEDGE", strategy: "NONE", dataSource: "STATIC_DEV" }, { simulated: true }),
    ev("APPROVAL_REQUESTED", "AWAITING_APPROVAL", { reason: "owner must approve", level: "SINGLE" }, { previousState: "RISK_ASSESSED" }),
    ev("APPROVED", "APPROVED", { decision: "APPROVE", planDigest: "0".repeat(64) }, { previousState: "AWAITING_APPROVAL" }),
    ev("EXECUTION_STARTED", "EXECUTING", { walletAuthz: true }, { previousState: "APPROVED" }),
    ev("SETTLED", "SETTLED", { simulated: true, txDigest: null }, { previousState: "EXECUTING" }),
  ];
}

describe("stage mapping", () => {
  it("maps lifecycle events to the right audit stages", () => {
    assert.equal(auditStageForEvent("INTENT_CREATED"), "INTENT_CREATED");
    assert.equal(auditStageForEvent("INTENT_PARSED"), "INTENT_PARSED");
    assert.equal(auditStageForEvent("ROUTE_FOUND"), "ROUTE");
    assert.equal(auditStageForEvent("ROUTE_SELECTED"), "ROUTE");
    assert.equal(auditStageForEvent("COMPLIANCE_CHECKED"), "COMPLIANCE");
    assert.equal(auditStageForEvent("RISK_ASSESSED"), "RISK");
    assert.equal(auditStageForEvent("HEDGE_DECIDED"), "HEDGE");
    assert.equal(auditStageForEvent("APPROVAL_REQUESTED"), "APPROVAL");
    assert.equal(auditStageForEvent("APPROVED"), "APPROVAL");
    assert.equal(auditStageForEvent("EXECUTION_STARTED"), "EXECUTION");
    assert.equal(auditStageForEvent("SETTLED"), "EXECUTION");
    assert.equal(auditStageForEvent("EXECUTION_FAILED"), "EXECUTION");
  });

  it("labels stages and states", () => {
    assert.equal(stageLabel("ROUTE"), "Route selection");
    assert.equal(stateLabel("AWAITING_APPROVAL"), "Awaiting approval");
  });
});

describe("buildStatusTimeline", () => {
  it("projects the full lifecycle in order with labels and timestamps", () => {
    const steps = buildStatusTimeline(fullLifecycle(), "corr-1");
    assert.deepEqual(
      steps.map((s) => s.state),
      ["CREATED", "PARSED", "ROUTE_FOUND", "COMPLIANCE_CHECKED", "RISK_ASSESSED", "AWAITING_APPROVAL", "APPROVED", "EXECUTING", "SETTLED"],
    );
    assert.equal(steps[5]!.label, "Awaiting approval");
    assert.ok(steps.every((s, i) => i === 0 || steps[i - 1]!.at <= s.at));
  });

  it("ignores decision-only events (no newState) — no fabricated step", () => {
    const steps = buildStatusTimeline(fullLifecycle(), "corr-1");
    // HEDGE_DECIDED has newState null → no step.
    assert.equal(steps.some((s) => s.event === "HEDGE_DECIDED"), false);
  });

  it("extracts a failure detail on the FAILED step", () => {
    const events = [
      ev("INTENT_CREATED", "CREATED", {}),
      ev("COMPLIANCE_CHECKED", "COMPLIANCE_CHECKED", { decision: "BLOCK", matchedLists: ["UNSC-123"] }, { simulated: true }),
      ev("CANCELLED", "FAILED", {
        failure: { code: "COMPLIANCE_BLOCKED", message: "counterparty matched UNSC-123" },
      }, { previousState: "COMPLIANCE_CHECKED" }),
    ];
    const steps = buildStatusTimeline(events, "corr-1");
    const failed = steps[steps.length - 1]!;
    assert.equal(failed.state, "FAILED");
    assert.match(failed.detail ?? "", /COMPLIANCE_BLOCKED/);
    assert.match(failed.detail ?? "", /UNSC-123/);
  });

  it("is a pure projection — ignores unrelated correlations", () => {
    const events = [
      ...fullLifecycle(),
      ev("INTENT_CREATED", "CREATED", {}),
      ev("APPROVED", "APPROVED", {}),
    ];
    // The last two share the same correlation (corr-1) by construction; give
    // them a different one to prove filtering.
    const foreign = events.map((e, i) =>
      i >= events.length - 2 ? { ...e, correlationId: "corr-other" } : e,
    );
    const steps = buildStatusTimeline(foreign, "corr-1");
    assert.equal(steps.length, 9);
  });
});

describe("buildAuditTrail", () => {
  it("builds a complete decision log over the full lifecycle", () => {
    const trail = buildAuditTrail(fullLifecycle(), "corr-1");
    assert.equal(trail.recordId, "pay_1");
    assert.equal(trail.currentState, "SETTLED");
    assert.equal(trail.terminal, true);
    assert.equal(trail.statusSteps.length, 9);
    // 10 events → 10 entries (decision-only events included as entries).
    assert.equal(trail.entries.length, 10);
  });

  it("derives verdicts from deterministic payloads", () => {
    const trail = buildAuditTrail(fullLifecycle(), "corr-1");
    const byType = Object.fromEntries(trail.entries.map((e) => [e.eventType, e]));
    assert.equal(byType["COMPLIANCE_CHECKED"]!.outcome, "ALLOW");
    assert.equal(byType["RISK_ASSESSED"]!.outcome, "PROCEED");
    assert.equal(byType["HEDGE_DECIDED"]!.outcome, "NO_HEDGE");
    assert.equal(byType["APPROVED"]!.outcome, "APPROVED");
    assert.equal(byType["SETTLED"]!.outcome, "SETTLED");
  });

  it("summarizes payloads into a one-line detail", () => {
    const trail = buildAuditTrail(fullLifecycle(), "corr-1");
    const route = trail.entries.find((e) => e.eventType === "ROUTE_FOUND");
    assert.match(route?.detail ?? "", /3 candidates/);
    const compliance = trail.entries.find((e) => e.eventType === "COMPLIANCE_CHECKED");
    assert.match(compliance?.detail ?? "", /decision: ALLOW/);
  });

  it("marks a blocked flow as terminal FAILED with the failure outcome", () => {
    const events = [
      ev("INTENT_CREATED", "CREATED", {}),
      ev("INTENT_PARSED", "PARSED", {}),
      ev("ROUTE_FOUND", "ROUTE_FOUND", {}, { simulated: true }),
      ev("COMPLIANCE_CHECKED", "COMPLIANCE_CHECKED", { decision: "BLOCK", matchedLists: ["UNSC-7"] }, { simulated: true }),
      ev("COMPLIANCE_BLOCKED", "FAILED", { failure: { code: "COMPLIANCE_BLOCKED", message: "blocked" } }),
    ];
    const trail = buildAuditTrail(events, "corr-1");
    assert.equal(trail.currentState, "FAILED");
    assert.equal(trail.terminal, true);
    const blocked = trail.entries.find((e) => e.eventType === "COMPLIANCE_CHECKED");
    assert.equal(blocked?.outcome, "BLOCK");
  });

  it("reports a non-terminal trail honestly (nothing invented past the last event)", () => {
    // Through the approval request (index 6) — but before any approval.
    const trail = buildAuditTrail(fullLifecycle().slice(0, 7), "corr-1");
    assert.equal(trail.currentState, "AWAITING_APPROVAL");
    assert.equal(trail.terminal, false);
    assert.equal(trail.entries.length, 7);
  });

  it("exposes the canonical ordered audit stages", () => {
    assert.equal(AUDIT_STAGES.length, 8);
    assert.equal(AUDIT_STAGES[0], "INTENT_CREATED");
    assert.equal(AUDIT_STAGES[7], "EXECUTION");
  });
});
